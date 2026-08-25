/**
 * Schéma Drizzle / MariaDB.
 *
 * Phase 1 : `content_angles` et `content_items`.
 * Phase 2 ajoute les colonnes de diffusion, `publish_attempts` et `oauth_tokens`.
 * `channel_capabilities` n'est toujours pas créée : LinkedIn n'a pas d'audit
 * préalable, donc la table n'aurait qu'une ligne constante. Elle arrivera avec le
 * premier canal qui en a besoin.
 *
 * Deux garde-fous vivent dans le schéma plutôt que dans le code :
 *  - `uniq_items_channel_external` : une URN de post ne peut appartenir qu'à un
 *    item, ce qui transforme un double post en erreur de contrainte ;
 *  - `publish_attempts.started_at` non nul avec `finished_at` nul : une ligne dans
 *    cet état est un appel réseau parti sans réponse connue.
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
import {
  ANGLE_KINDS,
  ANGLE_SOURCE_KINDS,
  CHANNELS,
  ERROR_CLASSES,
  FORMATS,
  REJECT_REASONS,
  STATUSES,
} from '../domain/types.ts';

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
    // --- diffusion (phase 2) ---
    scheduledAt: datetime('scheduled_at'),
    publishedAt: datetime('published_at'),
    externalId: varchar('external_id', { length: 191 }),
    publishMode: mysqlEnum('publish_mode', ['direct', 'draft']),
    attemptCount: int('attempt_count').notNull().default(0),
    /** Bail de publication : le claim ne change pas le statut. */
    lockedBy: varchar('locked_by', { length: 191 }),
    leaseUntil: datetime('lease_until'),
    version: int('version').notNull().default(0),
    createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => ({
    /** La requête de la file : les items en attente, les plus anciens d'abord. */
    byStatus: index('idx_items_status_created').on(t.status, t.createdAt),
    /** Anti-doublon par canal. Ne protège PAS de la double publication (phase 2). */
    uniqBody: uniqueIndex('uniq_items_channel_body').on(t.channel, t.bodyHash),
    byAngle: index('idx_items_angle').on(t.angleId, t.createdAt),
    /** Requête du tick : statut publiable, heure due, bail libre. */
    byDue: index('idx_items_due').on(t.channel, t.status, t.scheduledAt),
    /** Quota quotidien. */
    byPublished: index('idx_items_published').on(t.channel, t.publishedAt),
    /** Une URN ne peut appartenir qu'à un item : garde-fou contre le double post. */
    uniqExternal: uniqueIndex('uniq_items_channel_external').on(t.channel, t.externalId),
  }),
);

export const publishAttempts = mysqlTable(
  'publish_attempts',
  {
    id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
    contentItemId: bigint('content_item_id', { mode: 'number' }).notNull(),
    adapter: varchar('adapter', { length: 40 }).notNull(),
    attemptNo: int('attempt_no').notNull(),
    /** Écrite AVANT l'appel réseau : une ligne sans `finished_at` est un appel perdu. */
    startedAt: datetime('started_at').notNull(),
    finishedAt: datetime('finished_at'),
    responseCode: int('response_code'),
    errorClass: mysqlEnum('error_class', ERROR_CLASSES),
    errorDetail: text('error_detail'),
    degraded: int('degraded').notNull().default(0),
    externalId: varchar('external_id', { length: 191 }),
  },
  (t) => ({
    byItem: index('idx_attempts_item').on(t.contentItemId, t.attemptNo),
  }),
);

export const oauthTokens = mysqlTable(
  'oauth_tokens',
  {
    provider: varchar('provider', { length: 40 }).primaryKey(),
    accountRef: varchar('account_ref', { length: 191 }).notNull(),
    /** Chiffrés AES-256-GCM. IV et tag stockés à part, jamais dans le chiffré. */
    accessCiphertext: text('access_ciphertext').notNull(),
    accessIv: varchar('access_iv', { length: 32 }).notNull(),
    accessTag: varchar('access_tag', { length: 32 }).notNull(),
    refreshCiphertext: text('refresh_ciphertext'),
    refreshIv: varchar('refresh_iv', { length: 32 }),
    refreshTag: varchar('refresh_tag', { length: 32 }),
    /** Sans version de clé, la rotation de MARKETING_TOKEN_KEY est impossible. */
    keyVersion: int('key_version').notNull(),
    accessExpiresAt: datetime('access_expires_at').notNull(),
    refreshExpiresAt: datetime('refresh_expires_at'),
    scopes: json('scopes').notNull(),
    status: mysqlEnum('token_status', ['active', 'expiring', 'expired', 'revoked'])
      .notNull()
      .default('active'),
    lastRefreshedAt: datetime('last_refreshed_at'),
    alertLevel: int('alert_level').notNull().default(0),
    lastAlertAt: datetime('last_alert_at'),
  },
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

/** Migration additive de la phase 2. Aucune colonne existante n'est modifiée. */
export const DDL_PHASE2 = `
ALTER TABLE content_items
  ADD COLUMN scheduled_at  DATETIME NULL,
  ADD COLUMN published_at  DATETIME NULL,
  ADD COLUMN external_id   VARCHAR(191) NULL,
  ADD COLUMN publish_mode  ENUM('direct','draft') NULL,
  ADD COLUMN attempt_count INT NOT NULL DEFAULT 0,
  ADD COLUMN locked_by     VARCHAR(191) NULL,
  ADD COLUMN lease_until   DATETIME NULL,
  ADD COLUMN version       INT NOT NULL DEFAULT 0,
  ADD INDEX idx_items_due (channel, status, scheduled_at),
  ADD INDEX idx_items_published (channel, published_at),
  ADD UNIQUE KEY uniq_items_channel_external (channel, external_id);

CREATE TABLE IF NOT EXISTS publish_attempts (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  content_item_id BIGINT UNSIGNED NOT NULL,
  adapter         VARCHAR(40) NOT NULL,
  attempt_no      INT NOT NULL,
  started_at      DATETIME NOT NULL,
  finished_at     DATETIME NULL,
  response_code   INT NULL,
  error_class     ENUM('auth','rate_limit','validation','network','platform','unknown') NULL,
  error_detail    TEXT NULL,
  degraded        TINYINT(1) NOT NULL DEFAULT 0,
  external_id     VARCHAR(191) NULL,
  CONSTRAINT fk_attempts_item FOREIGN KEY (content_item_id) REFERENCES content_items(id),
  INDEX idx_attempts_item (content_item_id, attempt_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS oauth_tokens (
  provider           VARCHAR(40) NOT NULL PRIMARY KEY,
  account_ref        VARCHAR(191) NOT NULL,
  access_ciphertext  TEXT NOT NULL,
  access_iv          VARCHAR(32) NOT NULL,
  access_tag         VARCHAR(32) NOT NULL,
  refresh_ciphertext TEXT NULL,
  refresh_iv         VARCHAR(32) NULL,
  refresh_tag        VARCHAR(32) NULL,
  key_version        INT NOT NULL,
  access_expires_at  DATETIME NOT NULL,
  refresh_expires_at DATETIME NULL,
  scopes             JSON NOT NULL,
  token_status       ENUM('active','expiring','expired','revoked') NOT NULL DEFAULT 'active',
  last_refreshed_at  DATETIME NULL,
  alert_level        INT NOT NULL DEFAULT 0,
  last_alert_at      DATETIME NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`.trim();
