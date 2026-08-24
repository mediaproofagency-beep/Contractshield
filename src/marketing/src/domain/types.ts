/**
 * Types du domaine marketing.
 *
 * Phase 1 : génération et validation humaine. Aucun adaptateur de publication.
 * Les statuts `scheduled`, `published` et `failed` existent dans le type parce que
 * la machine à états est la frontière décrite par R1 et qu'elle ne doit pas être
 * réécrite quand la diffusion arrivera. Aucun code de la phase 1 ne les produit.
 */

export const CHANNELS = ['linkedin', 'brevo'] as const;
export type Channel = (typeof CHANNELS)[number];

export const FORMATS = ['duel', 'clause', 'cas_usage'] as const;
export type Format = (typeof FORMATS)[number];

export const STATUSES = [
  'draft',
  'pending_review',
  'approved',
  'scheduled',
  'published',
  'failed',
  'rejected',
] as const;
export type Status = (typeof STATUSES)[number];

export const ANGLE_KINDS = ['clause_abusive', 'jurisprudence', 'cas_usage', 'duel_llm'] as const;
export type AngleKind = (typeof ANGLE_KINDS)[number];

export const ANGLE_SOURCE_KINDS = ['aggregate', 'legifrance', 'manual', 'public_template'] as const;
export type AngleSourceKind = (typeof ANGLE_SOURCE_KINDS)[number];

/** Motifs de rejet en liste courte (décision D-17 : un champ libre tue le budget 30 s). */
export const REJECT_REASONS = [
  'citation_fausse',
  'ton',
  'angle_faible',
  'redondant',
  'autre',
] as const;
export type RejectReason = (typeof REJECT_REASONS)[number];

export interface LegalRef {
  /** Ex. "Code civil", "Code de commerce". */
  code: string;
  /** Ex. "1171", "L.442-1". Comparé au texte généré par le validateur. */
  article: string;
  /** URL Légifrance. L'hôte est vérifié par le validateur. */
  url: string;
  fetchedAt: string;
}

export interface ContentAngle {
  id: number;
  kind: AngleKind;
  title: string;
  /**
   * Données de l'angle. Jamais de texte de contrat client verbatim (contrainte RGPD
   * du design doc). Passé au modèle comme donnée délimitée, jamais concaténé aux
   * instructions (décision D-05).
   */
  payload: Record<string, unknown>;
  legalRefs: LegalRef[];
  frequencyScore: number;
  sourceKind: AngleSourceKind;
  lastUsedAt: Date | null;
  status: 'active' | 'retired';
  createdAt: Date;
}

export interface ValidationError {
  code: 'unknown_article' | 'forbidden_host' | 'missing_legal_mention' | 'too_long' | 'empty_body';
  message: string;
  /** Le fragment fautif, pour que l'humain le voie sans relire tout le post. */
  evidence?: string;
}

export interface ContentItem {
  id: number;
  angleId: number;
  channel: Channel;
  format: Format;
  status: Status;
  body: string;
  bodyHash: string;
  validationErrors: ValidationError[] | null;
  reviewNote: string | null;
  rejectedReason: RejectReason | null;
  approvedBy: string | null;
  approvedAt: Date | null;
  /** Modèle et version de prompt ayant produit le corps courant. */
  generatedBy: string;
  /** Nombre d'éditions humaines. Signal d'entraînement le plus utile du système. */
  editCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewContentItem {
  angleId: number;
  channel: Channel;
  format: Format;
  body: string;
  generatedBy: string;
  validationErrors: ValidationError[] | null;
}
