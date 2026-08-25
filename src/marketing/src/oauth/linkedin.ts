/**
 * OAuth LinkedIn, autorisation à trois pattes.
 *
 *   1. on envoie le fondateur sur /oauth/v2/authorization avec un `state` aléatoire ;
 *   2. LinkedIn le renvoie sur le redirect_uri avec un `code` ;
 *   3. on échange le code contre un access token sur /oauth/v2/accessToken.
 *
 * Point non vérifiable depuis cet environnement, et important :
 * **rien ne garantit qu'un refresh token soit délivré.** Sur une application
 * standard avec `w_member_social`, l'échange peut ne renvoyer qu'un access token
 * de 60 jours. Le code traite les deux cas :
 *  - refresh token présent → renouvellement automatique dès J-14 ;
 *  - absent                → aucune tentative de refresh, alertes J-14/J-7/J-3
 *                            et page de reconsentement en un clic.
 * `describeGrant()` dit lequel des deux régimes s'applique, à afficher au premier
 * `oauth:login` plutôt que de le découvrir au jour 60 en production.
 */

import { randomBytes } from 'node:crypto';

export const AUTHORIZE_URL = 'https://www.linkedin.com/oauth/v2/authorization';
export const TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';
export const USERINFO_URL = 'https://api.linkedin.com/v2/userinfo';

/**
 * `w_member_social` publie au nom du membre. `openid` et `profile` servent
 * uniquement à récupérer le `sub`, qui devient l'URN auteur.
 */
export const DEFAULT_SCOPES = ['openid', 'profile', 'w_member_social'] as const;

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes?: readonly string[];
}

export interface TokenGrant {
  accessToken: string;
  /** Absent sur une application non éligible au renouvellement automatique. */
  refreshToken: string | null;
  accessExpiresAt: Date;
  refreshExpiresAt: Date | null;
  scopes: string[];
}

export class OAuthError extends Error {
  readonly remediation: string;
  readonly responseCode: number | null;

  constructor(message: string, remediation: string, responseCode: number | null = null) {
    super(message);
    this.name = 'OAuthError';
    this.remediation = remediation;
    this.responseCode = responseCode;
  }
}

export function newState(): string {
  return randomBytes(16).toString('base64url');
}

export function authorizeUrl(cfg: OAuthConfig, state: string): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', cfg.clientId);
  url.searchParams.set('redirect_uri', cfg.redirectUri);
  url.searchParams.set('state', state);
  url.searchParams.set('scope', (cfg.scopes ?? DEFAULT_SCOPES).join(' '));
  return url.toString();
}

interface RawGrant {
  access_token?: unknown;
  expires_in?: unknown;
  refresh_token?: unknown;
  refresh_token_expires_in?: unknown;
  scope?: unknown;
}

function toGrant(raw: RawGrant, now: Date): TokenGrant {
  const accessToken = typeof raw.access_token === 'string' ? raw.access_token : '';
  if (accessToken === '') {
    throw new OAuthError(
      "La réponse LinkedIn ne contient pas d'access_token.",
      'Vérifie client_id, client_secret et redirect_uri dans la console développeur LinkedIn.',
    );
  }
  const expiresIn = Number(raw.expires_in);
  const refreshToken = typeof raw.refresh_token === 'string' ? raw.refresh_token : null;
  const refreshExpiresIn = Number(raw.refresh_token_expires_in);

  return {
    accessToken,
    refreshToken,
    accessExpiresAt: new Date(now.getTime() + (Number.isFinite(expiresIn) ? expiresIn : 0) * 1000),
    refreshExpiresAt:
      refreshToken && Number.isFinite(refreshExpiresIn)
        ? new Date(now.getTime() + refreshExpiresIn * 1000)
        : null,
    scopes: typeof raw.scope === 'string' ? raw.scope.split(/[\s,]+/).filter(Boolean) : [],
  };
}

