/**
 * Tick de publication. Appelé par cron.
 *
 * Ordre des opérations, chacune est une garantie :
 *
 *  1. **Interrupteur.** `MARKETING_ENABLED=false` coupe tout sans déploiement.
 *  2. **Réconciliation.** Un bail expiré sans publication signifie qu'un worker
 *     est mort en plein appel. On ne rejoue JAMAIS : l'item repart en revue avec
 *     la mention `needs_reconcile` et un humain va voir le profil. Republier
 *     automatiquement est le scénario du double post.
 *  3. **Quota.** Le quota quotidien est vérifié avant de lire la file, sinon un
 *     arriéré de 48 h partirait d'un coup.
 *  4. **Claim.** Bail atomique par ligne. Le perdant reçoit `null` et passe.
 *  5. **Audit avant l'appel.** La tentative est écrite avant le réseau, ce qui
 *     rend détectable une mort en plein vol.
 *  6. **Publication**, puis marquage conditionnel.
 *
 * Le statut ne sert jamais de verrou : c'est le bail qui verrouille. La liste de
 * statuts imposée reste donc intacte.
 */

import type { Channel, ContentItem, ErrorClass } from '../domain/types.ts';
import { PUBLISHABLE_STATUSES } from '../domain/state-machine.ts';
import type { MarketingRepo } from '../repo/types.ts';
import type { Publisher, PublishContext, PublishResult } from '../publisher/types.ts';
import { redact } from '../oauth/crypto.ts';
import {
  checkQuota,
  isWithinGrace,
  MAX_ATTEMPTS,
  nextAttemptAt,
  utcDayBounds,
} from './rate-limit.ts';

export interface Alert {
  level: 'info' | 'warn' | 'critical';
  message: string;
  remediation: string;
  itemId?: number;
}

export interface TickOptions {
  repo: MarketingRepo;
  publisher: Publisher;
  workerId?: string;
  now?: Date;
  dryRun?: boolean;
  enabled?: boolean;
  /** Durée du bail. Doit dépasser largement le timeout de l'adaptateur. */
  leaseMs?: number;
  /** Nombre maximum d'items traités par tick. */
  batch?: number;
  dailyQuota?: number;
  log?: (message: string, fields?: Record<string, unknown>) => void;
}

export interface TickReport {
  channel: Channel;
  examined: number;
  published: number;
  failed: number;
  skipped: number;
  reconciled: number;
  alerts: Alert[];
  dryRun: boolean;
}

const DEFAULT_LEASE_MS = 5 * 60_000;

