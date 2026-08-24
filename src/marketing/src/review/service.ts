/**
 * Service de la file de validation (R2).
 *
 * Toutes les garanties humaines vivent ici :
 *  - une approbation ne part que d'un `pending_review`, en update conditionnel,
 *    donc le double-clic et le second onglet ne peuvent pas publier deux fois ;
 *  - un item porteur d'erreurs de validation n'est jamais approuvable ;
 *  - une édition humaine repasse par le validateur, elle ne le contourne pas ;
 *  - un rejet est enregistré avec un motif en liste courte, et deux rejets
 *    retirent l'angle de la banque.
 */

import { StaleItemError, UnvalidatedContentError } from '../domain/errors.ts';
import { bodyHash } from '../domain/hash.ts';
import { isEditable } from '../domain/state-machine.ts';
import type {
  ContentAngle,
  ContentItem,
  RejectReason,
  Status,
  ValidationError,
} from '../domain/types.ts';
import type { MarketingRepo } from '../repo/types.ts';
import { validateBody } from '../generator/validate.ts';

/** Au-delà, un item en attente est signalé comme vieillissant dans la file. */
export const STALE_AFTER_HOURS = 48;
/** Au-delà, il sera expiré automatiquement (le job appartient à la phase 2). */
export const EXPIRE_AFTER_DAYS = 7;

export interface QueueEntry {
  item: ContentItem;
  angle: ContentAngle | null;
  /** Prêt à être approuvé : en revue et sans erreur de validation. */
  approvable: boolean;
  /** En attente depuis plus de STALE_AFTER_HOURS. */
  stale: boolean;
  ageHours: number;
}

export interface QueueView {
  pending: QueueEntry[];
  blocked: QueueEntry[];
  decided: QueueEntry[];
  counts: { pending: number; blocked: number; approved: number; rejected: number };
}

export class ReviewService {
  private readonly repo: MarketingRepo;
  private readonly now: () => Date;

  constructor(repo: MarketingRepo, now: () => Date = () => new Date()) {
    this.repo = repo;
    this.now = now;
  }

  async queue(): Promise<QueueView> {
    const items = await this.repo.listItems();
    const entries = await Promise.all(items.map((item) => this.toEntry(item)));

    const pending = entries.filter((e) => e.item.status === 'pending_review');
    const blocked = entries.filter((e) => e.item.status === 'draft');
    const decided = entries
      .filter((e) => e.item.status === 'approved' || e.item.status === 'rejected')
      .reverse();

    return {
      pending,
      blocked,
      decided,
      counts: {
        pending: pending.length,
        blocked: blocked.length,
        approved: entries.filter((e) => e.item.status === 'approved').length,
        rejected: entries.filter((e) => e.item.status === 'rejected').length,
      },
    };
  }

  async get(id: number): Promise<QueueEntry | null> {
    const item = await this.repo.getItem(id);
    return item ? this.toEntry(item) : null;
  }

  /**
   * Approbation. Deux gardes distinctes, dans cet ordre :
   *  1. le validateur doit être au vert (sinon on refuse avant de toucher la base) ;
   *  2. l'update est conditionnel au statut `pending_review`.
   */
  async approve(id: number, approvedBy: string): Promise<ContentItem> {
    const current = await this.repo.getItem(id);
    if (!current) throw new StaleItemError(id);
    const errs = current.validationErrors ?? [];
    if (errs.length > 0) throw new UnvalidatedContentError(id, errs.length);

    const updated = await this.repo.approve({
      id,
      expectedStatus: 'pending_review',
      approvedBy,
    });
    if (!updated) throw new StaleItemError(id);
    return updated;
  }

  /** Annulation dans la fenêtre d'undo : `approved` revient en `pending_review`. */
  async undoApprove(id: number): Promise<ContentItem> {
    const updated = await this.repo.unapprove(id, 'approved');
    if (!updated) throw new StaleItemError(id);
    return updated;
  }

  /**
   * Rejet. Accepté depuis `pending_review`, `draft` (item bloqué) et `approved`
   * (annulation tant que rien n'est parti).
   */
  async reject(
    id: number,
    reason: RejectReason,
    note?: string | null,
  ): Promise<ContentItem> {
    const current = await this.repo.getItem(id);
    if (!current) throw new StaleItemError(id);

    const from: Status = current.status;
    const updated = await this.repo.reject({ id, expectedStatus: from, reason, note: note ?? null });
    if (!updated) throw new StaleItemError(id);

    await this.retireAngleIfRepeatedlyRejected(updated.angleId);
    return updated;
  }

  /**
   * Édition humaine.
   *
   * Le corps réécrit repasse par le validateur avec les références de l'angle.
   * Un corps qui introduit un article inventé retombe en `draft` : c'est la
   * porte que l'édition ouvrait sur le validateur, et elle est fermée ici.
   */
  async edit(id: number, body: string): Promise<{ item: ContentItem; errors: ValidationError[] }> {
    const current = await this.repo.getItem(id);
    if (!current) throw new StaleItemError(id);
    if (!isEditable(current.status)) throw new StaleItemError(id);

    const angle = await this.repo.getAngle(current.angleId);
    const errors = angle
      ? validateBody({ body, channel: current.channel, angle })
      : [
          {
            code: 'unknown_article' as const,
            message: "Angle introuvable : impossible de vérifier les citations.",
          },
        ];

    const updated = await this.repo.edit({
      id,
      expectedStatus: current.status,
      body,
      bodyHash: bodyHash(body),
      validationErrors: errors.length > 0 ? errors : null,
    });
    if (!updated) throw new StaleItemError(id);
    return { item: updated, errors };
  }

  /** Deux rejets sur le même angle le retirent de la banque. */
  private async retireAngleIfRepeatedlyRejected(angleId: number): Promise<void> {
    const items = await this.repo.listItems({ statuses: ['rejected'] });
    const rejected = items.filter((i) => i.angleId === angleId).length;
    if (rejected >= 2) await this.repo.retireAngle(angleId);
  }

  private async toEntry(item: ContentItem): Promise<QueueEntry> {
    const angle = await this.repo.getAngle(item.angleId);
    const ageHours = (this.now().getTime() - item.createdAt.getTime()) / 3_600_000;
    const errs = item.validationErrors ?? [];
    return {
      item,
      angle,
      approvable: item.status === 'pending_review' && errs.length === 0,
      stale: item.status === 'pending_review' && ageHours >= STALE_AFTER_HOURS,
      ageHours,
    };
  }
}
