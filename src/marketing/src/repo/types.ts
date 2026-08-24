/**
 * Interface de dépôt.
 *
 * Tout accès aux données passe par ici. Deux implémentations : `memory` (tests,
 * démo locale, aucune infra) et `drizzle` (MariaDB, production). Le service de
 * revue ne connaît ni l'une ni l'autre.
 *
 * Les méthodes de transition sont **conditionnelles par construction** : elles
 * prennent le statut attendu et renvoient `null` si aucune ligne n'a été touchée.
 * C'est ce qui rend le double-clic et l'onglet concurrent inoffensifs (D-09).
 */

import type {
  ContentAngle,
  ContentItem,
  NewContentItem,
  RejectReason,
  Status,
  ValidationError,
} from '../domain/types.ts';

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
  /** Utilisé par l'undo de la file : ramène un `approved` en `pending_review`. */
  unapprove(id: number, expectedStatus: Status): Promise<ContentItem | null>;
  /** Transition générique, vérifiée par la machine à états côté appelant. */
  setStatus(id: number, expectedStatus: Status, next: Status): Promise<ContentItem | null>;

  reset?(): Promise<void>;
}
