import { createHash } from 'node:crypto';

/**
 * Hash du corps, calculé sur une forme normalisée.
 *
 * Sans normalisation, deux espaces ou une majuscule suffisent à contourner
 * l'anti-doublon, qui devient cosmétique.
 */
export function bodyHash(body: string): string {
  const normalised = body.replace(/\s+/g, ' ').trim().toLocaleLowerCase('fr-FR');
  return createHash('sha256').update(normalised, 'utf8').digest('hex');
}