async function postForm(url: string, form: Record<string, string>): Promise<RawGrant> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
    });
  } catch (err) {
    throw new OAuthError(
      `LinkedIn injoignable : ${err instanceof Error ? err.message : String(err)}`,
      'Réessaie. Si cela persiste, vérifie la sortie réseau du VPS.',
    );
  }

  const text = await res.text();
  if (!res.ok) {
    throw new OAuthError(
      `LinkedIn a répondu ${res.status} : ${text.slice(0, 300)}`,
      res.status === 400
        ? "Code expiré ou redirect_uri différent de celui déclaré. Relance `oauth:login`."
        : 'Vérifie les identifiants de l\'application LinkedIn.',
      res.status,
    );
  }

  try {
    return JSON.parse(text) as RawGrant;
  } catch {
    throw new OAuthError(
      `Réponse LinkedIn illisible : ${text.slice(0, 200)}`,
      "Réessaie. Si le format a changé, l'échange de jeton doit être mis à jour.",
      res.status,
    );
  }
}

export async function exchangeCode(
  cfg: OAuthConfig,
  code: string,
  now: Date = new Date(),
): Promise<TokenGrant> {
  const raw = await postForm(TOKEN_URL, {
    grant_type: 'authorization_code',
    code,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    redirect_uri: cfg.redirectUri,
  });
  return toGrant(raw, now);
}

export async function refreshGrant(
  cfg: OAuthConfig,
  refreshToken: string,
  now: Date = new Date(),
): Promise<TokenGrant> {
  const raw = await postForm(TOKEN_URL, {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
  });
  const grant = toGrant(raw, now);
  // LinkedIn peut faire tourner le refresh token : on garde le nouveau s'il vient,
  // l'ancien sinon, jamais `null` (ce qui ferait perdre le renouvellement).
  return { ...grant, refreshToken: grant.refreshToken ?? refreshToken };
}

/** URN auteur, à partir du `sub` OpenID Connect. */
export async function fetchPersonUrn(accessToken: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(USERINFO_URL, { headers: { authorization: `Bearer ${accessToken}` } });
  } catch (err) {
    throw new OAuthError(
      `userinfo injoignable : ${err instanceof Error ? err.message : String(err)}`,
      'Réessaie plus tard.',
    );
  }
  if (!res.ok) {
    throw new OAuthError(
      `userinfo a répondu ${res.status}.`,
      res.status === 401
        ? 'Le jeton est invalide ou expiré. Relance `oauth:login`.'
        : "Vérifie que le scope `profile` est bien accordé à l'application.",
      res.status,
    );
  }
  const payload = (await res.json()) as { sub?: unknown };
  if (typeof payload.sub !== 'string' || payload.sub === '') {
    throw new OAuthError(
      'userinfo ne renvoie pas de `sub`.',
      "Le scope `openid` manque probablement à l'application.",
    );
  }
  return `urn:li:person:${payload.sub}`;
}

/**
 * Dit lequel des deux régimes s'applique. Affiché au premier `oauth:login` :
 * c'est le moment où découvrir l'absence de refresh token coûte deux minutes,
 * plutôt qu'au jour 60 avec un canal muet.
 */
export function describeGrant(grant: TokenGrant): string {
  if (grant.refreshToken) {
    const until = grant.refreshExpiresAt?.toISOString().slice(0, 10) ?? 'inconnue';
    return (
      `Refresh token délivré (expire le ${until}). ` +
      'Le renouvellement est automatique, aucune action périodique de ta part.'
    );
  }
  return (
    "Aucun refresh token délivré par LinkedIn pour cette application. " +
    `Le canal s'éteindra le ${grant.accessExpiresAt.toISOString().slice(0, 10)}. ` +
    'Tu recevras une alerte à J-14, J-7 et J-3, et une reconnexion en un clic dans la file.'
  );
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): OAuthConfig {
  const clientId = env.LINKEDIN_CLIENT_ID ?? '';
  const clientSecret = env.LINKEDIN_CLIENT_SECRET ?? '';
  const redirectUri = env.LINKEDIN_REDIRECT_URI ?? '';
  const missing = [
    clientId === '' ? 'LINKEDIN_CLIENT_ID' : null,
    clientSecret === '' ? 'LINKEDIN_CLIENT_SECRET' : null,
    redirectUri === '' ? 'LINKEDIN_REDIRECT_URI' : null,
  ].filter((v): v is string => v !== null);
  if (missing.length > 0) {
    throw new OAuthError(
      `Configuration LinkedIn incomplète : ${missing.join(', ')}.`,
      'Renseigne ces variables (voir .env.example) depuis la console développeur LinkedIn.',
    );
  }
  return { clientId, clientSecret, redirectUri };
}
