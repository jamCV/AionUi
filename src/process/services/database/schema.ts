/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ISqliteDriver } from './drivers/ISqliteDriver';

/**
 * Initialize database schema with all tables and indexes
 */
export function initSchema(db: ISqliteDriver): void {
  // Enable foreign keys
  db.pragma('foreign_keys = ON');
  // Wait up to 5 seconds when the database is locked by another connection
  // instead of failing immediately (prevents "database is locked" errors
  // when multiple processes or startup tasks access the database concurrently)
  db.pragma('busy_timeout = 5000');
  // Enable Write-Ahead Logging for better performance
  try {
    db.pragma('journal_mode = WAL');
  } catch (error) {
    console.warn('[Database] Failed to enable WAL mode, using default journal mode:', error);
    // Continue with default journal mode if WAL fails
  }

  // Users table (账户系统)
  db.exec(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE,
    password_hash TEXT NOT NULL,
    avatar_path TEXT,
    jwt_secret TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    last_login INTEGER
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)');

  // Conversations table (会话表 - 存储TChatConversation)
  db.exec(`CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('gemini', 'acp', 'codex', 'openclaw-gateway', 'nanobot', 'remote')),
    extra TEXT NOT NULL,
    model TEXT,
    status TEXT CHECK(status IN ('pending', 'running', 'finished')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_conversations_type ON conversations(type)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_conversations_user_updated ON conversations(user_id, updated_at DESC)');

  // Messages table (消息表 - 存储TMessage)
  db.exec(`CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    msg_id TEXT,
    type TEXT NOT NULL,
    content TEXT NOT NULL,
    position TEXT CHECK(position IN ('left', 'right', 'center', 'pop')),
    status TEXT CHECK(status IN ('finish', 'pending', 'error', 'work')),
    created_at INTEGER NOT NULL,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_messages_type ON messages(type)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_messages_msg_id ON messages(msg_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON messages(conversation_id, created_at)');

  db.exec(`CREATE TABLE IF NOT EXISTS conversation_turns (
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
  )`);
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_turns_conversation_completed ON conversation_turns(conversation_id, COALESCE(completed_at, last_activity_at, started_at) DESC)'
  );

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
    UNIQUE(turn_id, file_path),
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_turn_files_turn_id ON conversation_turn_files(turn_id)');
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_turn_files_conversation_path ON conversation_turn_files(conversation_id, file_path)'
  );

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
    assistant_binding_json TEXT,
    display_alias TEXT,
    trigger_source TEXT,
    requested_by_message_id TEXT,
    resume_count INTEGER NOT NULL DEFAULT 0,
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

  console.log('[Database] Schema initialized successfully');
}

/**
 * Get database version for migration tracking
 * Uses SQLite's built-in user_version pragma
 */
export function getDatabaseVersion(db: ISqliteDriver): number {
  try {
    const result = db.pragma('user_version', { simple: true }) as number;
    return result;
  } catch {
    return 0;
  }
}

/**
 * Set database version
 * Uses SQLite's built-in user_version pragma
 */
export function setDatabaseVersion(db: ISqliteDriver, version: number): void {
  db.pragma(`user_version = ${version}`);
}

/**
 * Current database schema version
 * Update this when adding new migrations in migrations.ts
 */
export const CURRENT_DB_VERSION = 21;
