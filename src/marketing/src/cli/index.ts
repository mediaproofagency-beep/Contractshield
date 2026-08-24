/**
 * CLI d'exploitation.
 *
 * `doctor` est la commande à lancer avant d'appeler à l'aide : elle dit ce qui
 * est configuré, ce qui manque, et quoi faire. `demo` est le chemin de démarrage :
 * seed, génération, affichage, sans base ni secret.
 */

import { MarketingError } from '../domain/errors.ts';
import { MemoryRepo } from '../repo/memory.ts';
import type { MarketingRepo } from '../repo/types.ts';
import { SEED_ANGLES } from '../angles/seed.ts';
import { generateBatch } from '../generator/generate.ts';
import { ReviewService } from '../review/service.ts';
import { resolveMode } from '../generator/mistral.ts';
import { DDL } from '../db/schema.ts';

const USAGE = `
marketing <commande>

  demo [n]        seed + génération de n items (défaut 5) + résumé de la file
  generate [n]    génère n items dans la file
  queue           affiche la file
  doctor          vérifie la configuration et dit quoi faire
  db:print-ddl    imprime le DDL MariaDB des tables de la phase 1
  help            cette aide
`.trim();

async function seeded(): Promise<MarketingRepo> {
  const repo = new MemoryRepo();
  for (const angle of SEED_ANGLES) await repo.insertAngle(angle);
  return repo;
}

async function cmdDemo(count: number): Promise<void> {
  const repo = await seeded();
  const { results, failures } = await generateBatch({ repo, count });
  console.log(`Angles chargés : ${SEED_ANGLES.length}`);
  console.log(`Items générés  : ${results.length}`);
  console.log(`Bloqués        : ${results.filter((r) => r.blocked).length}`);
  console.log(`Doublons       : ${results.filter((r) => r.duplicate).length}`);
  for (const f of failures) console.log(`Échec          : ${f.message}`);
  console.log('');
  await printQueue(repo);
  const first = results[0];
  if (first) {
    console.log('\n--- premier item ---\n');
    console.log(first.item.body);
  }
  console.log(
    '\nPour valider à la souris et au clavier : npm run marketing:review',
  );
}

async function cmdGenerate(count: number): Promise<void> {
  const repo = await seeded();
  const { results, failures } = await generateBatch({ repo, count });
  console.log(`${results.length} item(s) généré(s), ${failures.length} échec(s).`);
  for (const f of failures) console.log(`  ${f.message}`);
  await printQueue(repo);
}

async function printQueue(repo: MarketingRepo): Promise<void> {
  const view = await new ReviewService(repo).queue();
  console.log(
    `File : ${view.counts.pending} en attente, ${view.counts.blocked} bloqués, ` +
      `${view.counts.approved} approuvés, ${view.counts.rejected} rejetés.`,
  );
  for (const e of [...view.pending, ...view.blocked]) {
    const flag = e.approvable ? 'OK ' : 'KO ';
    const errs = e.item.validationErrors?.length ?? 0;
    console.log(
      `  ${flag}#${e.item.id} ${e.item.format.padEnd(9)} ${e.item.body.length
        .toString()
        .padStart(4)} car.${errs ? `  ${errs} erreur(s)` : ''}`,
    );
  }
}

function cmdDoctor(): void {
  const mode = resolveMode();
  const rows: [string, string, string][] = [
    ['Node', process.version, process.version >= 'v22' ? '' : 'Node 22.6+ requis'],
    [
      'MISTRAL_MODE',
      mode,
      mode === 'api' && !process.env.MISTRAL_API_KEY
        ? 'MISTRAL_API_KEY manquante : passe en MISTRAL_MODE=fixture'
        : '',
    ],
    [
      'MISTRAL_API_KEY',
      process.env.MISTRAL_API_KEY ? 'définie' : 'absente',
      process.env.MISTRAL_API_KEY ? '' : 'Non requise en mode fixture',
    ],
    [
      'MARKETING_ADMIN_TOKEN',
      process.env.MARKETING_ADMIN_TOKEN ? 'défini' : 'absent',
      process.env.MARKETING_ADMIN_TOKEN
        ? ''
        : 'Obligatoire dès que la file est exposée ailleurs que sur 127.0.0.1',
    ],
    [
      'DATABASE_URL',
      process.env.DATABASE_URL ? 'définie' : 'absente',
      process.env.DATABASE_URL ? '' : 'Sans base, le dépôt mémoire est utilisé (démo et tests)',
    ],
    ['Angles de seed', String(SEED_ANGLES.length), ''],
  ];
  for (const [k, v, note] of rows) {
    console.log(`${k.padEnd(22)} ${v.padEnd(12)} ${note}`);
  }
}

async function main(argv: string[]): Promise<number> {
  const [cmd = 'help', arg] = argv;
  const n = Number.parseInt(arg ?? '', 10);
  switch (cmd) {
    case 'demo':
      await cmdDemo(Number.isFinite(n) ? n : 5);
      return 0;
    case 'generate':
      await cmdGenerate(Number.isFinite(n) ? n : 5);
      return 0;
    case 'queue':
      await printQueue(await seeded());
      return 0;
    case 'doctor':
      cmdDoctor();
      return 0;
    case 'db:print-ddl':
      console.log(DDL);
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
    if (err instanceof MarketingError) {
      console.error(`Erreur : ${err.message}`);
      if (err.remediation) console.error(`À faire : ${err.remediation}`);
    } else {
      console.error(err);
    }
    process.exitCode = 1;
  });
