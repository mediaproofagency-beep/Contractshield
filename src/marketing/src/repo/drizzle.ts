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

import { and, asc, count, eq, gte, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import { contentAngles, contentItems, oauthTokens, publishAttempts } from '../db/schema.ts';
import { bodyHash } from '../domain/hash.ts';
import { assertTransition } from '../domain/state-machine.ts';
import type {
  Channel,
  ContentAngle,
  ContentItem,
  NewContentItem,
  PublishAttempt,
  Status,
  ValidationError,
} from '../domain/types.ts';
import type { StoredToken } from '../oauth/store.ts';
import type {
  ApproveInput,
  ClaimInput,
  EditInput,
  FinishAttempt,
  MarketingRepo,
  NewAttempt,
  PublishedInput,
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

  // --- diffusion ---

  async schedule(id: number, at: Date): Promise<ContentItem | null> {
    // Depuis `approved` comme depuis `scheduled` : une replanification après un
    // 429 ne doit pas échouer parce que l'item est déjà planifié.
    const [res] = await this.db
      .update(contentItems)
      .set({ status: 'scheduled', scheduledAt: at, updatedAt: new Date() })
      .where(
        and(
          eq(contentItems.id, id),
          inArray(contentItems.status, ['approved', 'scheduled']),
        ),
      );
    if (res.affectedRows === 0) return null;
    return this.getItem(id);
  }

  async listDue(now: Date, channel: Channel, limit: number): Promise<ContentItem[]> {
    const rows = await this.db
      .select()
      .from(contentItems)
      .where(
        and(
          eq(contentItems.channel, channel),
          inArray(contentItems.status, ['approved', 'scheduled']),
          or(isNull(contentItems.scheduledAt), lte(contentItems.scheduledAt, now)),
          or(isNull(contentItems.leaseUntil), lte(contentItems.leaseUntil, now)),
        ),
      )
      .orderBy(asc(contentItems.scheduledAt), asc(contentItems.id))
      .limit(limit);
    return rows.map(toItem);
  }

  /**
   * Claim atomique par bail.
   *
   * `GET_LOCK` n'est PAS utilisé : il est lié à la connexion, pas à la
   * transaction, et avec un pool la connexion qui verrouille n'est pas celle qui
   * travaille. Une coupure réseau libère le verrou côté serveur pendant que le
   * worker tourne encore. La seule garantie fiable est cet UPDATE conditionnel,
   * dont on lit `affectedRows`.
   */
  async claim({ id, workerId, leaseUntil, now }: ClaimInput): Promise<ContentItem | null> {
    const [res] = await this.db
      .update(contentItems)
      .set({
        lockedBy: workerId,
        leaseUntil,
        version: sql`${contentItems.version} + 1`,
        attemptCount: sql`${contentItems.attemptCount} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(contentItems.id, id),
          inArray(contentItems.status, ['approved', 'scheduled']),
          or(isNull(contentItems.leaseUntil), lte(contentItems.leaseUntil, now)),
        ),
      );
    if (res.affectedRows === 0) return null;
    return this.getItem(id);
  }

  async releaseLease(id: number): Promise<void> {
    await this.db
      .update(contentItems)
      .set({ lockedBy: null, leaseUntil: null, updatedAt: new Date() })
      .where(eq(contentItems.id, id));
  }

  async markPublished({ id, externalId, mode, at }: PublishedInput): Promise<ContentItem | null> {
    // L'index unique (channel, external_id) refuse un second item porteur de la
    // même URN : le double post devient une erreur de contrainte, pas un doublon.
    const [res] = await this.db
      .update(contentItems)
      .set({
        status: 'published',
        externalId,
        publishMode: mode,
        publishedAt: at,
        lockedBy: null,
        leaseUntil: null,
        updatedAt: at,
      })
      .where(
        and(eq(contentItems.id, id), inArray(contentItems.status, ['approved', 'scheduled'])),
      );
    if (res.affectedRows === 0) return null;
    return this.getItem(id);
  }

  async markFailed(id: number, note: string): Promise<ContentItem | null> {
    const [res] = await this.db
      .update(contentItems)
      .set({
        status: 'failed',
        reviewNote: note,
        lockedBy: null,
        leaseUntil: null,
        updatedAt: new Date(),
      })
      .where(
        and(eq(contentItems.id, id), inArray(contentItems.status, ['approved', 'scheduled'])),
      );
    if (res.affectedRows === 0) return null;
    return this.getItem(id);
  }

  async backToReview(id: number, note: string): Promise<ContentItem | null> {
    const [res] = await this.db
      .update(contentItems)
      .set({
        status: 'pending_review',
        reviewNote: note,
        scheduledAt: null,
        lockedBy: null,
        leaseUntil: null,
        updatedAt: new Date(),
      })
      .where(eq(contentItems.id, id));
    if (res.affectedRows === 0) return null;
    return this.getItem(id);
  }

  async listExpiredLeases(now: Date): Promise<ContentItem[]> {
    const rows = await this.db
      .select()
      .from(contentItems)
      .where(
        and(
          lt(contentItems.leaseUntil, now),
          isNull(contentItems.publishedAt),
          inArray(contentItems.status, ['approved', 'scheduled']),
        ),
      );
    return rows.map(toItem);
  }

  async countPublishedBetween(channel: Channel, start: Date, end: Date): Promise<number> {
    const [row] = await this.db
      .select({ n: count() })
      .from(contentItems)
      .where(
        and(
          eq(contentItems.channel, channel),
          gte(contentItems.publishedAt, start),
          lt(contentItems.publishedAt, end),
        ),
      );
    return Number(row?.n ?? 0);
  }

  // --- audit ---

  async startAttempt(a: NewAttempt): Promise<PublishAttempt> {
    const [res] = await this.db.insert(publishAttempts).values({
      contentItemId: a.contentItemId,
      adapter: a.adapter,
      attemptNo: a.attemptNo,
      startedAt: a.startedAt,
    });
    return {
      id: Number(res.insertId),
      contentItemId: a.contentItemId,
      adapter: a.adapter,
      attemptNo: a.attemptNo,
      startedAt: a.startedAt,
      finishedAt: null,
      responseCode: null,
      errorClass: null,
      errorDetail: null,
      degraded: false,
      externalId: null,
    };
  }

  async finishAttempt(input: FinishAttempt): Promise<void> {
    await this.db
      .update(publishAttempts)
      .set({
        finishedAt: input.finishedAt,
        responseCode: input.responseCode,
        errorClass: input.errorClass,
        errorDetail: input.errorDetail,
        degraded: input.degraded ? 1 : 0,
        externalId: input.externalId,
      })
      .where(eq(publishAttempts.id, input.id));
  }

  async listAttempts(contentItemId: number): Promise<PublishAttempt[]> {
    const rows = await this.db
      .select()
      .from(publishAttempts)
      .where(eq(publishAttempts.contentItemId, contentItemId))
      .orderBy(asc(publishAttempts.attemptNo));
    return rows.map((r) => ({
      id: Number(r.id),
      contentItemId: Number(r.contentItemId),
      adapter: r.adapter,
      attemptNo: r.attemptNo,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      responseCode: r.responseCode,
      errorClass: r.errorClass,
      errorDetail: r.errorDetail,
      degraded: r.degraded === 1,
      externalId: r.externalId,
    }));
  }

  // --- jetons ---

  async getToken(provider: string): Promise<StoredToken | null> {
    const [row] = await this.db
      .select()
      .from(oauthTokens)
      .where(eq(oauthTokens.provider, provider))
      .limit(1);
    if (!row) return null;
    return {
      provider: row.provider,
      accountRef: row.accountRef,
      access: { keyVersion: row.keyVersion, iv: row.accessIv, tag: row.accessTag, ciphertext: row.accessCiphertext },
      refresh:
        row.refreshCiphertext && row.refreshIv && row.refreshTag
          ? {
              keyVersion: row.keyVersion,
              iv: row.refreshIv,
              tag: row.refreshTag,
              ciphertext: row.refreshCiphertext,
            }
          : null,
      accessExpiresAt: row.accessExpiresAt,
      refreshExpiresAt: row.refreshExpiresAt,
      scopes: (row.scopes as string[] | null) ?? [],
      status: row.status,
      lastRefreshedAt: row.lastRefreshedAt,
      alertLevel: row.alertLevel,
      lastAlertAt: row.lastAlertAt,
    };
  }

  async putToken(token: StoredToken): Promise<void> {
    const values = {
      provider: token.provider,
      accountRef: token.accountRef,
      accessCiphertext: token.access.ciphertext,
      accessIv: token.access.iv,
      accessTag: token.access.tag,
      refreshCiphertext: token.refresh?.ciphertext ?? null,
      refreshIv: token.refresh?.iv ?? null,
      refreshTag: token.refresh?.tag ?? null,
      keyVersion: token.access.keyVersion,
      accessExpiresAt: token.accessExpiresAt,
      refreshExpiresAt: token.refreshExpiresAt,
      scopes: token.scopes,
      status: token.status,
      lastRefreshedAt: token.lastRefreshedAt,
      alertLevel: token.alertLevel,
      lastAlertAt: token.lastAlertAt,
    };
    await this.db.insert(oauthTokens).values(values).onDuplicateKeyUpdate({ set: values });
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
    scheduledAt: row.scheduledAt,
    publishedAt: row.publishedAt,
    externalId: row.externalId,
    publishMode: row.publishMode,
    attemptCount: row.attemptCount,
    lockedBy: row.lockedBy,
    leaseUntil: row.leaseUntil,
    version: row.version,
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
