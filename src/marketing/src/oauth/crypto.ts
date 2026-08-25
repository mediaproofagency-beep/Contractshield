/**
 * Chiffrement des jetons au repos, AES-256-GCM.
 *
 * Un access token LinkedIn est un identifiant porteur de l'identité réelle du
 * fondateur : quiconque lit la base peut publier en son nom. Le stocker en clair
 * est un risque disproportionné au regard du coût de ce fichier.
 *
 * `keyVersion` est stocké à côté du chiffré. Sans lui, changer
 * `MARKETING_TOKEN_KEY` rend la base illisible et la rotation devient impossible :
 * c'est le défaut relevé en revue.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export interface SealedToken {
  keyVersion: number;
  /** base64 */
  iv: string;
  /** base64 */
  tag: string;
  /** base64 */
  ciphertext: string;
}

export class TokenKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenKeyError';
  }
}

/**
 * Lit les clés depuis l'environnement. Format : `v1:<base64 32 octets>` séparés
 * par des virgules, la première étant la clé d'écriture courante.
 * Exemple : `MARKETING_TOKEN_KEY=2:AAA…,1:BBB…`
 */
export function loadKeys(raw: string | undefined): Map<number, Buffer> {
  if (!raw || raw.trim() === '') {
    throw new TokenKeyError(
      'MARKETING_TOKEN_KEY absente. Génère une clé : ' +
        "node -e \"console.log('1:'+require('crypto').randomBytes(32).toString('base64'))\"",
    );
  }
  const keys = new Map<number, Buffer>();
  for (const part of raw.split(',')) {
    const [v, b64] = part.split(':');
    const version = Number(v);
    if (!Number.isInteger(version) || !b64) {
      throw new TokenKeyError(`Entrée de clé illisible : « ${part} ». Format attendu : <version>:<base64>.`);
    }
    const key = Buffer.from(b64, 'base64');
    if (key.length !== 32) {
      throw new TokenKeyError(`La clé de version ${version} fait ${key.length} octets, 32 attendus.`);
    }
    keys.set(version, key);
  }
  return keys;
}

export function currentVersion(raw: string | undefined): number {
  const first = (raw ?? '').split(',')[0]?.split(':')[0];
  const v = Number(first);
  if (!Number.isInteger(v)) throw new TokenKeyError('Version de clé illisible.');
  return v;
}

export function seal(plaintext: string, keys: Map<number, Buffer>, version: number): SealedToken {
  const key = keys.get(version);
  if (!key) throw new TokenKeyError(`Clé de version ${version} absente de MARKETING_TOKEN_KEY.`);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    keyVersion: version,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

export function open(sealed: SealedToken, keys: Map<number, Buffer>): string {
  const key = keys.get(sealed.keyVersion);
  if (!key) {
    throw new TokenKeyError(
      `Clé de version ${sealed.keyVersion} absente. Garde l'ancienne clé dans ` +
        'MARKETING_TOKEN_KEY le temps de la rotation.',
    );
  }
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(sealed.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(sealed.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

/**
 * Masque tout ce qui ressemble à un jeton dans une chaîne de log.
 * Appliqué systématiquement par le logger du contexte de publication.
 */
export function redact(text: string): string {
  return text
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer [redacted]')
    .replace(/("?(?:access|refresh)_token"?\s*[:=]\s*"?)[A-Za-z0-9._\-]+/gi, '$1[redacted]');
}