export async function tick(opts: TickOptions): Promise<TickReport> {
  const {
    repo,
    publisher,
    workerId = `worker-${process.pid}`,
    now = new Date(),
    dryRun = false,
    enabled = true,
    leaseMs = DEFAULT_LEASE_MS,
    batch = 5,
    dailyQuota,
  } = opts;

  const channel = publisher.channel;
  const alerts: Alert[] = [];
  const report: TickReport = {
    channel,
    examined: 0,
    published: 0,
    failed: 0,
    skipped: 0,
    reconciled: 0,
    alerts,
    dryRun,
  };

  const log =
    opts.log ??
    ((message: string, fields?: Record<string, unknown>) => {
      const payload = fields ? ` ${redact(JSON.stringify(fields))}` : '';
      console.log(`[tick] ${message}${payload}`);
    });

  if (!enabled) {
    log('MARKETING_ENABLED=false, rien n\'est publié.');
    return report;
  }

  const ctx: PublishContext = {
    workerId,
    dryRun,
    now,
    log: (m, f) => log(m, f ? JSON.parse(redact(JSON.stringify(f))) : undefined),
  };

  // 2. Réconciliation avant toute chose.
  report.reconciled = await reconcile(repo, now, alerts, log);

  // 3. Quota du jour.
  const { start, end } = utcDayBounds(now);
  const publishedToday = await repo.countPublishedBetween(channel, start, end);
  const quota = checkQuota(publishedToday, channel, dailyQuota);
  if (!quota.allowed) {
    log(quota.reason ?? 'Quota atteint.');
    report.skipped += 1;
    return report;
  }

  const capacity = quota.quota - quota.used;
  const due = await repo.listDue(now, channel, Math.min(batch, capacity));
  report.examined = due.length;

  for (const item of due) {
    if (report.published >= capacity) {
      report.skipped += 1;
      continue;
    }

    // La fenêtre de grâce : un post prévu vendredi ne part pas lundi.
    if (item.scheduledAt && !isWithinGrace(item.scheduledAt, now)) {
      await repo.backToReview(
        item.id,
        `Heure de publication dépassée de plus de deux heures (prévu ${item.scheduledAt.toISOString()}).`,
      );
      alerts.push({
        level: 'warn',
        message: `Item ${item.id} non publié : l'heure prévue est passée depuis plus de deux heures.`,
        remediation: 'Il est revenu dans la file. Réapprouve-le si le contenu tient toujours.',
        itemId: item.id,
      });
      report.skipped += 1;
      continue;
    }

    const claimed = await repo.claim({
      id: item.id,
      workerId,
      leaseUntil: new Date(now.getTime() + leaseMs),
      now,
    });
    if (!claimed) {
      // Un autre worker est passé avant. Ce n'est pas une erreur.
      report.skipped += 1;
      continue;
    }

    const outcome = await publishOne(repo, publisher, claimed, ctx, now, alerts, log);
    if (outcome === 'published') report.published += 1;
    else if (outcome === 'failed') report.failed += 1;
    else report.skipped += 1;
  }

  return report;
}

async function publishOne(
  repo: MarketingRepo,
  publisher: Publisher,
  item: ContentItem,
  ctx: PublishContext,
  now: Date,
  alerts: Alert[],
  log: (m: string, f?: Record<string, unknown>) => void,
): Promise<'published' | 'failed' | 'skipped'> {
  // 5. Trace écrite AVANT l'appel réseau.
  const attempt = await repo.startAttempt({
    contentItemId: item.id,
    adapter: publisher.channel,
    attemptNo: item.attemptCount,
    startedAt: now,
  });

  let result: PublishResult;
  try {
    result = await publisher.publish(item, ctx);
  } catch (err) {
    // Un adaptateur ne devrait jamais lever : s'il le fait, c'est un bug, pas un
    // mode de panne. On le trace comme tel plutôt que de le convertir en retry.
    result = {
      ok: false,
      mode: 'direct',
      status: 'done',
      retryable: false,
      errorClass: 'unknown',
      errorDetail: err instanceof Error ? err.message : String(err),
      remediation: "L'adaptateur a levé une exception : c'est un bug à corriger, pas une panne réseau.",
    };
  }

  await repo.finishAttempt({
    id: attempt.id,
    finishedAt: new Date(now.getTime()),
    responseCode: result.responseCode ?? null,
    errorClass: result.errorClass ?? null,
    errorDetail: result.errorDetail ? redact(result.errorDetail) : null,
    degraded: result.degraded != null,
    externalId: result.externalId ?? null,
  });

  if (result.ok && result.status === 'done' && result.externalId) {
    const published = await repo.markPublished({
      id: item.id,
      externalId: result.externalId,
      mode: result.mode,
      at: now,
    });
    if (!published) {
      // URN déjà connue ou statut inattendu : ne pas rejouer, faire regarder.
      await repo.releaseLease(item.id);
      alerts.push({
        level: 'critical',
        message: `Item ${item.id} publié mais impossible à marquer (URN déjà connue ?).`,
        remediation: 'Vérifie le profil LinkedIn avant toute autre action.',
        itemId: item.id,
      });
      return 'skipped';
    }
    if (result.degraded) {
      alerts.push({
        level: 'info',
        message: `Item ${item.id} publié en mode dégradé : ${result.degraded.reason}`,
        remediation: 'Aucune action requise.',
        itemId: item.id,
      });
    }
    log('publié', { itemId: item.id, externalId: result.externalId, mode: result.mode });
    return 'published';
  }

  // `pending` : accepté mais pas confirmé. On garde l'item, on relâche le bail.
  if (result.ok && result.status === 'pending') {
    await repo.releaseLease(item.id);
    log('accepté, confirmation en attente', { itemId: item.id, pollAfter: result.pollAfter });
    return 'skipped';
  }

  return handleFailure(repo, item, result, now, alerts, log);
}

