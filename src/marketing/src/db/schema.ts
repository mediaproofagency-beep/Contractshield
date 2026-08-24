/**
 * Schéma Drizzle / MariaDB.
 *
 * Phase 1 : seules `content_angles` et `content_items` sont nécessaires.
 * `publish_attempts`, `oauth_tokens` et `channel_capabilities` appartiennent à la
 * diffusion et ne sont pas créées ici : une table vide en production est une dette,
 * pas une anticipation.
 *
 * Les colonnes ajoutées en revue sont présentes dès maintenant parce qu'une
 * migration additive plus tard coûte plus cher qu'une colonne inutilisée
 * aujourd'hui : `approved_by`, `approved_at`, `rejected_reason`, `edit_count`.
 */

import {
  bigint,
  char,
  datetime,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';
import { ANGLE_KINDS, ANGLE_SOURCE_KINDS, CHANNELS, FORMATS, REJECT_REASONS, STATUSES } from '../domain/types.ts';

export const contentAngles = mysqlTable(
  'content_angles',
  {
    id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
    kind: mysqlEnum('kind', ANGLE_KINDS).notNull(),
    title: varchar('title', { length: 200 }).notNull(),
    payload: json('payload').notNull(),
    legalRefs: json('legal_refs').notNull(),
    frequencyScore: int('frequency_score').notNull().default(0),
    sourceKind: mysqlEnum('source_kind', ANGLE_SOURCE_KINDS).notNull(),
    lastUsedAt: datetime('last_used_at'),
    status: mysqlEnum('status', ['active', 'retired']).notNull().default('active'),
    createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => ({
    byStatus: index('idx_angles_status').on(t.status, t.lastUsedAt),
  }),
);

export const contentItems = mysqlTable(
  'content_items',
  {
    id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
    angleId: bigint('angle_id', { mode: 'number' }).notNull(),
    channel: mysqlEnum('channel', CHANNELS).notNull(),
    format: mysqlEnum('format', FORMATS).notNull(),
    status: mysqlEnum('status', STATUSES).notNull().default('draft'),
    body: text('body').notNull(),
    /** SHA-256 d'un corps normalisé (casse et espaces), sinon l'anti-doublon est cosmétique. */
    bodyHash: char('body_hash', { length: 64 }).notNull(),
    validationErrors: json('validation_errors'),
    reviewNote: text('review_note'),
    rejectedReason: mysqlEnum('rejected_reason', REJECT_REASONS),
    approvedBy: varchar('approved_by', { length: 191 }),
    approvedAt: datetime('approved_at'),
    generatedBy: varchar('generated_by', { length: 100 }).notNull(),
    editCount: int('edit_count').notNull().default(0),
    createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => ({
    /** La requête de la file : les items en attente, les plus anciens d'abord. */
    byStatus: index('idx_items_status_created').on(t.status, t.createdAt),
    /** Anti-doublon par canal. Ne protège PAS de la double publication (phase 2). */
    uniqBody: uniqueIndex('uniq_items_channel_body').on(t.channel, t.bodyHash),
    byAngle: index('idx_items_angle').on(t.angleId, t.createdAt),
  }),
);

/**
 * DDL de référence pour MariaDB, utilisé par `marketing db:print-ddl`.
 * Écrit à la main plutôt que généré, pour que la revue puisse le lire.
 */
export const DDL = `
CREATE TABLE IF NOT EXISTS content_angles (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  kind            ENUM('clause_abusive','jurisprudence','cas_usage','duel_llm') NOT NULL,
  title           VARCHAR(200) NOT NULL,
  payload         JSON NOT NULL,
  legal_refs      JSON NOT NULL,
  frequency_score INT NOT NULL DEFAULT 0,
  source_kind     ENUM('aggregate','legifrance','manual','public_template') NOT NULL,
  last_used_at    DATETIME NULL,
  status          ENUM('active','retired') NOT NULL DEFAULT 'active',
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_angles_status (status, last_used_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS content_items (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  angle_id          BIGINT UNSIGNED NOT NULL,
  channel           ENUM('linkedin','brevo') NOT NULL,
  format            ENUM('duel','clause','cas_usage') NOT NULL,
  status            ENUM('draft','pending_review','approved','scheduled','published','failed','rejected')
                    NOT NULL DEFAULT 'draft',
  body              TEXT NOT NULL,
  body_hash         CHAR(64) NOT NULL,
  validation_errors JSON NULL,
  review_note       TEXT NULL,
  rejected_reason   ENUM('citation_fausse','ton','angle_faible','redondant','autre') NULL,
  approved_by       VARCHAR(191) NULL,
  approved_at       DATETIME NULL,
  generated_by      VARCHAR(100) NOT NULL,
  edit_count        INT NOT NULL DEFAULT 0,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_items_angle FOREIGN KEY (angle_id) REFERENCES content_angles(id),
  UNIQUE KEY uniq_items_channel_body (channel, body_hash),
  INDEX idx_items_status_created (status, created_at),
  INDEX idx_items_angle (angle_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`.trim();
