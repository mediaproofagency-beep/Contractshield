/**
 * Limitation de débit.
 *
 * Deux mécanismes, qui ne servent pas la même chose :
 *
 *  - **Le quota quotidien** est proactif. Il empêche le rattrapage en masse :
 *    worker arrêté 48 h, tout l'arriéré partirait d'un coup, ce qui ressemble à
 *    du spam et déclenche justement les limites de la plateforme. Un post par
 *    jour ouvré, c'est le volume décidé, pas une limite technique.
 *  - **Le recul exponentiel** est réactif. Il répond au 429, en respectant
 *    `Retry-After` quand LinkedIn le donne.
 *
 * La fenêtre de grâce complète le quota : un item dont l'heure est passée depuis
 * plus de deux heures n'est pas publié en retard, il repart en revue. Publier
 * lundi un post pensé pour vendredi est pire que ne rien publier.
 */

import type { Channel } from '../domain/types.ts';

export const DEFAULT_DAILY_QUOTA: Record<Channel, number> = {
  linkedin: 1,
  brevo: 1,
};

/** Au-delà, un item dû n'est plus publié : il retourne en revue humaine. */
export const GRACE_WINDOW_MS = 2 * 60 * 60 * 1000;

/** Reculs successifs après un échec réessayable. Plafonné, jamais infini. */
export const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000] as const;
export const MAX_ATTEMPTS = BACKOFF_MS.length;

export function backoffFor(attemptNo: number): number {
  const idx = Math.min(Math.max(attemptNo - 1, 0), BACKOFF_MS.length - 1);
  return BACKOFF_MS[idx] ?? BACKOFF_MS[BACKOFF_MS.length - 1]!;
}

export function nextAttemptAt(attemptNo: number, now: Date, retryAfter?: Date): Date {
  // `Retry-After` de la plateforme prime toujours sur notre propre recul.
  if (retryAfter && retryAfter.getTime() > now.getTime()) return retryAfter;
  return new Date(now.getTime() + backoffFor(attemptNo));
}

export function isWithinGrace(scheduledAt: Date, now: Date, graceMs = GRACE_WINDOW_MS): boolean {
  const late = now.getTime() - scheduledAt.getTime();
  return late >= 0 && late <= graceMs;
}

/** Bornes UTC de la journée. Le process tourne en UTC (TZ=UTC), pas d'heure d'été. */
export function utcDayBounds(now: Date): { start: Date; end: Date } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return { start, end: new Date(start.getTime() + 86_400_000) };
}

export interface QuotaDecision {
  allowed: boolean;
  used: number;
  quota: number;
  reason?: string;
}

export function checkQuota(publishedToday: number, channel: Channel, quota?: number): QuotaDecision {
  const limit = quota ?? DEFAULT_DAILY_QUOTA[channel];
  if (publishedToday >= limit) {
    return {
      allowed: false,
      used: publishedToday,
      quota: limit,
      reason: `Quota ${channel} atteint pour aujourd'hui (${publishedToday}/${limit}).`,
    };
  }
  return { allowed: true, used: publishedToday, quota: limit };
}
