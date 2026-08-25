/**
 * CLI d'exploitation.
 *
 * `doctor` est la commande à lancer avant d'appeler à l'aide. `demo` est le
 * chemin de démarrage sans base ni secret. `tick --dry-run` affiche le payload
 * exact qui partirait chez LinkedIn, sans rien envoyer : c'est le seul moyen de
 * vérifier la version d'API et l'échappement avant une vraie publication.
 */

import { MarketingError } from '../domain/errors.ts';
import { MemoryRepo } from '../repo/memory.ts';
import type { MarketingRepo } from '../repo/types.ts';
import { SEED_ANGLES } from '../angles/seed.ts';
import { generateBatch } from '../generator/generate.ts';
import { ReviewService } from '../review/service.ts';
import { resolveMode } from '../generator/mistral.ts';
import { DDL, DDL_PHASE2 } from '../db/schema.ts';
import { ConsolePublisher } from '../publisher/console.ts';
import { createPublisher } from '../publisher/registry.ts';
import { tick } from '../scheduler/tick.ts';
import { createNotifier, emitAlerts } from '../notify.ts';
import {
  authorizeUrl,
  configFromEnv,
  describeGrant,
  exchangeCode,
  fetchPersonUrn,
  newState,
  OAuthError,
} from '../oauth/linkedin.ts';
import { daysLeft, sealGrant } from '../oauth/store.ts';
import { DEFAULT_DAILY_QUOTA } from '../scheduler/rate-limit.ts';

const USAGE = `
marketing <commande> [options]

  demo [n]                  seed + génération de n items + résumé de la file
  generate [n]              génère n items dans la file
  queue                     affiche la file
  tick [--dry-run] [--console]
                            un passage de publication. --dry-run n'envoie rien
                            et affiche le payload. --console utilise l'adaptateur
                            local au lieu de LinkedIn.
  oauth:login <provider>    affiche l'URL d'autorisation LinkedIn
  oauth:callback <code>     échange le code contre un jeton et l'enregistre
  oauth:status              état du jeton et échéance
  doctor                    vérifie la configuration et dit quoi faire
  db:print-ddl [--phase2]   DDL MariaDB
  help                      cette aide
`.trim();

function flag(argv: string[], name: string): boolean {
  return argv.includes(`--${name}`);
}

async function seeded(): Promise<MarketingRepo> {
  const repo = new MemoryRepo();
  for (const angle of SEED_ANGLES) await repo.insertAngle(angle);
  return repo;
}

async function printQueue(repo: MarketingRepo): Promise<void> {
  const view = await new ReviewService(repo).queue();
  console.log(
    `File : ${view.counts.pending} en attente, ${view.counts.blocked} bloqués, ` +
      `${view.counts.approved} approuvés, ${view.counts.rejected} rejetés.`,
  );
  for (const e of [...view.pending, ...view.blocked]) {
    const flagStr = e.approvable ? 'OK ' : 'KO ';
    const errs = e.item.validationErrors?.length ?? 0;
    console.log(
      `  ${flagStr}#${e.item.id} ${e.item.format.padEnd(9)} ${e.item.body.length
        .toString()
        .padStart(4)} car.${errs ? `  ${errs} erreur(s)` : ''}`,
    );
  }
}

async function cmdDemo(count: number): Promise<void> {
  const repo = await seeded();
  const { results, failures } = await generateBatch({ repo, count });
  console.log(`Angles chargés : ${SEED_ANGLES.length}`);
  console.log(`Items générés  : ${results.length}`);
  console.log(`Bloqués        : ${results.filter((r) => r.blocked).length}`);
  for (const f of failures) console.log(`Échec          : ${f.message}`);
  console.log('');
  await printQueue(repo);
  const first = results[0];
  if (first) {
    console.log('\n--- premier item ---\n');
    console.log(first.item.body);
  }
  console.log('\nPour valider : npm run marketing:review');
}

/**
 * Un passage de publication.
 *
 * Sur la base en mémoire, la file est vide au démarrage : la commande génère et
 * approuve un item pour que le passage ait quelque chose à faire. Sur une vraie
 * base, elle se contente de publier ce qui a été approuvé par un humain.
 */
async function cmdTick(argv: string[]): Promise<void> {
  const dryRun = flag(argv, 'dry-run');
  const useConsole = flag(argv, 'console');
  const repo = await seeded();

  const { results } = await generateBatch({ repo, count: 1 });
  const seededItem = results[0]?.item;
  if (seededItem && seededItem.status === 'pending_review') {
    await new ReviewService(repo).approve(seededItem.id, 'cli');
  }

  const publisher = useConsole
    ? new ConsolePublisher()
    : createPublisher('linkedin', { repo, console: false });

  const notifier = createNotifier();
  const report = await tick({
    repo,
    publisher,
    dryRun,
    enabled: (process.env.MARKETING_ENABLED ?? 'true') !== 'false',
    log: (m, f) => console.log(`[tick] ${m}${f ? ' ' + JSON.stringify(f, null, 2) : ''}`),
  });

  await emitAlerts(notifier, report);
  console.log(
    `\nExaminés ${report.examined} · publiés ${report.published} · échecs ${report.failed} · ` +
      `ignorés ${report.skipped} · réconciliés ${report.reconciled}` +
      (report.dryRun ? '  (dry-run : rien n\'a été envoyé)' : ''),
  );
}

function cmdOAuthLogin(provider: string): void {
  if (provider !== 'linkedin') {
    throw new MarketingError(
      `Fournisseur inconnu : ${provider}.`,
      'Seul `linkedin` est branché en phase 2.',
    );
  }
  const cfg = configFromEnv();
  const state = newState();
  console.log('Ouvre cette URL dans ton navigateur, connecte-toi, puis autorise :\n');
  console.log(authorizeUrl(cfg, state));
  console.log(`\nstate attendu au retour : ${state}`);
  console.log(
    '\nLinkedIn te renverra sur ton redirect_uri avec un paramètre `code`.\n' +
      'Copie ce code et lance : npm run marketing -- oauth:callback <code>',
  );
}

