/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ISqliteDriver } from './drivers/ISqliteDriver';

/**
 * Migration script definition
 */
export interface IMigration {
  version: number; // Target version after this migration
  name: string; // Migration name for logging
  up: (db: ISqliteDriver) => void; // Upgrade script
  down: (db: ISqliteDriver) => void; // Downgrade script (for rollback)
}

type MigrationConflictDetails = {
  table: string | null;
  columns: string[];
};

const EMPTY_MIGRATION_CONFLICT_DETAILS: MigrationConflictDetails = {
  table: null,
  columns: [],
};

function parseMigrationConflictDetails(message: string): MigrationConflictDetails {
  const uniqueConstraintPrefix = 'UNIQUE constraint failed:';
  if (!message.includes(uniqueConstraintPrefix)) {
    return EMPTY_MIGRATION_CONFLICT_DETAILS;
  }

  const rawTargets = message
    .split(uniqueConstraintPrefix)[1]
    ?.split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  if (!rawTargets?.length) {
    return EMPTY_MIGRATION_CONFLICT_DETAILS;
  }

  const [firstTarget] = rawTargets;
  const table = firstTarget?.includes('.') ? (firstTarget.split('.')[0] ?? null) : null;
  const columns = rawTargets
    .map((item) => (item.includes('.') ? item.split('.').slice(1).join('.') : item))
    .filter(Boolean);

  return {
    table,
    columns,
  };
}

export class DatabaseMigrationError extends Error {
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly failedVersion: number;
  readonly migrationName: string;
  readonly causeMessage: string;
  readonly conflictTable: string | null;
  readonly conflictColumns: string[];

  constructor(params: {
    fromVersion: number;
    toVersion: number;
    failedVersion: number;
    migrationName: string;
    cause: unknown;
  }) {
    const causeMessage = params.cause instanceof Error ? params.cause.message : String(params.cause);
    const conflictDetails = parseMigrationConflictDetails(causeMessage);
    const diagnosticParts = [
      `Migration failed from v${params.fromVersion} to v${params.toVersion} at v${params.failedVersion} (${params.migrationName}).`,
      'Existing database preserved; recovery-as-corruption was skipped.',
      conflictDetails.table ? `Conflict table: ${conflictDetails.table}.` : null,
      conflictDetails.columns.length > 0 ? `Conflict fields: ${conflictDetails.columns.join(', ')}.` : null,
      `Cause: ${causeMessage}`,
    ].filter(Boolean);

    super(diagnosticParts.join(' '));
    this.name = 'DatabaseMigrationError';
    this.fromVersion = params.fromVersion;
    this.toVersion = params.toVersion;
    this.failedVersion = params.failedVersion;
    this.migrationName = params.migrationName;
    this.causeMessage = causeMessage;
    this.conflictTable = conflictDetails.table;
    this.conflictColumns = conflictDetails.columns;
  }
}

export function isDatabaseMigrationError(error: unknown): error is DatabaseMigrationError {
  return error instanceof DatabaseMigrationError;
}

/**
 * Migration v0 -> v1: Initial schema
 * This is handled by initSchema() in schema.ts
 */
const migration_v1: IMigration = {
  version: 1,
  name: 'Initial schema',
  up: (_db) => {
    // Already handled by initSchema()
    console.log('[Migration v1] Initial schema created by initSchema()');
  },
  down: (db) => {
    // Drop all tables (only core tables now)
    db.exec('DROP TABLE IF EXISTS messages');
    db.exec('DROP TABLE IF EXISTS conversations');
    db.exec('DROP TABLE IF EXISTS users');
    console.log('[Migration v1] Rolled back: All tables dropped');
  },
};

/**
 * Migration v1 -> v2: Add indexes for better performance
 * Example of a schema change migration
 */
const migration_v2: IMigration = {
  version: 2,
  name: 'Add performance indexes',
  up: (db) => {
    // Add composite index for conversation messages lookup
    db.exec('CREATE INDEX IF NOT EXISTS idx_messages_conv_created_desc ON messages(conversation_id, created_at DESC)');
    // Add index for message search by type
    db.exec('CREATE INDEX IF NOT EXISTS idx_messages_type_created ON messages(type, created_at DESC)');
    // Add index for user conversations lookup
    db.exec('CREATE INDEX IF NOT EXISTS idx_conversations_user_type ON conversations(user_id, type)');
    console.log('[Migration v2] Added performance indexes');
  },
  down: (db) => {
    db.exec('DROP INDEX IF EXISTS idx_messages_conv_created_desc');
    db.exec('DROP INDEX IF EXISTS idx_messages_type_created');
    db.exec('DROP INDEX IF EXISTS idx_conversations_user_type');
    console.log('[Migration v2] Rolled back: Removed performance indexes');
  },
};

