import { describe, expect, it } from 'vitest';
import {
  buildPostPayload,
  escapeCommentary,
  interpretResponse,
  LinkedInPublisher,
  POSTS_URL,
} from '../src/publisher/linkedin.ts';
import { authorizeUrl, describeGrant, newState } from '../src/oauth/linkedin.ts';
import { currentVersion, loadKeys, open, redact, seal } from '../src/oauth/crypto.ts';
import type { ContentItem } from '../src/domain/types.ts';
import type { PublishContext } from '../src/publisher/types.ts';

const item: ContentItem = {
  id: 7,
  angleId: 1,
  channel: 'linkedin',
  format: 'duel',
  status: 'approved',
  body: 'Une clause (abusive) coûte cher. Voir article 1171.',
  bodyHash: 'x'.repeat(64),
  validationErrors: null,
  reviewNote: null,
  rejectedReason: null,
  approvedBy: 'owner',
  approvedAt: new Date(),
  generatedBy: 'test',
  editCount: 0,
  scheduledAt: null,
  publishedAt: null,
  externalId: null,
  publishMode: null,
  attemptCount: 1,
  lockedBy: null,
  leaseUntil: null,
  version: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const ctx: PublishContext = {
  workerId: 'test',
  dryRun: false,
  now: new Date('2026-08-24T10:00:00Z'),
  log: () => {},
};

function headers(map: Record<string, string>) {
  return { get: (n: string) => map[n.toLowerCase()] ?? null };
}

describe('échappement du commentary', () => {
  it('échappe les caractères réservés du petit texte', () => {
    expect(escapeCommentary('(a)')).toBe('\\(a\\)');
    expect(escapeCommentary('a|b')).toBe('a\\|b');
    expect(escapeCommentary('_gras_')).toBe('\\_gras\\_');
  });

  it('échappe la barre oblique inverse elle-même', () => {
    // Sinon on échapperait les barres qu'on vient d'ajouter.
    expect(escapeCommentary('a\\b')).toBe('a\\\\b');
  });

  it('laisse le texte courant intact', () => {
    expect(escapeCommentary('Une clause abusive coûte cher.')).toBe(
      'Une clause abusive coûte cher.',
    );
  });
});

describe('payload /rest/posts', () => {
  it('utilise un auteur urn:li:person et la distribution fil principal', () => {
    const payload = buildPostPayload(item, 'urn:li:person:ABC123');
    expect(payload.author).toBe('urn:li:person:ABC123');
    expect(payload.lifecycleState).toBe('PUBLISHED');
    expect(payload.visibility).toBe('PUBLIC');
    expect(payload.distribution).toMatchObject({ feedDistribution: 'MAIN_FEED' });
    expect(payload.commentary).toBe(escapeCommentary(item.body));
  });

  it('n’émet aucun champ ugcPosts', () => {
    const payload = buildPostPayload(item, 'urn:li:person:ABC');
    expect(payload).not.toHaveProperty('specificContent');
    expect(payload).not.toHaveProperty('shareCommentary');
  });
});

describe('lecture de la réponse LinkedIn', () => {
  it('accepte un 201 avec x-restli-id', () => {
    const r = interpretResponse({ status: 201, headers: headers({ 'x-restli-id': 'urn:li:share:1' }) }, '', 7);
    expect(r.ok).toBe(true);
    expect(r.externalId).toBe('urn:li:share:1');
  });

  it('refuse de marquer publié un 201 sans identifiant', () => {
    // Rejouer serait pire : le post est peut-être en ligne.
    const r = interpretResponse({ status: 201, headers: headers({}) }, '', 7);
    expect(r.ok).toBe(false);
    expect(r.retryable).toBe(false);
    expect(r.remediation).toContain('Vérifie ton profil');
  });

  it('classe 401 en auth, non réessayable', () => {
    const r = interpretResponse({ status: 401, headers: headers({}) }, 'expired', 7);
    expect(r.errorClass).toBe('auth');
    expect(r.retryable).toBe(false);
    expect(r.remediation).toContain('oauth:login');
  });

  it('classe 429 en rate_limit et lit Retry-After', () => {
    const r = interpretResponse({ status: 429, headers: headers({ 'retry-after': '120' }) }, '', 7);
    expect(r.errorClass).toBe('rate_limit');
    expect(r.retryable).toBe(true);
    expect(r.pollAfter).toBeInstanceOf(Date);
  });

  it('classe 500 en platform, réessayable', () => {
    const r = interpretResponse({ status: 503, headers: headers({}) }, 'oops', 7);
    expect(r.errorClass).toBe('platform');
    expect(r.retryable).toBe(true);
  });

  it('classe un 400 en validation, non réessayable, avec la commande de diagnostic', () => {
    const r = interpretResponse({ status: 400, headers: headers({}) }, 'bad version', 7);
    expect(r.errorClass).toBe('validation');
    expect(r.retryable).toBe(false);
    expect(r.remediation).toContain('--dry-run');
  });
});

describe('adaptateur LinkedIn', () => {
  it('envoie les trois en-têtes obligatoires', async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const publisher = new LinkedInPublisher({
      apiVersion: '202601',
      getAuth: async () => ({ accessToken: 'tok', authorUrn: 'urn:li:person:ABC' }),
      fetchImpl: (async (url: string, init: RequestInit) => {
        seen = { url, init };
        return new Response('', { status: 201, headers: { 'x-restli-id': 'urn:li:share:9' } });
      }) as unknown as typeof fetch,
    });

    const res = await publisher.publish(item, ctx);
    expect(res.ok).toBe(true);
    expect(seen!.url).toBe(POSTS_URL);
    const h = seen!.init.headers as Record<string, string>;
    expect(h['LinkedIn-Version']).toBe('202601');
    expect(h['X-Restli-Protocol-Version']).toBe('2.0.0');
    expect(h.authorization).toBe('Bearer tok');
  });

  it('n’appelle rien en dry-run', async () => {
    let called = false;
    const publisher = new LinkedInPublisher({
      apiVersion: '202601',
      getAuth: async () => ({ accessToken: 'tok', authorUrn: 'urn:li:person:ABC' }),
      fetchImpl: (async () => {
        called = true;
        return new Response('', { status: 201 });
      }) as unknown as typeof fetch,
    });
    const res = await publisher.publish(item, { ...ctx, dryRun: true });
    expect(called).toBe(false);
    expect(res.mode).toBe('draft');
    expect(res.ok).toBe(true);
  });

  it('affiche quand même le payload en dry-run sans jeton', async () => {
    // C'est le moment où on veut vérifier version d'API et échappement : avant
    // d'avoir configuré OAuth. Exiger un jeton ici viderait le dry-run de son sens.
    const logs: { message: string; fields?: Record<string, unknown> }[] = [];
    const publisher = new LinkedInPublisher({
      apiVersion: '202601',
      getAuth: async () => {
        throw new Error('aucun jeton');
      },
    });
    const res = await publisher.publish(item, {
      ...ctx,
      dryRun: true,
      log: (message, fields) => logs.push({ message, fields }),
    });
    expect(res.ok).toBe(true);
    expect(res.degraded?.reason).toContain('sans jeton');
    const payload = logs[0]?.fields?.payload as Record<string, unknown>;
    expect(payload.commentary).toBe(escapeCommentary(item.body));
    expect(String(payload.author)).toContain('urn:li:person:');
    expect(logs[0]?.fields?.authResolved).toBe(false);
  });

  it('refuse un corps qui dépasse la limite après échappement', async () => {
    const publisher = new LinkedInPublisher({
      apiVersion: '202601',
      getAuth: async () => ({ accessToken: 'tok', authorUrn: 'urn:li:person:ABC' }),
    });
    // 1600 parenthèses deviennent 3200 caractères une fois échappées.
    const long = { ...item, body: '('.repeat(1600) };
    const res = await publisher.validate(long, ctx);
    expect(res.ok).toBe(false);
    expect(res.errors[0]).toContain('après échappement');
  });

  it('remonte une erreur auth non réessayable quand le jeton manque', async () => {
    const publisher = new LinkedInPublisher({
      apiVersion: '202601',
      getAuth: async () => {
        throw Object.assign(new Error('aucun jeton'), { remediation: 'oauth:login' });
      },
    });
    const res = await publisher.publish(item, ctx);
    expect(res.errorClass).toBe('auth');
    expect(res.retryable).toBe(false);
    expect(res.remediation).toBe('oauth:login');
  });
});