async function cmdOAuthCallback(code: string | undefined): Promise<void> {
  if (!code) {
    throw new MarketingError('Code manquant.', 'Usage : oauth:callback <code>.');
  }
  const cfg = configFromEnv();
  const now = new Date();
  const grant = await exchangeCode(cfg, code, now);
  const urn = await fetchPersonUrn(grant.accessToken);

  const repo = new MemoryRepo();
  await repo.putToken(sealGrant(grant, urn, 'linkedin', process.env.MARKETING_TOKEN_KEY, now));

  console.log(`Jeton enregistré pour ${urn}.`);
  console.log(describeGrant(grant));
  console.log(
    '\nAttention : cette commande écrit dans le dépôt en mémoire de ce processus. ' +
      'Branche DATABASE_URL pour une persistance réelle.',
  );
}

async function cmdOAuthStatus(): Promise<void> {
  const repo = new MemoryRepo();
  const token = await repo.getToken('linkedin');
  if (!token) {
    console.log('Aucun jeton LinkedIn enregistré dans ce dépôt.');
    console.log('À faire : npm run marketing -- oauth:login linkedin');
    return;
  }
  const left = daysLeft(token.accessExpiresAt, new Date());
  console.log(`Compte      : ${token.accountRef}`);
  console.log(`Statut      : ${token.status}`);
  console.log(`Access      : ${Math.ceil(left)} jour(s) restants`);
  console.log(`Refresh     : ${token.refresh ? 'présent' : 'absent (reconnexion manuelle)'}`);
}

function cmdDoctor(): void {
  const mode = resolveMode();
  const rows: [string, string, string][] = [
    ['Node', process.version, ''],
    ['TZ', process.env.TZ ?? '(non défini)', process.env.TZ === 'UTC' ? '' : 'Mettre TZ=UTC dans le cron'],
    ['MISTRAL_MODE', mode, mode === 'api' && !process.env.MISTRAL_API_KEY ? 'Clé manquante' : ''],
    [
      'MARKETING_ENABLED',
      process.env.MARKETING_ENABLED ?? 'true',
      process.env.MARKETING_ENABLED === 'false' ? 'Publication coupée' : '',
    ],
    [
      'MARKETING_TOKEN_KEY',
      process.env.MARKETING_TOKEN_KEY ? 'définie' : 'absente',
      process.env.MARKETING_TOKEN_KEY
        ? ''
        : "Requise pour stocker un jeton. Génère : node -e \"console.log('1:'+require('crypto').randomBytes(32).toString('base64'))\"",
    ],
    [
      'LINKEDIN_CLIENT_ID',
      process.env.LINKEDIN_CLIENT_ID ? 'défini' : 'absent',
      process.env.LINKEDIN_CLIENT_ID ? '' : 'Console développeur LinkedIn',
    ],
    [
      'LINKEDIN_REDIRECT_URI',
      process.env.LINKEDIN_REDIRECT_URI ?? 'absent',
      process.env.LINKEDIN_REDIRECT_URI ? '' : 'Doit être identique à celui déclaré chez LinkedIn',
    ],
    [
      'LINKEDIN_API_VERSION',
      process.env.LINKEDIN_API_VERSION ?? '202601 (défaut)',
      'À confirmer : les versions tournent chaque trimestre',
    ],
    [
      'WEBHOOK_ALERT_URL',
      process.env.WEBHOOK_ALERT_URL ? 'défini' : 'absent',
      process.env.WEBHOOK_ALERT_URL ? '' : 'Sans lui, les alertes ne sortent que sur stdout',
    ],
    ['Quota LinkedIn/jour', String(DEFAULT_DAILY_QUOTA.linkedin), ''],
    ['Angles de seed', String(SEED_ANGLES.length), ''],
  ];
  for (const [k, v, note] of rows) console.log(`${k.padEnd(22)} ${v.padEnd(18)} ${note}`);
}

async function main(argv: string[]): Promise<number> {
  const [cmd = 'help', arg] = argv;
  const n = Number.parseInt(arg ?? '', 10);
  switch (cmd) {
    case 'demo':
      await cmdDemo(Number.isFinite(n) ? n : 5);
      return 0;
    case 'generate': {
      const repo = await seeded();
      const { results, failures } = await generateBatch({ repo, count: Number.isFinite(n) ? n : 5 });
      console.log(`${results.length} item(s) généré(s), ${failures.length} échec(s).`);
      await printQueue(repo);
      return 0;
    }
    case 'queue':
      await printQueue(await seeded());
      return 0;
    case 'tick':
      await cmdTick(argv.slice(1));
      return 0;
    case 'oauth:login':
      cmdOAuthLogin(arg ?? 'linkedin');
      return 0;
    case 'oauth:callback':
      await cmdOAuthCallback(arg);
      return 0;
    case 'oauth:status':
      await cmdOAuthStatus();
      return 0;
    case 'doctor':
      cmdDoctor();
      return 0;
    case 'db:print-ddl':
      console.log(flag(argv, 'phase2') ? DDL_PHASE2 : DDL);
      return 0;
    default:
      console.log(USAGE);
      return cmd === 'help' ? 0 : 1;
  }
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    if (err instanceof MarketingError || err instanceof OAuthError) {
      console.error(`Erreur : ${err.message}`);
      if (err.remediation) console.error(`À faire : ${err.remediation}`);
    } else {
      console.error(err);
    }
    process.exitCode = 1;
  });