/**
 * Migration v2 -> v3: Add full-text search support [REMOVED]
 *
 * Note: FTS functionality has been removed as it's not currently needed.
 * Will be re-implemented when search functionality is added to the UI.
 */
const migration_v3: IMigration = {
  version: 3,
  name: 'Add full-text search (skipped)',
  up: (_db) => {
    // FTS removed - will be re-added when search functionality is implemented
    console.log('[Migration v3] FTS support skipped (removed, will be added back later)');
  },
  down: (db) => {
    // Clean up FTS table if it exists from older versions
    db.exec('DROP TABLE IF EXISTS messages_fts');
    console.log('[Migration v3] Rolled back: Removed full-text search');
  },
};

/**
 * Migration v3 -> v4: Removed (user_preferences table no longer needed)
 */
const migration_v4: IMigration = {
  version: 4,
  name: 'Removed user_preferences table',
  up: (_db) => {
    // user_preferences table removed from schema
    console.log('[Migration v4] Skipped (user_preferences table removed)');
  },
  down: (_db) => {
    console.log('[Migration v4] Rolled back: No-op (user_preferences table removed)');
  },
};

/**
 * Migration v4 -> v5: Remove FTS table
 * Cleanup for FTS removal - ensures all databases have consistent schema
 */
const migration_v5: IMigration = {
  version: 5,
  name: 'Remove FTS table',
  up: (db) => {
    // Remove FTS table created by old v3 migration
    db.exec('DROP TABLE IF EXISTS messages_fts');
    console.log('[Migration v5] Removed FTS table (cleanup for FTS removal)');
  },
  down: (_db) => {
    // If rolling back, we don't recreate FTS table (it's deprecated)
    console.log('[Migration v5] Rolled back: FTS table remains removed (deprecated feature)');
  },
};

/**
 * Migration v5 -> v6: Add jwt_secret column to users table
 * Store JWT secret per user for better security and management
 */
const migration_v6: IMigration = {
  version: 6,
  name: 'Add jwt_secret to users table',
  up: (db) => {
    // Check if jwt_secret column already exists
    const tableInfo = db.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>;
    const hasJwtSecret = tableInfo.some((col) => col.name === 'jwt_secret');

    if (!hasJwtSecret) {
      // Add jwt_secret column to users table
      db.exec('ALTER TABLE users ADD COLUMN jwt_secret TEXT');
      console.log('[Migration v6] Added jwt_secret column to users table');
    } else {
      console.log('[Migration v6] jwt_secret column already exists, skipping');
    }
  },
  down: (db) => {
    // SQLite doesn't support DROP COLUMN directly, need to recreate table
    db.exec(
      'CREATE TABLE users_backup AS SELECT id, username, email, password_hash, avatar_path, created_at, updated_at, last_login FROM users'
    );
    db.exec('DROP TABLE users');
    db.exec('ALTER TABLE users_backup RENAME TO users');
    db.exec('CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)');
    console.log('[Migration v6] Rolled back: Removed jwt_secret column from users table');
  },
};

/**
 * Migration v6 -> v7: Add Personal Assistant tables
 * Supports remote interaction through messaging platforms (Telegram, Slack, Discord)
 */