describe('OAuth', () => {
  it('construit une URL d’autorisation avec les bons scopes', () => {
    const url = new URL(
      authorizeUrl(
        { clientId: 'cid', clientSecret: 's', redirectUri: 'https://x.fr/cb' },
        'state123',
      ),
    );
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toContain('w_member_social');
    expect(url.searchParams.get('state')).toBe('state123');
  });

  it('produit un state non devinable', () => {
    expect(newState()).not.toBe(newState());
    expect(newState().length).toBeGreaterThan(16);
  });

  it('dit clairement lequel des deux régimes s’applique', () => {
    const withRefresh = describeGrant({
      accessToken: 'a',
      refreshToken: 'r',
      accessExpiresAt: new Date('2026-10-23T00:00:00Z'),
      refreshExpiresAt: new Date('2027-08-24T00:00:00Z'),
      scopes: [],
    });
    expect(withRefresh).toContain('automatique');

    const without = describeGrant({
      accessToken: 'a',
      refreshToken: null,
      accessExpiresAt: new Date('2026-10-23T00:00:00Z'),
      refreshExpiresAt: null,
      scopes: [],
    });
    expect(without).toContain('Aucun refresh token');
    expect(without).toContain('2026-10-23');
  });
});

describe('chiffrement des jetons', () => {
  const env = '2:' + Buffer.alloc(32, 2).toString('base64') + ',1:' + Buffer.alloc(32, 1).toString('base64');

  it('scelle et rouvre avec la clé courante', () => {
    const keys = loadKeys(env);
    const sealed = seal('secret-token', keys, currentVersion(env));
    expect(sealed.keyVersion).toBe(2);
    expect(sealed.ciphertext).not.toContain('secret');
    expect(open(sealed, keys)).toBe('secret-token');
  });

  it('rouvre un jeton scellé avec une ancienne clé', () => {
    // Sans ça, changer la clé rendrait la base illisible : rotation impossible.
    const keys = loadKeys(env);
    const old = seal('vieux', keys, 1);
    expect(open(old, keys)).toBe('vieux');
  });

  it('refuse une clé de mauvaise taille', () => {
    expect(() => loadKeys('1:' + Buffer.alloc(16).toString('base64'))).toThrow(/32 attendus/);
  });

  it('masque les jetons dans les logs', () => {
    expect(redact('authorization: Bearer abc.def-123')).toContain('[redacted]');
    expect(redact('{"access_token":"abc123"}')).toContain('[redacted]');
    expect(redact('{"access_token":"abc123"}')).not.toContain('abc123');
  });
});

describe('échappement basculable', () => {
  it('laisse le corps intact quand l’échappement est désactivé', async () => {
    // La règle du petit texte n'a pas pu être vérifiée : le drapeau permet de
    // trancher après le premier post réel, sans toucher au code.
    const logs: { fields?: Record<string, unknown> }[] = [];
    const publisher = new LinkedInPublisher({
      apiVersion: '202601',
      escapeCommentaryField: false,
      getAuth: async () => ({ accessToken: 't', authorUrn: 'urn:li:person:A' }),
    });
    await publisher.publish(item, {
      ...ctx,
      dryRun: true,
      log: (_m, fields) => logs.push({ fields }),
    });
    const payload = logs[0]?.fields?.payload as Record<string, unknown>;
    expect(payload.commentary).toBe(item.body);
    expect(String(payload.commentary)).not.toContain('\\(');
  });
});
