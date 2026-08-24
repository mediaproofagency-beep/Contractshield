/**
 * Angles de démarrage.
 *
 * La banque d'angles devait être alimentée par des agrégats d'analyses réelles.
 * Avec zéro utilisateur extérieur, cette source est vide et la sélection pondérée
 * dégénérerait en tirage aléatoire. Tant que le trafic est nul, la banque tient
 * donc dans ce fichier de seed, et `angles/select.ts` reste un simple tourniquet.
 *
 * Aucune de ces sources n'est un contrat client : contrats-types publics et textes
 * de loi uniquement. C'est la contrainte RGPD du design doc, tenue par construction.
 *
 * IMPORTANT : les URL sont des recherches Légifrance, pas des identifiants
 * LEGIARTI. Elles fonctionnent et n'inventent rien. L'ingest PISTE les remplacera
 * par les URL canoniques quand il sera branché (phase ultérieure).
 */

import type { ContentAngle } from '../domain/types.ts';

type SeedAngle = Omit<ContentAngle, 'id' | 'createdAt'>;

const legifrance = (query: string) =>
  `https://www.legifrance.gouv.fr/search/code?tab_selection=code&query=${encodeURIComponent(query)}`;

const FETCHED_AT = '2026-08-24T00:00:00.000Z';

export const SEED_ANGLES: SeedAngle[] = [
  {
    kind: 'clause_abusive',
    title: 'Cession de propriété intellectuelle rédigée en termes globaux',
    payload: {
      clauseType: 'cession de droits de propriété intellectuelle',
      // Extrait d'un contrat-type public, jamais d'un contrat client.
      exempleTypique:
        "« Le Prestataire cède au Client l'intégralité de ses droits de propriété intellectuelle sur les livrables. »",
      pourquoiCaCoince:
        "Une cession doit délimiter les droits cédés, les supports, l'étendue géographique et la durée. Une formule globale est contestable.",
      cePourquoiUnLlmGeneralisteEchoue:
        "Il répond « attention à la clause de PI » sans citer l'article qui impose la délimitation, donc sans donner de prise pour négocier.",
      quoiDemander:
        "Lister les droits cédés (reproduction, représentation, adaptation), les supports, le territoire et la durée.",
    },
    legalRefs: [
      {
        code: 'Code de la propriété intellectuelle',
        article: 'L.131-3',
        url: legifrance('code de la propriété intellectuelle L131-3'),
        fetchedAt: FETCHED_AT,
      },
    ],
    frequencyScore: 0,
    sourceKind: 'public_template',
    lastUsedAt: null,
    status: 'active',
  },
  {
    kind: 'clause_abusive',
    title: 'Pénalité de retard sans plafond ni réciprocité',
    payload: {
      clauseType: 'clause pénale',
      exempleTypique:
        "« Tout retard de livraison entraîne une pénalité de 5 % du montant total par jour de retard. »",
      pourquoiCaCoince:
        "Une pénalité manifestement excessive peut être réduite par le juge, et l'absence de réciprocité côté client est un signal de déséquilibre.",
      cePourquoiUnLlmGeneralisteEchoue:
        "Il conseille « de négocier » sans dire que le juge dispose d'un pouvoir de modération, ce qui change complètement le rapport de force.",
      quoiDemander: 'Plafonner la pénalité et prévoir la réciprocité en cas de retard de paiement.',
    },
    legalRefs: [
      {
        code: 'Code civil',
        article: '1231-5',
        url: legifrance('code civil 1231-5 clause pénale'),
        fetchedAt: FETCHED_AT,
      },
    ],
    frequencyScore: 0,
    sourceKind: 'public_template',
    lastUsedAt: null,
    status: 'active',
  },
  {
    kind: 'clause_abusive',
    title: 'Résiliation unilatérale sans préavis au bénéfice du seul client',
    payload: {
      clauseType: 'résiliation',
      exempleTypique:
        "« Le Client peut résilier le présent contrat à tout moment, sans préavis ni indemnité. »",
      pourquoiCaCoince:
        "Un déséquilibre significatif entre les droits et obligations des parties est sanctionnable, et une clause non négociable d'un contrat d'adhésion peut être réputée non écrite.",
      cePourquoiUnLlmGeneralisteEchoue:
        "Il qualifie la clause de « déséquilibrée » sans distinguer le régime du contrat d'adhésion de celui des pratiques restrictives, alors que ce sont deux leviers différents.",
      quoiDemander: 'Préavis symétrique et indemnisation des travaux engagés.',
    },
    legalRefs: [
      {
        code: 'Code civil',
        article: '1171',
        url: legifrance("code civil 1171 contrat d'adhésion"),
        fetchedAt: FETCHED_AT,
      },
      {
        code: 'Code de commerce',
        article: 'L.442-1',
        url: legifrance('code de commerce L442-1 déséquilibre significatif'),
        fetchedAt: FETCHED_AT,
      },
    ],
    frequencyScore: 0,
    sourceKind: 'public_template',
    lastUsedAt: null,
    status: 'active',
  },
];
