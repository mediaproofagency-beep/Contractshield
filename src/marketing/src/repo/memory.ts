/**
 * Dépôt en mémoire.
 *
 * Sert les tests et la démo locale (`marketing demo`), qui doivent tourner sans
 * MariaDB : c'est ce qui fait passer le temps de premier lancement de plusieurs
 * heures à quelques secondes. Les mêmes garanties conditionnelles que la version
 * MariaDB sont respectées, sinon les tests valideraient un comportement que la
 * production n'a pas.
 */

import { bodyHash } from '../domain/hash.ts';
import { assertTransition } from '../domain/state-machine.ts';
import type { ContentAngle, ContentItem, NewContentItem, Status } from '../domain/types.ts';
import type {
  ApproveInput,
  EditInput,
  MarketingRepo,
  QueueFilter,
  RejectInput,
} from './types.ts';

export class MemoryRepo implements MarketingRepo {
  private angles = new Map<number, ContentAngle>();
  private items = new Map<number, ContentItem>();
  private nextAngleId = 1;
  private nextItemId = 1;

  async reset(): Promise<void> {
    this.angles.clear();
    this.items.clear();
    this.nextAngleId = 1;
    this.nextItemId = 1;
  }

  async insertAngle(angle: Omit<ContentAngle, 'id' | 'createdAt'>): Promise<ContentAngle> {
    const row: ContentAngle = { ...angle, id: this.nextAngleId++, createdAt: new Date() };
    this.angles.set(row.id, row);
    return { ...row };
  }

  async listActiveAngles(): Promise<ContentAngle[]> {
    return [...this.angles.values()]
      .filter((a) => a.status === 'active')
      .sort((a, b) => {
        // Jamais utilisé d'abord, puis le plus anciennement utilisé.
        const at = a.lastUsedAt?.getTime() ?? -1;
        const bt = b.lastUsedAt?.getTime() ?? -1;
        if (at !== bt) return at - bt;
        return a.id - b.id;
      })
      .map((a) => ({ ...a }));
  }

  async getAngle(id: number): Promise<ContentAngle | null> {
    const a = this.angles.get(id);
    return a ? { ...a } : null;
  }

  async markAngleUsed(id: number, at: Date): Promise<void> {
    const a = this.angles.get(id);
    if (a) a.lastUsedAt = at;
  }

  async retireAngle(id: number): Promise<void> {
    const a = this.angles.get(id);
    if (a) a.status = 'retired';
  }

  async insertItem(item: NewContentItem): Promise<ContentItem> {
    const now = new Date();
    const blocked = item.validationErrors != null && item.validationErrors.length > 0;
    const row: ContentItem = {
      id: this.nextItemId++,
      angleId: item.angleId,
      channel: item.channel,
      format: item.format,
      // Le validateur décide : un corps propre part en revue, sinon il reste bloqué.
      status: blocked ? 'draft' : 'pending_review',
      body: item.body,
      bodyHash: bodyHash(item.body),
      validationErrors: item.validationErrors,
      reviewNote: null,
      rejectedReason: null,
      approvedBy: null,
      approvedAt: null,
      generatedBy: item.generatedBy,
      editCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.items.set(row.id, row);
    return { ...row };
  }

  async getItem(id: number): Promise<ContentItem | null> {
    const i = this.items.get(id);
    return i ? { ...i } : null;
  }

  async listItems(filter: QueueFilter = {}): Promise<ContentItem[]> {
    let rows = [...this.items.values()];
    if (filter.statuses) {
      const wanted = filter.statuses;
      rows = rows.filter((r) => wanted.includes(r.status));
    }
    rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id);
    if (filter.limit != null) rows = rows.slice(0, filter.limit);
    return rows.map((r) => ({ ...r }));
  }

  async findItemByHash(channel: string, hash: string): Promise<ContentItem | null> {
    for (const i of this.items.values()) {
      if (i.channel === channel && i.bodyHash === hash) return { ...i };
    }
    return null;
  }

  async approve({ id, expectedStatus, approvedBy }: ApproveInput): Promise<ContentItem | null> {
    return this.conditional(id, expectedStatus, 'approved', (row) => {
      row.approvedBy = approvedBy;
      row.approvedAt = new Date();
    });
  }

  async reject({ id, expectedStatus, reason, note }: RejectInput): Promise<ContentItem | null> {
    return this.conditional(id, expectedStatus, 'rejected', (row) => {
      row.rejectedReason = reason;
      row.reviewNote = note ?? null;
    });
  }

  async unapprove(id: number, expectedStatus: Status): Promise<ContentItem | null> {
    return this.conditional(id, expectedStatus, 'pending_review', (row) => {
      row.approvedBy = null;
      row.approvedAt = null;
    });
  }

  async setStatus(id: number, expectedStatus: Status, next: Status): Promise<ContentItem | null> {
    return this.conditional(id, expectedStatus, next, () => {});
  }

  async edit({ id, expectedStatus, body, bodyHash: hash, validationErrors }: EditInput): Promise<ContentItem | null> {
    const row = this.items.get(id);
    if (!row || row.status !== expectedStatus) return null;
    const blocked = validationErrors != null && validationErrors.length > 0;
    const next: Status = blocked ? 'draft' : 'pending_review';
    // Une édition qui casse les citations renvoie l'item en `draft` : le
    // validateur reprend la main, l'édition humaine ne le contourne pas.
    if (row.status !== next) assertTransition(row.status, next);
    row.body = body;
    row.bodyHash = hash;
    row.validationErrors = validationErrors;
    row.editCount += 1;
    row.status = next;
    row.updatedAt = new Date();
    return { ...row };
  }

  private conditional(
    id: number,
    expectedStatus: Status,
    next: Status,
    mutate: (row: ContentItem) => void,
  ): ContentItem | null {
    const row = this.items.get(id);
    if (!row || row.status !== expectedStatus) return null;
    assertTransition(row.status, next);
    mutate(row);
    row.status = next;
    row.updatedAt = new Date();
    return { ...row };
  }
}
