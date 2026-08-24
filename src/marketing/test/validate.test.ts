import { describe, expect, it } from 'vitest';
import {
  extractArticles,
  LEGAL_MENTION,
  normaliseArticle,
  validateBody,
} from '../src/generator/validate.ts';
import type { ContentAngle } from '../src/domain/types.ts';

const angle: Pick<ContentAngle, 'legalRefs'> = {
  legalRefs: [
    {
      code: 'Code civil',
      article: '1171',
      url: 'https://www.legifrance.gouv.fr/search/code?query=1171',
      fetchedAt: '2026-08-24T00:00:00.000Z',
    },
    {
      code: 'Code de commerce',
      article: 'L.442-1',
      url: 'https://www.legifrance.gouv.fr/search/code?query=L442-1',
      fetchedAt: '2026-08-24T00:00:00.000Z',
    },
  ],
};

const ok = [
  "Cette clause de résiliation est déséquilibrée.",
  "L'article 1171 du Code civil permet de la contester, et l'article L.442-1 du Code de commerce vise le déséquilibre significatif.",
  'https://www.legifrance.gouv.fr/search/code?query=1171',
  LEGAL_MENTION,
].join('\n\n');

describe('normalisation des articles', () => {
  it('rapproche les écritures d’un même article', () => {
    expect(normaliseArticle('L. 442-1')).toBe(normaliseArticle('L.442-1'));
    expect(normaliseArticle('l442-1')).toBe(normaliseArticle('L. 442 - 1'.replace(/ /g, '')));
  });
});

describe('extraction', () => {
  it('repère les deux formes courantes', () => {
    const found = extractArticles("l'article 1171 et l'art. L.442-1").map(normaliseArticle);
    expect(found).toEqual(['1171', 'L442-1']);
  });
});

describe('validateBody', () => {
  it('accepte un corps dont toutes les citations sont couvertes', () => {
    expect(validateBody({ body: ok, channel: 'linkedin', angle })).toEqual([]);
  });

  it('refuse un article absent des références', () => {
    // Le cas qui compte : le modèle invente un numéro plausible.
    const body = ok.replace('1171', '1998');
    const errors = validateBody({ body, channel: 'linkedin', angle });
    expect(errors.some((e) => e.code === 'unknown_article')).toBe(true);
    expect(errors.find((e) => e.code === 'unknown_article')?.evidence).toContain('1998');
  });

  it('refuse un hôte non autorisé', () => {
    const body = `${ok}\n\nhttps://exemple.fr/article`;
    const errors = validateBody({ body, channel: 'linkedin', angle });
    expect(errors.some((e) => e.code === 'forbidden_host')).toBe(true);
  });

  it('refuse une URL Légifrance inventée', () => {
    // Bon hôte, mais l'URL ne vient pas des références : refusée aussi.
    const body = `${ok}\n\nhttps://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000000000000`;
    const errors = validateBody({ body, channel: 'linkedin', angle });
    expect(errors.some((e) => e.code === 'forbidden_host')).toBe(true);
  });

  it('refuse un corps dont la mention légale a été retirée', () => {
    const body = ok.replace(LEGAL_MENTION, '');
    const errors = validateBody({ body, channel: 'linkedin', angle });
    expect(errors.some((e) => e.code === 'missing_legal_mention')).toBe(true);
  });

  it('refuse un corps trop long pour LinkedIn', () => {
    const body = `${ok}\n${'x'.repeat(3100)}`;
    const errors = validateBody({ body, channel: 'linkedin', angle });
    expect(errors.some((e) => e.code === 'too_long')).toBe(true);
  });

  it('accepte la même longueur sur Brevo', () => {
    const body = `${ok}\n${'x'.repeat(3100)}`;
    const errors = validateBody({ body, channel: 'brevo', angle });
    expect(errors.some((e) => e.code === 'too_long')).toBe(false);
  });

  it('renvoie une seule erreur sur un corps vide', () => {
    const errors = validateBody({ body: '   ', channel: 'linkedin', angle });
    expect(errors).toEqual([{ code: 'empty_body', message: 'Le corps est vide.' }]);
  });

  it('accepte une URL de référence contenant une apostrophe', () => {
    // Régression : `encodeURIComponent` laisse l'apostrophe telle quelle, et
    // l'extracteur la coupait, ce qui bloquait un contenu valide.
    const withQuote: Pick<ContentAngle, 'legalRefs'> = {
      legalRefs: [
        {
          code: 'Code civil',
          article: '1171',
          url: "https://www.legifrance.gouv.fr/search/code?query=contrat%20d'adh%C3%A9sion",
          fetchedAt: '2026-08-24T00:00:00.000Z',
        },
      ],
    };
    const body = [
      "L'article 1171 du Code civil vise le contrat d'adhésion.",
      "https://www.legifrance.gouv.fr/search/code?query=contrat%20d'adh%C3%A9sion",
      LEGAL_MENTION,
    ].join('\n\n');
    expect(validateBody({ body, channel: 'linkedin', angle: withQuote })).toEqual([]);
  });

  it('ne signale pas deux fois le même article inventé', () => {
    const body = `${ok}\nVoir aussi article 1998 et article 1998.`;
    const errors = validateBody({ body, channel: 'linkedin', angle });
    expect(errors.filter((e) => e.code === 'unknown_article')).toHaveLength(1);
  });
});
