/**
 * Stockage et renouvellement des jetons.
 *
 * Deux régimes, décidés par la présence d'un refresh token (voir `oauth/linkedin.ts`) :
 *  - avec refresh : renouvellement dès que l'access token passe sous 14 jours ;
 *  - sans refresh : aucune tentative, alertes J-14 / J-7 / J-3 puis quotidiennes.
 *
 * Un renouvellement concurrent est évité par un verrou en mémoire par fournisseur :
 * deux ticks qui se chevauchent ne consomment pas deux fois le même refresh token,
 * ce qui, sur les fournisseurs à rotation, invaliderait la session.
 */

import type { SealedToken } from './crypto.ts';
import { currentVersion, loadKeys, open, seal } from './crypto.ts';
import { OAuthError, refreshGrant, type OAuthConfig, type TokenGrant } from './linkedin.ts';

export interface StoredToken {
  provider: string;
  accountRef: string;
  access: SealedToken;
  refresh: SealedToken | null;
  accessExpiresAt: Date;
  refreshExpiresAt: Date | null;
  scopes: string[];
  status: 'active' | 'expiring' | 'expired' | 'revoked';
  lastRefreshedAt: Date | null;
  /** Dernier palier d'alerte franchi : 14, 7, 3 ou 0. Évite le spam quotidien. */
  alertLevel: number;
  lastAlertAt: Date | null;
}

export interface TokenRepo {
  getToken(provider: string): Promise<StoredToken | null>;
  putToken(token: StoredToken): Promise<void>;
}

/** Paliers d'alerte, en jours restants. */
export const ALERT_THRESHOLDS = [14, 7, 3] as const;
/** En deçà, on tente le renouvellement. */
export const REFRESH_WHEN_DAYS_LEFT = 14;

const DAY_MS = 86_400_000;

export function daysLeft(expiresAt: Date, now: Date): number {
  return (expiresAt.getTime() - now.getTime()) / DAY_MS;
}

export function sealGrant(
  grant: TokenGrant,
  accountRef: string,
  provider: string,
  rawKeyEnv: string | undefined,
  now: Date,
): StoredToken {
  const keys = loadKeys(rawKeyEnv);
  const version = currentVersion(rawKeyEnv);
  return {
    provider,
    accountRef,
    access: seal(grant.accessToken, keys, version),
    refresh: grant.refreshToken ? seal(grant.refreshToken, keys, version) : null,
    accessExpiresAt: grant.accessExpiresAt,
    refreshExpiresAt: grant.refreshExpiresAt,
    scopes: grant.scopes,
    status: 'active',
    lastRefreshedAt: now,
    alertLevel: 0,
    lastAlertAt: null,
  };
}

export interface EnsureResult {
  accessToken: string;
  accountRef: string;
  /** Alerte à émettre, s'il y en a une. */
  alert: { level: number; message: string; remediation: string } | null;
  refreshed: boolean;
}

const inFlight = new Map<string, Promise<void>>();

/**
 * Renvoie un access token utilisable, en le renouvelant si nécessaire.
 * Lève si le canal ne peut plus publier : le tick doit s'arrêter bruyamment,
 * jamais réessayer en boucle avec un jeton mort.
 */
export async function ensureAccessToken(
  repo: TokenRepo,
  cfg: OAuthConfig,
  opts: { provider?: string; now?: Date; keyEnv?: string | undefined } = {},
): Promise<EnsureResult> {
  const provider = opts.provider ?? 'linkedin';
  const now = opts.now ?? new Date();
  const keyEnv = opts.keyEnv ?? process.env.MARKETING_TOKEN_KEY;

  // Un seul renouvellement à la fois par fournisseur.
  const pending = inFlight.get(provider);
  if (pending) await pending;

  const stored = await repo.getToken(provider);
  if (!stored) {
    throw new OAuthError(
      `Aucun jeton ${provider} enregistré.`,
      'Lance `npm run marketing -- oauth:login linkedin` et suis le lien affiché.',
    );
  }

  const keys = loadKeys(keyEnv);
  const left = daysLeft(stored.accessExpiresAt, now);

  if (left > REFRESH_WHEN_DAYS_LEFT) {
    return {
      accessToken: open(stored.access, keys),
      accountRef: stored.accountRef,
      alert: null,
      refreshed: false,
    };
  }

  // Régime sans refresh token : on n'essaie pas, on prévient.
  if (!stored.refresh) {
    if (left <= 0) {
      await repo.putToken({ ...stored, status: 'expired' });
      throw new OAuthError(
        `Le jeton ${provider} a expiré et cette application ne délivre pas de refresh token.`,
        'Reconnecte LinkedIn : `npm run marketing -- oauth:login linkedin`.',
      );
    }
    const threshold = ALERT_THRESHOLDS.find((t) => left <= t) ?? 0;
    const shouldAlert = threshold > 0 && threshold !== stored.alertLevel;
    if (shouldAlert) {
      await repo.putToken({ ...stored, status: 'expiring', alertLevel: threshold, lastAlertAt: now });
    }
    return {
      accessToken: open(stored.access, keys),
      accountRef: stored.accountRef,
      alert: shouldAlert
        ? {
            level: threshold,
            message: `Le jeton LinkedIn expire dans ${Math.ceil(left)} jour(s) et ne peut pas être renouvelé automatiquement.`,
            remediation: 'Reconnecte LinkedIn depuis la file, ou `oauth:login linkedin`.',
          }
        : null,
      refreshed: false,
    };
  }

  // Régime avec refresh token.
  if (stored.refreshExpiresAt && stored.refreshExpiresAt.getTime() <= now.getTime()) {
    await repo.putToken({ ...stored, status: 'expired' });
    throw new OAuthError(
      'Le refresh token LinkedIn a expiré.',
      'Reconnecte LinkedIn : `npm run marketing -- oauth:login linkedin`.',
    );
  }

  let refreshed: StoredToken | null = null;
  const task = (async () => {
    const grant = await refreshGrant(cfg, open(stored.refresh!, keys), now);
    refreshed = {
      ...sealGrant(grant, stored.accountRef, provider, keyEnv, now),
      alertLevel: 0,
      lastAlertAt: null,
    };
    await repo.putToken(refreshed);
  })();
  inFlight.set(provider, task.then(() => undefined, () => undefined));
  try {
    await task;
  } finally {
    inFlight.delete(provider);
  }

  const next = refreshed as StoredToken | null;
  if (!next) {
    throw new OAuthError(
      'Le renouvellement du jeton LinkedIn a échoué.',
      'Reconnecte LinkedIn : `npm run marketing -- oauth:login linkedin`.',
    );
  }
  return {
    accessToken: open(next.access, keys),
    accountRef: next.accountRef,
    alert: null,
    refreshed: true,
  };
}
