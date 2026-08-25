/**
 * Sélection d'angle.
 *
 * Volontairement un tourniquet, pas une pondération. `frequency_score` vient des
 * agrégats d'analyses réelles, qui n'existent pas encore : une formule pondérée
 * sur des zéros est un tirage aléatoire déguisé en algorithme. On prend donc le
 * moins récemment utilisé, et on écrira la pondération le jour où la donnée
 * existe (reportée dans TODOS).
 */

import { NoActiveAngleError } from '../domain/errors.ts';
import type { ContentAngle } from '../domain/types.ts';
import type { MarketingRepo } from '../repo/types.ts';

/** Un angle n'est pas réutilisé sous ce délai, même s'il est le seul disponible. */
export const REUSE_COOLDOWN_DAYS = 30;

export interface SelectOptions {
  now?: Date;
  /** Ignorer le délai de réutilisation. Utilisé par la démo et par `--force`. */
  ignoreCooldown?: boolean;
  /** Angles déjà servis dans le même lot, pour ne pas générer deux fois le même. */
  exclude?: ReadonlySet<number>;
}

export async function selectAngle(
  repo: MarketingRepo,
  opts: SelectOptions = {},
): Promise<ContentAngle> {
  const now = opts.now ?? new Date();
  const cooldownMs = REUSE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
  const angles = await repo.listActiveAngles();

  const candidates = angles.filter((a) => {
    if (opts.exclude?.has(a.id)) return false;
    if (opts.ignoreCooldown) return true;
    if (a.lastUsedAt == null) return true;
    return now.getTime() - a.lastUsedAt.getTime() >= cooldownMs;
  });

  const chosen = candidates[0];
  // Le générateur n'invente jamais un sujet quand la banque est vide : il alerte.
  if (!chosen) throw new NoActiveAngleError();
  return chosen;
}
