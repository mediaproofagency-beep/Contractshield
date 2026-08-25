/**
 * Interface de dépôt.
 *
 * Tout accès aux données passe par ici. Deux implémentations : `memory` (tests,
 * démo locale, aucune infra) et `drizzle` (MariaDB, production). Ni le service de
 * revue ni l'ordonnanceur ne connaissent l'une ou l'autre.
 *
 * Les méthodes de transition sont **conditionnelles par construction** : elles
 * prennent l'état attendu et renvoient `null` si aucune ligne n'a été touchée.
 * C'est ce qui rend le double-clic, l'onglet concurrent et le second worker
 * inoffensifs.
 */

import type {
  Channel,
  ContentAngle,
  ContentItem,
  ErrorClass,
  NewContentItem,
  PublishAttempt,
  PublishMode,
  RejectReason,
  Status,
  ValidationError,
} from '../domain/types.ts';
import type { StoredToken } from '../oauth/store.ts';

export interface QueueFilter {
  statuses?: readonly Status[];
  limit?: number;
}

export interface ApproveInput {
  id: number;
  expectedStatus: Status;
  approvedBy: string;
}

export interface RejectInput {
  id: number;
  expectedStatus: Status;
  reason: RejectReason;
  note?: string | null;
}

export interface EditInput {
  id: number;
  expectedStatus: Status;
  body: string;
  bodyHash: string;
  validationErrors: ValidationError[] | null;
}

export interface ClaimInput {
  id: number;
  workerId: string;
  leaseUntil: Date;
  now: Date;
}

export interface PublishedInput {
  id: number;
  externalId: string;
  mode: PublishMode;
  at: Date;
}

export interface NewAttempt {
  contentItemId: number;
  adapter: string;
  attemptNo: number;
  startedAt: Date;
}

export interface FinishAttempt {
  id: number;
  finishedAt: Date;
  responseCode: number | null;
  errorClass: ErrorClass | null;
  errorDetail: string | null;
  degraded: boolean;
  externalId: string | null;
}

export interface MarketingRepo {
  // --- angles ---
  insertAngle(angle: Omit<ContentAngle, 'id' | 'createdAt'>): Promise<ContentAngle>;
  listActiveAngles(): Promise<ContentAngle[]>;
  getAngle(id: number): Promise<ContentAngle | null>;
  markAngleUsed(id: number, at: Date): Promise<void>;
  retireAngle(id: number): Promise<void>;

  // --- items ---
  insertItem(item: NewContentItem): Promise<ContentItem>;
  getItem(id: number): Promise<ContentItem | null>;
  listItems(filter?: QueueFilter): Promise<ContentItem[]>;
  findItemByHash(channel: string, bodyHash: string): Promise<ContentItem | null>;

  /** Renvoie `null` si l'item n'était pas dans `expectedStatus`. */
  approve(input: ApproveInput): Promise<ContentItem | null>;
  reject(input: RejectInput): Promise<ContentItem | null>;
  edit(input: EditInput): Promise<ContentItem | null>;
  unapprove(id: number, expectedStatus: Status): Promise<ContentItem | null>;
  setStatus(id: number, expectedStatus: Status, next: Status): Promise<ContentItem | null>;

  // --- diffusion (phase 2) ---
  /** `approved` → `scheduled`, avec l'heure de départ en UTC. */
  schedule(id: number, at: Date): Promise<ContentItem | null>;
  /** Items dus, bail libre, ordre chronologique. */
  listDue(now: Date, channel: Channel, limit: number): Promise<ContentItem[]>;
  /**
   * Prend le bail. Conditionnel : statut publiable ET bail libre ou expiré.
   * `null` signifie qu'un autre worker est passé avant. On ne réessaie pas.
   */
  claim(input: ClaimInput): Promise<ContentItem | null>;
  releaseLease(id: number): Promise<void>;
  markPublished(input: PublishedInput): Promise<ContentItem | null>;
  markFailed(id: number, note: string): Promise<ContentItem | null>;
  /** Retour en revue humaine, pour la réconciliation et la fenêtre de grâce. */
  backToReview(id: number, note: string): Promise<ContentItem | null>;
  /** Items dont le bail a expiré sans publication : jamais rejoués à l'aveugle. */
  listExpiredLeases(now: Date): Promise<ContentItem[]>;
  /** Sert au quota quotidien. */
  countPublishedBetween(channel: Channel, start: Date, end: Date): Promise<number>;

  // --- audit des tentatives ---
  startAttempt(attempt: NewAttempt): Promise<PublishAttempt>;
  finishAttempt(input: FinishAttempt): Promise<void>;
  listAttempts(contentItemId: number): Promise<PublishAttempt[]>;

  // --- jetons ---
  getToken(provider: string): Promise<StoredToken | null>;
  putToken(token: StoredToken): Promise<void>;

  reset?(): Promise<void>;
}
