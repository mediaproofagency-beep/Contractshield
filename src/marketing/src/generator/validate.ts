/**
 * Validateur de citations. Bloquant.
 *
 * C'est la garantie centrale du système : une citation d'article fausse publiée
 * sous le nom du fondateur est pire que pas de post du tout. Un item qui ne passe
 * pas ce validateur ne quitte jamais `draft`, quelle que soit la porte d'entrée
 * (génération ou édition humaine).
 *
 * Quatre contrôles :
 *  1. tout article cité dans le corps existe dans les `legal_refs` de l'angle ;
 *  2. toute URL du corps a un hôte autorisé ET figure dans les `legal_refs` ;
 *  3. la mention légale obligatoire est présente ;
 *  4. le corps n'est ni vide ni au-delà de la limite du canal.
 */

import type { Channel, ContentAngle, ValidationError } from '../domain/types.ts';

/** Hôtes acceptés dans un contenu publié. Rien d'autre ne passe. */
export const ALLOWED_HOSTS = new Set(['www.legifrance.gouv.fr', 'legifrance.gouv.fr']);

/** Mention injectée par le formatter, jamais laissée au modèle. */
export const LEGAL_MENTION =
  'Analyse automatisée, ne constitue pas un conseil juridique.';

/** Limites de corps par canal. LinkedIn tronque au-delà de 3000 caractères. */
export const MAX_BODY: Record<Channel, number> = {
  linkedin: 3000,
  brevo: 20000,
};

/**
 * Repère « article 1171 », « art. L.442-1 », « article L. 131-3 du CPI ».
 * Volontairement large : un faux positif coûte une vérification humaine,
 * un faux négatif laisse passer une citation inventée.
 */
const ARTICLE_RE = /\b(?:article|art\.)\s*((?:[LRD]\.?\s*)?\d+(?:[-–]\d+)*)/gi;

/**
 * L'apostrophe est un caractère légal dans une URL, et `encodeURIComponent` ne
 * l'encode pas : une requête Légifrance « contrat d'adhésion » en contient une.
 * L'exclure du jeu de caractères tronquait l'URL, qui ne correspondait alors plus
 * à la référence de l'angle, et le validateur bloquait un contenu parfaitement
 * valide. La parenthèse fermante et le crochet restent exclus, eux, parce qu'ils
 * servent à encadrer un lien dans de la prose.
 */
const URL_RE = /https?:\/\/[^\s<>")\]]+/gi;

/** « L. 442-1 », « l.442.1 » et « L442-1 » désignent le même article. */
export function normaliseArticle(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/\./g, '')
    .replace(/–/g, '-');
}

export function extractArticles(body: string): string[] {
  const out: string[] = [];
  for (const m of body.matchAll(ARTICLE_RE)) {
    const captured = m[1];
    if (captured) out.push(captured);
  }
  return out;
}

export function extractUrls(body: string): string[] {
  return [...body.matchAll(URL_RE)].map((m) => m[0]);
}

export interface ValidateInput {
  body: string;
  channel: Channel;
  angle: Pick<ContentAngle, 'legalRefs'>;
}

export function validateBody({ body, channel, angle }: ValidateInput): ValidationError[] {
  const errors: ValidationError[] = [];

  if (body.trim().length === 0) {
    return [{ code: 'empty_body', message: 'Le corps est vide.' }];
  }

  const limit = MAX_BODY[channel];
  if (body.length > limit) {
    errors.push({
      code: 'too_long',
      message: `Corps de ${body.length} caractères, limite ${channel} : ${limit}.`,
    });
  }

  if (!body.includes(LEGAL_MENTION)) {
    errors.push({
      code: 'missing_legal_mention',
      message: 'La mention légale obligatoire a été retirée du corps.',
      evidence: LEGAL_MENTION,
    });
  }

  const known = new Set(angle.legalRefs.map((r) => normaliseArticle(r.article)));
  const seen = new Set<string>();
  for (const raw of extractArticles(body)) {
    const key = normaliseArticle(raw);
    if (known.has(key) || seen.has(key)) continue;
    seen.add(key);
    errors.push({
      code: 'unknown_article',
      message: `L'article « ${raw.trim()} » ne figure pas dans les références de l'angle.`,
      evidence: raw.trim(),
    });
  }

  const knownUrls = new Set(angle.legalRefs.map((r) => r.url));
  for (const url of extractUrls(body)) {
    let host: string;
    try {
      host = new URL(url).host;
    } catch {
      errors.push({ code: 'forbidden_host', message: `URL illisible : ${url}`, evidence: url });
      continue;
    }
    if (!ALLOWED_HOSTS.has(host)) {
      errors.push({
        code: 'forbidden_host',
        message: `Hôte non autorisé : ${host}.`,
        evidence: url,
      });
      continue;
    }
    if (!knownUrls.has(url)) {
      // Bon hôte mais URL inventée par le modèle : refusée aussi.
      errors.push({
        code: 'forbidden_host',
        message: `URL Légifrance absente des références de l'angle : ${url}`,
        evidence: url,
      });
    }
  }

  return errors;
}
