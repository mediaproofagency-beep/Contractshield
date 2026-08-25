/**
 * Contrat Publisher.
 *
 * L'interface est plus large que ce dont LinkedIn a besoin aujourd'hui, et c'est
 * délibéré : TikTok publie de façon asynchrone (un `publish_id` à sonder) et exige
 * un cycle d'upload média. Une interface taillée pour LinkedIn seul obligerait à
 * la casser au premier canal suivant, ce que « ajouter un canal ne casse rien »
 * interdit. Le coût aujourd'hui est de trois champs optionnels.
 *
 * Ajouter un canal : un fichier ici, une ligne dans `registry.ts`, une valeur dans
 * l'enum `channel` et sa migration. Rien d'autre ne bouge : ordonnanceur, revue,
 * reprises et alertes sont agnostiques du canal.
 */

import type { Channel, ContentItem, ErrorClass, Format, PublishMode } from '../domain/types.ts';

export interface ChannelCapability {
  /** Faux quand le canal ne peut que déposer un brouillon (audit non validé). */
  canDirectPublish: boolean;
  /** Pourquoi, en français, pour l'alerte et le badge de la file. */
  reason?: string;
  probedAt: Date;
}

export interface PublishResult {
  ok: boolean;
  /** Ce qui a réellement été fait. Un brouillon n'est pas un échec. */
  mode: PublishMode;
  /**
   * `pending` signifie accepté mais pas encore publié côté plateforme : l'item
   * n'est PAS marqué publié tant que la confirmation n'est pas obtenue.
   */
  status: 'done' | 'pending';
  /** Quand resonder, pour un `pending`. */
  pollAfter?: Date;
  externalId?: string;
  degraded?: { reason: string };
  retryable: boolean;
  errorClass?: ErrorClass;
  errorDetail?: string;
  /** Code HTTP, pour l'audit. */
  responseCode?: number;
  /** Ce que le fondateur doit faire, en clair. Lu à 7 h du matin. */
  remediation?: string;
}

export interface PublishContext {
  /** Identité du worker, écrite dans le bail. */
  workerId: string;
  /** Vrai : aucun appel réseau, le payload est journalisé. */
  dryRun: boolean;
  now: Date;
  log: (message: string, fields?: Record<string, unknown>) => void;
}

export interface Publisher {
  readonly channel: Channel;
  /** Formats que ce canal accepte. Vérifié au démarrage par le registre. */
  readonly supportedFormats: readonly Format[];
  capabilities(ctx: PublishContext): Promise<ChannelCapability>;
  validate(item: ContentItem, ctx: PublishContext): Promise<{ ok: boolean; errors: string[] }>;
  publish(item: ContentItem, ctx: PublishContext): Promise<PublishResult>;
}

/** Erreur de publication normalisée, construite par les adaptateurs. */
export function failure(
  errorClass: ErrorClass,
  detail: string,
  remediation: string,
  opts: { retryable: boolean; responseCode?: number },
): PublishResult {
  return {
    ok: false,
    mode: 'direct',
    status: 'done',
    retryable: opts.retryable,
    errorClass,
    errorDetail: detail,
    responseCode: opts.responseCode,
    remediation,
  };
}
