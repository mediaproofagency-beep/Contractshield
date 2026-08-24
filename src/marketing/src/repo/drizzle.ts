/**
 * Dépôt MariaDB (Drizzle).
 *
 * Chaque transition est un UPDATE conditionnel sur le statut attendu, et lit
 * `affectedRows`. C'est ce qui rend le double-clic et l'onglet concurrent
 * inoffensifs : le perdant touche zéro ligne et remonte une erreur claire au
 * lieu d'écraser la décision du gagnant.
 *
 * Non exécuté dans l'environnement de développement de cette session (aucune
 * MariaDB installée). Le chemin est écrit, testé par typage, et exercé par les
 * mêmes tests de service que la version mémoire dès qu'une base est branchée.
 */

import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import { contentAngles, contentItems } from '../db/schema.ts';
import { bodyHash } from '../domain/hash.ts';
import { assertTransition } from '../domain/state-machine.ts';
import type {
  ContentAngle,
  ContentItem,
  NewContentItem,
  Status,
  ValidationError,
} from '../domain/types.ts';
import type {
  ApproveInput,
  EditInput,
  MarketingRepo,
  QueueFilter,
  RejectInput,
} from './types.ts';

type Row = typeof contentItems.$inferSelect;
type AngleRow = typeof contentAngles.$inferSelect;

export class DrizzleRepo implements MarketingRepo {
  private readonly db: MySql2Database;

  constructor(db: MySql2Database) {
    this.db = db;
  }

  async insertAngle(angle: Omit<ContentAngle, 'id' | 'createdAt'>): Promise<ContentAngle> {
    const [res] = await this.db.insert(contentAngles).values({
      kind: angle.kind,
      title: angle.title,
      payload: angle.payload,
      legalRefs: angle.legalRefs,
      frequencyScore: angle.frequencyScore,
      sourceKind: angle.sourceKind,
      lastUsedAt: angle.lastUsedAt,
      status: angle.status,
    });
    const created = await this.getAngle(Number(res.insertId));
    if (!created) throw new Error("L'angle vient d'être inséré mais est introuvable.");
    return created;
  }

  async listActiveAngles(): Promise<ContentAngle[]> {
    const rows = await this.db
      .select()
      .from(contentAngles)
      .where(eq(contentAngles.status, 'active'))
      .orderBy(asc(contentAngles.lastUsedAt), asc(contentAngles.id));
    return rows.map(toAngle);
  }

  async getAngle(id: number): Promise<ContentAngle | null> {
    const [row] = await this.db.select().from(contentAngles).where(eq(contentAngles.id, id)).limit(1);
    return row ? toAngle(row) : null;
  }

  async markAngleUsed(id: number, at: Date): Promise<void> {
    await this.db.update(contentAngles).set({ lastUsedAt: at }).where(eq(contentAngles.id, id));
  }

  async retireAngle(id: number): Promise<void> {
    await this.db.update(contentAngles).set({ status: 'retired' }).where(eq(contentAngles.id, id));
  }

  async insertItem(item: NewContentItem): Promise<ContentItem> {
    const blocked = item.validationErrors != null && item.validationErrors.length > 0;
    const [res] = await this.db.insert(contentItems).values({
      angleId: item.angleId,
      channel: item.channel,
      format: item.format,
      status: blocked ? 'draft' : 'pending_review',
      body: item.body,
      bodyHash: bodyHash(item.body),
      validationErrors: item.validationErrors,
      generatedBy: item.generatedBy,
    });
    const created = await this.getItem(Number(res.insertId));
    if (!created) throw new Error("L'item vient d'être inséré mais est introuvable.");
    return created;
  }

  async getItem(id: number): Promise<ContentItem | null> {
    const [row] = await this.db.select().from(contentItems).where(eq(contentItems.id, id)).limit(1);
    return row ? toItem(row) : null;
  }