async function handleFailure(
  repo: MarketingRepo,
  item: ContentItem,
  result: PublishResult,
  now: Date,
  alerts: Alert[],
  log: (m: string, f?: Record<string, unknown>) => void,
): Promise<'failed' | 'skipped'> {
  const cls: ErrorClass = result.errorClass ?? 'unknown';
  const detail = redact(result.errorDetail ?? 'sans détail');
  await repo.releaseLease(item.id);

  // Authentification : ne jamais rejouer en boucle avec un jeton mort.
  if (cls === 'auth') {
    await repo.backToReview(item.id, `Publication impossible : ${detail}`);
    alerts.push({
      level: 'critical',
      message: `Canal ${item.channel} en pause : ${detail}`,
      remediation: result.remediation ?? 'Reconnecte le canal.',
      itemId: item.id,
    });
    return 'failed';
  }

  if (result.retryable && item.attemptCount < MAX_ATTEMPTS) {
    const at = nextAttemptAt(item.attemptCount, now, result.pollAfter);
    await repo.schedule(item.id, at).catch(() => null);
    log('échec réessayable', { itemId: item.id, cls, nextAttemptAt: at.toISOString() });
    if (cls !== 'rate_limit') {
      alerts.push({
        level: 'info',
        message: `Item ${item.id} : tentative ${item.attemptCount}/${MAX_ATTEMPTS} en échec (${cls}).`,
        remediation: result.remediation ?? 'Le tick réessaiera.',
        itemId: item.id,
      });
    }
    return 'skipped';
  }

  await repo.markFailed(item.id, `${cls} : ${detail}`);
  alerts.push({
    level: 'critical',
    message: `Item ${item.id} en échec définitif (${cls}) : ${detail}`,
    remediation: result.remediation ?? 'Regarde la file, onglet Décidés.',
    itemId: item.id,
  });
  return 'failed';
}

/**
 * Un bail expiré sans publication : le worker est mort entre l'appel et l'écriture.
 * L'item peut être en ligne ou pas. Un humain tranche, la machine ne rejoue pas.
 */
async function reconcile(
  repo: MarketingRepo,
  now: Date,
  alerts: Alert[],
  log: (m: string, f?: Record<string, unknown>) => void,
): Promise<number> {
  const orphans = await repo.listExpiredLeases(now);
  for (const item of orphans) {
    const attempts = await repo.listAttempts(item.id);
    const open = attempts.filter((a) => a.finishedAt == null);
    await repo.backToReview(
      item.id,
      `needs_reconcile : bail expiré avec ${open.length} tentative(s) sans réponse.`,
    );
    alerts.push({
      level: 'critical',
      message: `Item ${item.id} : bail expiré sans confirmation de publication.`,
      remediation:
        'Vérifie ton profil LinkedIn. Si le post est en ligne, marque-le publié ; ' +
        'sinon réapprouve-le. Il ne sera pas renvoyé automatiquement.',
      itemId: item.id,
    });
    log('réconciliation requise', { itemId: item.id, openAttempts: open.length });
  }
  return orphans.length;
}

/** Garde-fou lisible : le tick ne lit jamais autre chose que ces statuts. */
export const TICK_READS: readonly string[] = PUBLISHABLE_STATUSES;