const migration_v7: IMigration = {
  version: 7,
  name: 'Add Personal Assistant tables',
  up: (db) => {
    // Assistant plugins configuration
    db.exec(`CREATE TABLE IF NOT EXISTS assistant_plugins (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK(type IN ('telegram', 'slack', 'discord')),
        name TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 0,
        config TEXT NOT NULL,
        status TEXT CHECK(status IN ('created', 'initializing', 'ready', 'starting', 'running', 'stopping', 'stopped', 'error')),
        last_connected INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_assistant_plugins_type ON assistant_plugins(type)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_assistant_plugins_enabled ON assistant_plugins(enabled)');

    // Authorized users whitelist
    db.exec(`CREATE TABLE IF NOT EXISTS assistant_users (
        id TEXT PRIMARY KEY,
        platform_user_id TEXT NOT NULL,
        platform_type TEXT NOT NULL,
        display_name TEXT,
        authorized_at INTEGER NOT NULL,
        last_active INTEGER,
        session_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(platform_user_id, platform_type)
      )`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_assistant_users_platform ON assistant_users(platform_user_id, platform_type)');
    console.log('[Migration v7] Added Personal Assistant tables');
  },
  down: (db) => {
    db.exec('DROP TABLE IF EXISTS assistant_users');
    db.exec('DROP TABLE IF EXISTS assistant_plugins');
    console.log('[Migration v7] Rolled back: Removed Personal Assistant tables');
  },
};

/**
 * Migration v7 -> v8: Add assistant_events table
 */
const migration_v8: IMigration = {
  version: 8,
  name: 'Add assistant events table',
  up: (db) => {
    db.exec(`CREATE TABLE IF NOT EXISTS assistant_events (
      id TEXT PRIMARY KEY,
      assistant_user_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (assistant_user_id) REFERENCES assistant_users(id) ON DELETE CASCADE
    )`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_assistant_events_user_created ON assistant_events(assistant_user_id, created_at DESC)');
    console.log('[Migration v8] Added assistant events table');
  },
  down: (db) => {
    db.exec('DROP TABLE IF EXISTS assistant_events');
    console.log('[Migration v8] Rolled back: Removed assistant events table');
  },
};

/**
 * Migration v8 -> v9: Add settings sync table
 */
const migration_v9: IMigration = {
  version: 9,
  name: 'Add settings sync table',
  up: (db) => {
    db.exec(`CREATE TABLE IF NOT EXISTS settings_sync (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`);
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_settings_sync_user ON settings_sync(user_id)');
    console.log('[Migration v9] Added settings sync table');
  },
  down: (db) => {
    db.exec('DROP TABLE IF EXISTS settings_sync');
    console.log('[Migration v9] Rolled back: Removed settings sync table');
  },
};

/**
 * Migration v9 -> v10: Add extensions registry tables
 */
const migration_v10: IMigration = {
  version: 10,
  name: 'Add extension registry tables',
  up: (db) => {
    db.exec(`CREATE TABLE IF NOT EXISTS extensions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      version TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      manifest_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`);
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_extensions_name ON extensions(name)');
    console.log('[Migration v10] Added extensions registry tables');
  },
  down: (db) => {
    db.exec('DROP TABLE IF EXISTS extensions');
    console.log('[Migration v10] Rolled back: Removed extension registry tables');
  },
};

/**
 * Migration v10 -> v11: Add extension permissions table
 */
const migration_v11: IMigration = {
  version: 11,
  name: 'Add extension permissions table',
  up: (db) => {
    db.exec(`CREATE TABLE IF NOT EXISTS extension_permissions (
      id TEXT PRIMARY KEY,
      extension_id TEXT NOT NULL,
      permission TEXT NOT NULL,
      granted INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (extension_id) REFERENCES extensions(id) ON DELETE CASCADE,
      UNIQUE(extension_id, permission)
    )`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_extension_permissions_extension ON extension_permissions(extension_id)');
    console.log('[Migration v11] Added extension permissions table');
  },
  down: (db) => {
    db.exec('DROP TABLE IF EXISTS extension_permissions');
    console.log('[Migration v11] Rolled back: Removed extension permissions table');
  },
};

/**
 * Migration v11 -> v12: Add workspace snapshots table
 */
const migration_v12: IMigration = {
  version: 12,
  name: 'Add workspace snapshots table',
  up: (db) => {
    db.exec(`CREATE TABLE IF NOT EXISTS workspace_snapshots (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      snapshot_type TEXT NOT NULL,
      content TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    )`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_workspace_snapshots_conversation ON workspace_snapshots(conversation_id)');
    console.log('[Migration v12] Added workspace snapshots table');
  },
  down: (db) => {
    db.exec('DROP TABLE IF EXISTS workspace_snapshots');
    console.log('[Migration v12] Rolled back: Removed workspace snapshots table');
  },
};

/**
 * Migration v12 -> v13: Add assistant resources table
 */
const migration_v13: IMigration = {
  version: 13,
  name: 'Add assistant resources table',
  up: (db) => {
    db.exec(`CREATE TABLE IF NOT EXISTS assistant_resources (
      id TEXT PRIMARY KEY,
      assistant_id TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_path TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_assistant_resources_assistant ON assistant_resources(assistant_id)');
    console.log('[Migration v13] Added assistant resources table');
  },
  down: (db) => {
    db.exec('DROP TABLE IF EXISTS assistant_resources');
    console.log('[Migration v13] Rolled back: Removed assistant resources table');
  },
};

/**
 * Migration v13 -> v14: Add cron metadata columns
 */
const migration_v14: IMigration = {
  version: 14,
  name: 'Add cron metadata columns',
  up: (db) => {
    const columns = new Set((db.pragma('table_info(conversations)') as Array<{ name: string }>).map((c) => c.name));
    if (!columns.has('cron_json')) {
      db.exec('ALTER TABLE conversations ADD COLUMN cron_json TEXT');
    }
    if (!columns.has('cron_status')) {
      db.exec('ALTER TABLE conversations ADD COLUMN cron_status TEXT');
    }
    console.log('[Migration v14] Added cron metadata columns');
  },
  down: (_db) => {
    console.warn('[Migration v14] Rollback skipped: cannot drop columns safely.');
  },
};

/**
 * Migration v14 -> v15: Add remote agents table
 */
const migration_v15: IMigration = {
  version: 15,
  name: 'Add remote agents table',
  up: (db) => {
    db.exec(`CREATE TABLE IF NOT EXISTS remote_agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      protocol TEXT NOT NULL,
      url TEXT NOT NULL,
      auth_type TEXT NOT NULL,
      auth_token TEXT,
      allow_insecure INTEGER NOT NULL DEFAULT 0,
      avatar TEXT,
      description TEXT,
      device_id TEXT,
      status TEXT,
      last_connected_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`);
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_remote_agents_url ON remote_agents(url)');
    console.log('[Migration v15] Added remote agents table');
  },
  down: (db) => {
    db.exec('DROP INDEX IF EXISTS idx_remote_agents_url');
    db.exec('DROP TABLE IF EXISTS remote_agents');
    console.log('[Migration v15] Rolled back: Removed remote agents table');
  },
};

/**
 * Migration v15 -> v16: Add remote agent compatibility columns
 */
const migration_v16: IMigration = {
  version: 16,
  name: 'Add remote agent compatibility columns',
  up: (db) => {
    const columns = new Set((db.pragma('table_info(remote_agents)') as Array<{ name: string }>).map((c) => c.name));
    if (!columns.has('protocol')) {
      db.exec("ALTER TABLE remote_agents ADD COLUMN protocol TEXT NOT NULL DEFAULT 'openclaw'");
    }
    if (!columns.has('url') && columns.has('endpoint')) {
      db.exec('ALTER TABLE remote_agents ADD COLUMN url TEXT');
      db.exec('UPDATE remote_agents SET url = endpoint WHERE url IS NULL');
    }
    if (!columns.has('auth_token') && columns.has('auth_header')) {
      db.exec('ALTER TABLE remote_agents ADD COLUMN auth_token TEXT');
      db.exec('UPDATE remote_agents SET auth_token = auth_header WHERE auth_token IS NULL');
    }
    if (!columns.has('allow_insecure')) {
      db.exec('ALTER TABLE remote_agents ADD COLUMN allow_insecure INTEGER NOT NULL DEFAULT 0');
    }
    if (!columns.has('avatar')) {
      db.exec('ALTER TABLE remote_agents ADD COLUMN avatar TEXT');
    }
    if (!columns.has('description')) {
      db.exec('ALTER TABLE remote_agents ADD COLUMN description TEXT');
    }
    if (!columns.has('device_id') && columns.has('device_name')) {
      db.exec('ALTER TABLE remote_agents ADD COLUMN device_id TEXT');
      db.exec('UPDATE remote_agents SET device_id = device_name WHERE device_id IS NULL');
    }
    if (!columns.has('status')) {
      db.exec('ALTER TABLE remote_agents ADD COLUMN status TEXT');
    }
    if (!columns.has('last_connected_at') && columns.has('last_connected')) {
      db.exec('ALTER TABLE remote_agents ADD COLUMN last_connected_at INTEGER');
      db.exec('UPDATE remote_agents SET last_connected_at = last_connected WHERE last_connected_at IS NULL');
    }
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_remote_agents_url ON remote_agents(url)');
    console.log('[Migration v16] Added remote agent compatibility columns');
  },
  down: (_db) => {
    console.warn('[Migration v16] Rollback skipped: cannot drop columns safely.');
  },
};

/**
 * Migration v16 -> v17: Add remote agent device identity columns
 */
const migration_v17: IMigration = {
  version: 17,
  name: 'Add remote agent device identity columns',
  up: (db) => {
    const columns = new Set((db.pragma('table_info(remote_agents)') as Array<{ name: string }>).map((c) => c.name));
    if (!columns.has('device_public_key')) {
      db.exec('ALTER TABLE remote_agents ADD COLUMN device_public_key TEXT');
    }
    if (!columns.has('device_private_key')) {
      db.exec('ALTER TABLE remote_agents ADD COLUMN device_private_key TEXT');
    }
    if (!columns.has('device_token')) {
      db.exec('ALTER TABLE remote_agents ADD COLUMN device_token TEXT');
    }
    console.log('[Migration v17] Added device identity columns to remote_agents');
  },
  down: (_db) => {
    // SQLite does not support DROP COLUMN before 3.35.0; skip rollback to prevent data loss.
    console.warn('[Migration v17] Rollback skipped: cannot drop columns safely.');
  },
};

/**
 * Migration v17 -> v18: Add turn snapshot tables
 */
const migration_v18: IMigration = {
  version: 18,
  name: 'Add conversation turn snapshot tables',
  up: (db) => {
    db.exec(`CREATE TABLE IF NOT EXISTS conversation_turns (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      backend TEXT NOT NULL,
      request_msg_id TEXT,
      started_at INTEGER NOT NULL,
      completed_at INTEGER NOT NULL,
      completion_signal TEXT NOT NULL,
      completion_source TEXT,
      review_status TEXT NOT NULL CHECK(review_status IN ('pending', 'kept', 'reverted', 'conflict', 'unsupported', 'failed')),
      file_count INTEGER NOT NULL DEFAULT 0,
      source_message_ids TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    )`);

    db.exec(`CREATE TABLE IF NOT EXISTS conversation_turn_files (
      id TEXT PRIMARY KEY,
      turn_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_name TEXT NOT NULL,
      action TEXT NOT NULL CHECK(action IN ('create', 'update', 'delete')),
      before_exists INTEGER NOT NULL,
      after_exists INTEGER NOT NULL,
      before_hash TEXT,
      after_hash TEXT,
      before_content TEXT,
      after_content TEXT,
      unified_diff TEXT NOT NULL,
      source_message_ids TEXT NOT NULL,
      revert_supported INTEGER NOT NULL DEFAULT 1,
      revert_error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (turn_id) REFERENCES conversation_turns(id) ON DELETE CASCADE,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    )`);

    db.exec(
      'CREATE INDEX IF NOT EXISTS idx_turns_conversation_completed ON conversation_turns(conversation_id, completed_at DESC)'
    );
    db.exec('CREATE INDEX IF NOT EXISTS idx_turn_files_turn_id ON conversation_turn_files(turn_id)');
    db.exec(
      'CREATE INDEX IF NOT EXISTS idx_turn_files_conversation_path ON conversation_turn_files(conversation_id, file_path)'
    );

    console.log('[Migration v18] Added turn snapshot tables');
  },
  down: (db) => {
    db.exec('DROP INDEX IF EXISTS idx_turn_files_conversation_path');
    db.exec('DROP INDEX IF EXISTS idx_turn_files_turn_id');
    db.exec('DROP INDEX IF EXISTS idx_turns_conversation_completed');
    db.exec('DROP TABLE IF EXISTS conversation_turn_files');
    db.exec('DROP TABLE IF EXISTS conversation_turns');
    console.log('[Migration v18] Rolled back: Removed turn snapshot tables');
  },
};

/**
 * Migration v18 -> v19: Support running turn snapshots and per-file upsert
 */
const migration_v19: IMigration = {
  version: 19,
  name: 'Upgrade turn snapshot tables for live aggregation',
  up: (db) => {
    const duplicateGroupResult = db
      .prepare(`
        SELECT COUNT(*) as count
        FROM (
          SELECT turn_id, file_path
          FROM conversation_turn_files
          GROUP BY turn_id, file_path
          HAVING COUNT(*) > 1
        )
      `)
      .get() as { count: number };
    const duplicateRowsResult = db
      .prepare(`
        SELECT COALESCE(SUM(duplicate_count - 1), 0) as count
        FROM (
          SELECT COUNT(*) as duplicate_count
          FROM conversation_turn_files
          GROUP BY turn_id, file_path
          HAVING COUNT(*) > 1
        )
      `)
      .get() as { count: number };

    if (duplicateGroupResult.count > 0) {
      console.warn(
        `[Migration v19] Deduplicating conversation_turn_files before adding unique index: ${duplicateGroupResult.count} duplicate group(s), ${duplicateRowsResult.count} row(s) removed`
      );
    }

    db.exec(`
      CREATE TABLE IF NOT EXISTS conversation_turns_v19 (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        backend TEXT NOT NULL,
        request_msg_id TEXT,
        started_at INTEGER NOT NULL,
        completed_at INTEGER,
        completion_signal TEXT,
        completion_source TEXT,
        lifecycle_status TEXT NOT NULL CHECK(lifecycle_status IN ('running', 'completed', 'interrupted')),
        review_status TEXT NOT NULL CHECK(review_status IN ('pending', 'kept', 'reverted', 'conflict', 'unsupported', 'failed')),
        file_count INTEGER NOT NULL DEFAULT 0,
        source_message_ids TEXT NOT NULL,
        last_activity_at INTEGER NOT NULL,
        auto_kept_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      )
    `);

    db.exec(`
      INSERT INTO conversation_turns_v19 (
        id,
        conversation_id,
        backend,
        request_msg_id,
        started_at,
        completed_at,
        completion_signal,
        completion_source,
        lifecycle_status,
        review_status,
        file_count,
        source_message_ids,
        last_activity_at,
        auto_kept_at,
        created_at,
        updated_at
      )
      SELECT
        id,
        conversation_id,
        backend,
        request_msg_id,
        started_at,
        completed_at,
        completion_signal,
        completion_source,
        'completed',
        review_status,
        file_count,
        source_message_ids,
        COALESCE(completed_at, started_at),
        NULL,
        created_at,
        updated_at
      FROM conversation_turns
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS conversation_turn_files_v19_dedup (
        id TEXT PRIMARY KEY,
        turn_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        file_path TEXT NOT NULL,
        file_name TEXT NOT NULL,
        action TEXT NOT NULL CHECK(action IN ('create', 'update', 'delete')),
        before_exists INTEGER NOT NULL,
        after_exists INTEGER NOT NULL,
        before_hash TEXT,
        after_hash TEXT,
        before_content TEXT,
        after_content TEXT,
        unified_diff TEXT NOT NULL,
        source_message_ids TEXT NOT NULL,
        revert_supported INTEGER NOT NULL DEFAULT 1,
        revert_error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (turn_id) REFERENCES conversation_turns_v19(id) ON DELETE CASCADE,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      )
    `);

    db.exec(`
      INSERT INTO conversation_turn_files_v19_dedup (
        id,
        turn_id,
        conversation_id,
        file_path,
        file_name,
        action,
        before_exists,
        after_exists,
        before_hash,
        after_hash,
        before_content,
        after_content,
        unified_diff,
        source_message_ids,
        revert_supported,
        revert_error,
        created_at,
        updated_at
      )
      SELECT
        id,
        turn_id,
        conversation_id,
        file_path,
        file_name,
        action,
        before_exists,
        after_exists,
        before_hash,
        after_hash,
        before_content,
        after_content,
        unified_diff,
        source_message_ids,
        revert_supported,
        revert_error,
        created_at,
        updated_at
      FROM (
        SELECT
          *,
          ROW_NUMBER() OVER (
            PARTITION BY turn_id, file_path
            ORDER BY updated_at DESC, created_at DESC, id DESC
          ) AS row_number
        FROM conversation_turn_files
      ) ranked_turn_files
      WHERE row_number = 1
    `);

    db.exec('DROP INDEX IF EXISTS idx_turns_conversation_completed');
    db.exec('DROP INDEX IF EXISTS idx_turn_files_turn_id');
    db.exec('DROP INDEX IF EXISTS idx_turn_files_conversation_path');
    db.exec('DROP INDEX IF EXISTS idx_turn_files_turn_path');
    db.exec('ALTER TABLE conversation_turns RENAME TO conversation_turns_v18_backup');
    db.exec('ALTER TABLE conversation_turn_files RENAME TO conversation_turn_files_v18_backup');
    db.exec('ALTER TABLE conversation_turns_v19 RENAME TO conversation_turns');
    db.exec('ALTER TABLE conversation_turn_files_v19_dedup RENAME TO conversation_turn_files');
    db.exec('DROP TABLE IF EXISTS conversation_turns_v18_backup');
    db.exec('DROP TABLE IF EXISTS conversation_turn_files_v18_backup');

    db.exec(
      'CREATE INDEX IF NOT EXISTS idx_turns_conversation_completed ON conversation_turns(conversation_id, COALESCE(completed_at, last_activity_at, started_at) DESC)'
    );
    db.exec('CREATE INDEX IF NOT EXISTS idx_turn_files_turn_id ON conversation_turn_files(turn_id)');
    db.exec(
      'CREATE INDEX IF NOT EXISTS idx_turn_files_conversation_path ON conversation_turn_files(conversation_id, file_path)'
    );
    db.exec(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_turn_files_turn_path ON conversation_turn_files(turn_id, file_path)'
    );

    console.log('[Migration v19] Upgraded turn snapshot tables for live aggregation');
  },
  down: (_db) => {
    console.warn('[Migration v19] Rollback skipped: would require lossy turn snapshot downgrade.');
  },
};

const migration_v20: IMigration = {
  version: 20,
  name: 'Add team run and task tables',
  up: (db) => {
    db.exec(`CREATE TABLE IF NOT EXISTS team_runs (
      id TEXT PRIMARY KEY,
      main_conversation_id TEXT NOT NULL,
      root_conversation_id TEXT NOT NULL,
      status TEXT NOT NULL,
      current_phase TEXT NOT NULL,
      awaiting_user_input INTEGER NOT NULL DEFAULT 0,
      active_task_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (main_conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (root_conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    )`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_team_runs_main ON team_runs(main_conversation_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_team_runs_status ON team_runs(status)');

    db.exec(`CREATE TABLE IF NOT EXISTS team_tasks (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      parent_conversation_id TEXT NOT NULL,
      sub_conversation_id TEXT,
      assistant_id TEXT,
      assistant_name TEXT,
      status TEXT NOT NULL,
      title TEXT NOT NULL,
      task_prompt TEXT NOT NULL,
      expected_output TEXT,
      selection_mode TEXT NOT NULL,
      selection_reason TEXT,
      owned_paths_json TEXT NOT NULL,
      last_error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (run_id) REFERENCES team_runs(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (sub_conversation_id) REFERENCES conversations(id) ON DELETE SET NULL
    )`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_team_tasks_run ON team_tasks(run_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_team_tasks_parent ON team_tasks(parent_conversation_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_team_tasks_sub ON team_tasks(sub_conversation_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_team_tasks_status ON team_tasks(status)');

    console.log('[Migration v20] Added team run and task tables');
  },
  down: (db) => {
    db.exec('DROP INDEX IF EXISTS idx_team_tasks_status');
    db.exec('DROP INDEX IF EXISTS idx_team_tasks_sub');
    db.exec('DROP INDEX IF EXISTS idx_team_tasks_parent');
    db.exec('DROP INDEX IF EXISTS idx_team_tasks_run');
    db.exec('DROP TABLE IF EXISTS team_tasks');
    db.exec('DROP INDEX IF EXISTS idx_team_runs_status');
    db.exec('DROP INDEX IF EXISTS idx_team_runs_main');
    db.exec('DROP TABLE IF EXISTS team_runs');
    console.log('[Migration v20] Rolled back: Removed team run and task tables');
  },
};

const migration_v21: IMigration = {
  version: 21,
  name: 'Add team task binding and recovery columns',
  up: (db) => {
    const columns = new Set((db.pragma('table_info(team_tasks)') as Array<{ name: string }>).map((c) => c.name));
    if (!columns.has('assistant_binding_json')) {
      db.exec('ALTER TABLE team_tasks ADD COLUMN assistant_binding_json TEXT');
    }
    if (!columns.has('display_alias')) {
      db.exec('ALTER TABLE team_tasks ADD COLUMN display_alias TEXT');
    }
    if (!columns.has('trigger_source')) {
      db.exec('ALTER TABLE team_tasks ADD COLUMN trigger_source TEXT');
    }
    if (!columns.has('requested_by_message_id')) {
      db.exec('ALTER TABLE team_tasks ADD COLUMN requested_by_message_id TEXT');
    }
    if (!columns.has('resume_count')) {
      db.exec('ALTER TABLE team_tasks ADD COLUMN resume_count INTEGER NOT NULL DEFAULT 0');
    }
    console.log('[Migration v21] Added team task binding and recovery columns');
  },
  down: (_db) => {
    console.warn('[Migration v21] Rollback skipped: cannot drop columns safely.');
  },
};

/**
 * All migrations in order
 */
// prettier-ignore
export const ALL_MIGRATIONS: IMigration[] = [
  migration_v1, migration_v2, migration_v3, migration_v4, migration_v5, migration_v6,
  migration_v7, migration_v8, migration_v9, migration_v10, migration_v11, migration_v12,
  migration_v13, migration_v14, migration_v15, migration_v16, migration_v17, migration_v18,
  migration_v19, migration_v20, migration_v21,
];

/**
 * Get migrations needed to upgrade from one version to another
 */
export function getMigrationsToRun(fromVersion: number, toVersion: number): IMigration[] {
  return ALL_MIGRATIONS.filter((m) => m.version > fromVersion && m.version <= toVersion).toSorted(
    (a, b) => a.version - b.version
  );
}

/**
 * Get migrations needed to downgrade from one version to another
 */
export function getMigrationsToRollback(fromVersion: number, toVersion: number): IMigration[] {
  return ALL_MIGRATIONS.filter((m) => m.version <= fromVersion && m.version > toVersion).toSorted(
    (a, b) => b.version - a.version
  );
}

/**
 * Run database migrations
 */
export function runMigrations(db: ISqliteDriver, fromVersion: number, toVersion: number): void {
  if (fromVersion === toVersion) {
    console.log(`[Migrations] Database already at version ${toVersion}, no migrations needed`);
    return;
  }

  if (fromVersion < toVersion) {
    const migrations = getMigrationsToRun(fromVersion, toVersion);
    console.log(`[Migrations] Upgrading database from v${fromVersion} to v${toVersion}`);

    for (const migration of migrations) {
      console.log(`[Migrations] Running migration v${migration.version}: ${migration.name}`);
      try {
        migration.up(db);
        db.pragma(`user_version = ${migration.version}`);
        console.log(`[Migrations] ✓ Migration v${migration.version} completed`);
      } catch (error) {
        console.error(`[Migrations] ✗ Migration v${migration.version} failed:`, error);
        throw new DatabaseMigrationError({
          fromVersion,
          toVersion,
          failedVersion: migration.version,
          migrationName: migration.name,
          cause: error,
        });
      }
    }
  } else {
    const migrations = getMigrationsToRollback(fromVersion, toVersion);
    console.log(`[Migrations] Downgrading database from v${fromVersion} to v${toVersion}`);

    for (const migration of migrations) {
      console.log(`[Migrations] Rolling back migration v${migration.version}: ${migration.name}`);
      try {
        migration.down(db);
        db.pragma(`user_version = ${migration.version - 1}`);
        console.log(`[Migrations] ✓ Rollback v${migration.version} completed`);
      } catch (error) {
        console.error(`[Migrations] ✗ Rollback v${migration.version} failed:`, error);
        throw error;
      }
    }
  }
}

export function rollbackMigrations(db: ISqliteDriver, fromVersion: number, toVersion: number): void {
  runMigrations(db, fromVersion, toVersion);
}

export function getMigrationHistory(fromVersion: number, toVersion: number): IMigration[] {
  if (fromVersion === toVersion) return [];
  return fromVersion < toVersion
    ? getMigrationsToRun(fromVersion, toVersion)
    : getMigrationsToRollback(fromVersion, toVersion);
}

export function isMigrationApplied(version: number, currentVersion: number): boolean {
  return version <= currentVersion;
}