  async listItems(filter: QueueFilter = {}): Promise<ContentItem[]> {
    const q = this.db.select().from(contentItems);
    const rows = filter.statuses
      ? await q
          .where(inArray(contentItems.status, [...filter.statuses]))
          .orderBy(asc(contentItems.createdAt), asc(contentItems.id))
          .limit(filter.limit ?? 500)
      : await q.orderBy(asc(contentItems.createdAt), asc(contentItems.id)).limit(filter.limit ?? 500);
    return rows.map(toItem);
  }

  async findItemByHash(channel: string, hash: string): Promise<ContentItem | null> {
    const [row] = await this.db
      .select()
      .from(contentItems)
      .where(and(eq(contentItems.channel, channel as ContentItem['channel']), eq(contentItems.bodyHash, hash)))
      .limit(1);
    return row ? toItem(row) : null;
  }

  async approve({ id, expectedStatus, approvedBy }: ApproveInput): Promise<ContentItem | null> {
    assertTransition(expectedStatus, 'approved');
    return this.conditionalUpdate(id, expectedStatus, {
      status: 'approved',
      approvedBy,
      approvedAt: new Date(),
    });
  }

  async reject({ id, expectedStatus, reason, note }: RejectInput): Promise<ContentItem | null> {
    assertTransition(expectedStatus, 'rejected');
    return this.conditionalUpdate(id, expectedStatus, {
      status: 'rejected',
      rejectedReason: reason,
      reviewNote: note ?? null,
    });
  }

  async unapprove(id: number, expectedStatus: Status): Promise<ContentItem | null> {
    assertTransition(expectedStatus, 'pending_review');
    return this.conditionalUpdate(id, expectedStatus, {
      status: 'pending_review',
      approvedBy: null,
      approvedAt: null,
    });
  }

  async setStatus(id: number, expectedStatus: Status, next: Status): Promise<ContentItem | null> {
    assertTransition(expectedStatus, next);
    return this.conditionalUpdate(id, expectedStatus, { status: next });
  }

  async edit({ id, expectedStatus, body, bodyHash: hash, validationErrors }: EditInput): Promise<ContentItem | null> {
    const blocked = validationErrors != null && validationErrors.length > 0;
    const next: Status = blocked ? 'draft' : 'pending_review';
    if (expectedStatus !== next) assertTransition(expectedStatus, next);
    return this.conditionalUpdate(id, expectedStatus, {
      status: next,
      body,
      bodyHash: hash,
      validationErrors,
      editCount: sql`${contentItems.editCount} + 1`,
    });
  }

  /**
   * UPDATE ... WHERE id = ? AND status = ?. Zéro ligne touchée signifie que
   * quelqu'un d'autre est passé avant : on ne réessaie pas, on le dit.
   */
  private async conditionalUpdate(
    id: number,
    expectedStatus: Status,
    values: Record<string, unknown>,
  ): Promise<ContentItem | null> {
    const [res] = await this.db
      .update(contentItems)
      .set({ ...values, updatedAt: new Date() })
      .where(and(eq(contentItems.id, id), eq(contentItems.status, expectedStatus)));
    if (res.affectedRows === 0) return null;
    return this.getItem(id);
  }
}

function toItem(row: Row): ContentItem {
  return {
    id: Number(row.id),
    angleId: Number(row.angleId),
    channel: row.channel,
    format: row.format,
    status: row.status,
    body: row.body,
    bodyHash: row.bodyHash,
    validationErrors: (row.validationErrors as ValidationError[] | null) ?? null,
    reviewNote: row.reviewNote,
    rejectedReason: row.rejectedReason,
    approvedBy: row.approvedBy,
    approvedAt: row.approvedAt,
    generatedBy: row.generatedBy,
    editCount: row.editCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toAngle(row: AngleRow): ContentAngle {
  return {
    id: Number(row.id),
    kind: row.kind,
    title: row.title,
    payload: row.payload as Record<string, unknown>,
    legalRefs: row.legalRefs as ContentAngle['legalRefs'],
    frequencyScore: row.frequencyScore,
    sourceKind: row.sourceKind,
    lastUsedAt: row.lastUsedAt,
    status: row.status,
    createdAt: row.createdAt,
  };
}
