/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  IUser,
  IMessageRow,
  IConversationRow,
  CreateTurnSnapshotInput,
  TurnSnapshotFileRow,
  TurnSnapshotRow,
} from '../../../../src/process/services/database/types';
import type { IStatement, ISqliteDriver } from '../../../../src/process/services/database/drivers/ISqliteDriver';
import { DatabaseMigrationError } from '../../../../src/process/services/database/migrations';
import { CURRENT_DB_VERSION } from '../../../../src/process/services/database/schema';

const { createDriverMock } = vi.hoisted(() => ({
  createDriverMock: vi.fn<(_: string) => Promise<ISqliteDriver>>(),
}));

vi.mock('../../../../src/process/services/database/drivers/createDriver', () => ({
  createDriver: createDriverMock,
}));

import { AionUIDatabase } from '../../../../src/process/services/database';

const SYSTEM_USER_ID = 'system_default_user';
const tempDirectories = new Set<string>();

const LEGACY_TURN_COLUMNS = [
  'id',
  'conversation_id',
  'backend',
  'request_msg_id',
  'started_at',
  'completed_at',
  'completion_signal',
  'completion_source',
  'review_status',
  'file_count',
  'source_message_ids',
  'created_at',
  'updated_at',
];

const MALFORMED_LEGACY_TURN_COLUMNS = LEGACY_TURN_COLUMNS.filter((column) => column !== 'source_message_ids');

const CURRENT_TURN_COLUMNS = [
  'id',
  'conversation_id',
  'backend',
  'request_msg_id',
  'started_at',
  'completed_at',
  'completion_signal',
  'completion_source',
  'lifecycle_status',
  'review_status',
  'file_count',
  'source_message_ids',
  'last_activity_at',
  'auto_kept_at',
  'created_at',
  'updated_at',
];

const TURN_FILE_COLUMNS = [
  'id',
  'turn_id',
  'conversation_id',
  'file_path',
  'file_name',
  'action',
  'before_exists',
  'after_exists',
  'before_hash',
  'after_hash',
  'before_content',
  'after_content',
  'unified_diff',
  'source_message_ids',
  'revert_supported',
  'revert_error',
  'created_at',
  'updated_at',
];

type DriverOptions = {
  malformedTurnSchema?: boolean;
};

type TempDatabaseHandle = {
  tempDir: string;
  dbPath: string;
};

type LegacyTurnFileSeed = {
  id: string;
  filePath: string;
  fileName: string;
  beforeContent: string;
  afterContent: string;
  createdAt: number;
  updatedAt: number;
};

type DriverState = {
  users: Map<string, IUser>;
  conversations: Map<string, IConversationRow>;
  messages: Map<string, IMessageRow>;
  turns: Map<string, TurnSnapshotRow>;
  turnFiles: Map<string, TurnSnapshotFileRow>;
  stagedTurns: Map<string, TurnSnapshotRow>;
  stagedTurnFiles: Map<string, TurnSnapshotFileRow>;
  backupTurns: Map<string, TurnSnapshotRow>;
  backupTurnFiles: Map<string, TurnSnapshotFileRow>;
  tables: Set<string>;
  indexes: Set<string>;
  tableColumns: Record<string, string[]>;
  userVersion: number;
};

function cloneMapValues<T extends object>(source: Map<string, T>): Map<string, T> {
  return new Map([...source.entries()].map(([key, value]) => [key, { ...value }]));
}

function cloneTableColumns(source: Record<string, string[]>): Record<string, string[]> {
  return Object.fromEntries(Object.entries(source).map(([key, value]) => [key, [...value]]));
}

class MigrationRegressionDriver implements ISqliteDriver {
  readonly users = new Map<string, IUser>();
  readonly conversations = new Map<string, IConversationRow>();
  readonly messages = new Map<string, IMessageRow>();
  readonly turns = new Map<string, TurnSnapshotRow>();
  readonly turnFiles = new Map<string, TurnSnapshotFileRow>();
  readonly tables = new Set<string>();
  readonly indexes = new Set<string>();
  readonly tableColumns: Record<string, string[]> = {};

  private stagedTurns = new Map<string, TurnSnapshotRow>();
  private stagedTurnFiles = new Map<string, TurnSnapshotFileRow>();
  private backupTurns = new Map<string, TurnSnapshotRow>();
  private backupTurnFiles = new Map<string, TurnSnapshotFileRow>();
  private userVersion = 18;

  constructor(private readonly options: DriverOptions = {}) {
    this.seedLegacySchema();
  }

  seedHistoricalConversation(): void {
    this.users.set(SYSTEM_USER_ID, {
      id: SYSTEM_USER_ID,
      username: SYSTEM_USER_ID,
      password_hash: '',
      created_at: 1,
      updated_at: 1,
      email: undefined,
      avatar_path: undefined,
      jwt_secret: null,
      last_login: null,
    });

    this.conversations.set('conversation-1', {
      id: 'conversation-1',
      user_id: SYSTEM_USER_ID,
      name: 'Historical Conversation',
      type: 'codex',
      extra: JSON.stringify({ backend: 'codex', workspace: '/workspace' }),
      model: undefined,
      status: 'finished',
      source: 'aionui',
      channel_chat_id: undefined,
      created_at: 1,
      updated_at: 2,
    });

    this.messages.set('message-1', {
      id: 'message-1',
      conversation_id: 'conversation-1',
      msg_id: 'msg-1',
      type: 'text',
      content: JSON.stringify({ text: 'hello' }),
      position: 'right',
      status: 'finish',
      created_at: 3,
    });
  }

  seedLegacyTurnSnapshot(files: LegacyTurnFileSeed[]): void {
    this.turns.set('turn-1', {
      id: 'turn-1',
      conversation_id: 'conversation-1',
      backend: 'codex',
      request_msg_id: 'request-1',
      started_at: 10,
      completed_at: 20,
      completion_signal: 'finish',
      completion_source: 'end_turn',
      lifecycle_status: 'completed',
      review_status: 'pending',
      file_count: files.length,
      source_message_ids: '["message-1"]',
      last_activity_at: 20,
      auto_kept_at: null,
      created_at: 10,
      updated_at: 20,
    });

    for (const file of files) {
      this.turnFiles.set(file.id, {
        id: file.id,
        turn_id: 'turn-1',
        conversation_id: 'conversation-1',
        file_path: file.filePath,
        file_name: file.fileName,
        action: 'update',
        before_exists: 1,
        after_exists: 1,
        before_hash: null,
        after_hash: null,
        before_content: file.beforeContent,
        after_content: file.afterContent,
        unified_diff: '@@ -1 +1 @@',
        source_message_ids: '["message-1"]',
        revert_supported: 1,
        revert_error: null,
        created_at: file.createdAt,
        updated_at: file.updatedAt,
      });
    }
  }

  getUserVersion(): number {
    return this.userVersion;
  }

  prepare(sql: string): IStatement {
    const normalizedSql = sql.replace(/\s+/g, ' ').trim();

    if (normalizedSql.startsWith('INSERT OR IGNORE INTO users')) {
      return {
        get: () => undefined,
        all: () => [],
        run: (...args) => {
          const userId = String(args[0]);
          if (!this.users.has(userId)) {
            this.users.set(userId, {
              id: userId,
              username: String(args[1]),
              password_hash: String(args[2]),
              created_at: Number(args[3]),
              updated_at: Number(args[4]),
              email: undefined,
              avatar_path: undefined,
              jwt_secret: null,
              last_login: null,
            });
          }

          return { changes: 1, lastInsertRowid: 1 };
        },
      };
    }

    if (normalizedSql === 'SELECT * FROM users WHERE id = ?') {
      return {
        get: (...args) => this.users.get(String(args[0])),
        all: () => [],
        run: () => ({ changes: 0, lastInsertRowid: 0 }),
      };
    }

    if (normalizedSql === 'SELECT COUNT(*) as count FROM conversations WHERE user_id = ?') {
      return {
        get: (...args) => ({
          count: [...this.conversations.values()].filter((row) => row.user_id === String(args[0])).length,
        }),
        all: () => [],
        run: () => ({ changes: 0, lastInsertRowid: 0 }),
      };
    }

    if (normalizedSql.includes('FROM conversations') && normalizedSql.includes('WHERE user_id = ?')) {
      return {
        get: () => undefined,
        all: (...args) =>
          [...this.conversations.values()]
            .filter((row) => row.user_id === String(args[0]))
            .toSorted((left, right) => right.updated_at - left.updated_at)
            .slice(Number(args[2]), Number(args[2]) + Number(args[1])),
        run: () => ({ changes: 0, lastInsertRowid: 0 }),
      };
    }

    if (normalizedSql === 'SELECT COUNT(*) as count FROM messages WHERE conversation_id = ?') {
      return {
        get: (...args) => ({
          count: [...this.messages.values()].filter((row) => row.conversation_id === String(args[0])).length,
        }),
        all: () => [],
        run: () => ({ changes: 0, lastInsertRowid: 0 }),
      };
    }

    if (normalizedSql.includes('FROM messages') && normalizedSql.includes('WHERE conversation_id = ?')) {
      return {
        get: () => undefined,
        all: (...args) => {
          const order = normalizedSql.includes('ORDER BY created_at DESC') ? 'DESC' : 'ASC';
          const rows = [...this.messages.values()]
            .filter((row) => row.conversation_id === String(args[0]))
            .toSorted((left, right) =>
              order === 'DESC' ? right.created_at - left.created_at : left.created_at - right.created_at
            );

          return rows.slice(Number(args[2]), Number(args[2]) + Number(args[1]));
        },
        run: () => ({ changes: 0, lastInsertRowid: 0 }),
      };
    }

    if (normalizedSql.includes('SELECT COUNT(*) as count FROM ( SELECT turn_id, file_path')) {
      return {
        get: () => ({ count: this.countDuplicateGroups() }),
        all: () => [],
        run: () => ({ changes: 0, lastInsertRowid: 0 }),
      };
    }

    if (normalizedSql.includes('SELECT COALESCE(SUM(duplicate_count - 1), 0) as count')) {
      return {
        get: () => ({ count: this.countDuplicateRows() }),
        all: () => [],
        run: () => ({ changes: 0, lastInsertRowid: 0 }),
      };
    }

    if (normalizedSql.startsWith('INSERT INTO conversation_turns')) {
      return {
        get: () => undefined,
        all: () => [],
        run: (...args) => {
          const row: TurnSnapshotRow = {
            id: String(args[0]),
            conversation_id: String(args[1]),
            backend: String(args[2]),
            request_msg_id: typeof args[3] === 'string' ? args[3] : null,
            started_at: Number(args[4]),
            completed_at: typeof args[5] === 'number' ? args[5] : null,
            completion_signal: typeof args[6] === 'string' ? args[6] : null,
            completion_source: typeof args[7] === 'string' ? args[7] : null,
            lifecycle_status: args[8] as TurnSnapshotRow['lifecycle_status'],
            review_status: args[9] as TurnSnapshotRow['review_status'],
            file_count: Number(args[10]),
            source_message_ids: String(args[11]),
            last_activity_at: Number(args[12]),
            auto_kept_at: typeof args[13] === 'number' ? args[13] : null,
            created_at: Number(args[14]),
            updated_at: Number(args[15]),
          };
          this.turns.set(row.id, row);
          return { changes: 1, lastInsertRowid: 1 };
        },
      };
    }

    if (normalizedSql.startsWith('INSERT INTO conversation_turn_files')) {
      return {
        get: () => undefined,
        all: () => [],
        run: (...args) => {
          const row: TurnSnapshotFileRow = {
            id: String(args[0]),
            turn_id: String(args[1]),
            conversation_id: String(args[2]),
            file_path: String(args[3]),
            file_name: String(args[4]),
            action: args[5] as TurnSnapshotFileRow['action'],
            before_exists: Number(args[6]),
            after_exists: Number(args[7]),
            before_hash: typeof args[8] === 'string' ? args[8] : null,
            after_hash: typeof args[9] === 'string' ? args[9] : null,
            before_content: typeof args[10] === 'string' ? args[10] : null,
            after_content: typeof args[11] === 'string' ? args[11] : null,
            unified_diff: String(args[12]),
            source_message_ids: String(args[13]),
            revert_supported: Number(args[14]),
            revert_error: typeof args[15] === 'string' ? args[15] : null,
            created_at: Number(args[16]),
            updated_at: Number(args[17]),
          };
          this.turnFiles.set(row.id, row);
          return { changes: 1, lastInsertRowid: 1 };
        },
      };
    }

    if (normalizedSql === 'SELECT * FROM conversation_turns WHERE id = ?') {
      return {
        get: (...args) => this.turns.get(String(args[0])),
        all: () => [],
        run: () => ({ changes: 0, lastInsertRowid: 0 }),
      };
    }

    if (normalizedSql.includes('FROM conversation_turn_files') && normalizedSql.includes('WHERE turn_id = ?')) {
      return {
        get: () => undefined,
        all: (...args) =>
          [...this.turnFiles.values()]
            .filter((row) => row.turn_id === String(args[0]))
            .toSorted(
              (left, right) => left.created_at - right.created_at || left.file_path.localeCompare(right.file_path)
            ),
        run: () => ({ changes: 0, lastInsertRowid: 0 }),
      };
    }

    throw new Error(`Unsupported SQL in MigrationRegressionDriver.prepare(): ${normalizedSql}`);
  }

  exec(sql: string): void {
    const normalizedSql = sql.replace(/\s+/g, ' ').trim();

    if (normalizedSql.startsWith('INSERT INTO conversation_turns_v19')) {
      if (this.options.malformedTurnSchema) {
        throw new Error('no such column: source_message_ids');
      }

      this.stagedTurns = cloneMapValues(this.turns);
      for (const row of this.stagedTurns.values()) {
        row.lifecycle_status = 'completed';
        row.last_activity_at = row.completed_at ?? row.started_at;
        row.auto_kept_at = null;
      }
      return;
    }

    if (normalizedSql.startsWith('INSERT INTO conversation_turn_files_v19_dedup')) {
      this.stagedTurnFiles = new Map(
        [...this.turnFiles.values()]
          .toSorted((left, right) => {
            const partitionCompare =
              left.turn_id.localeCompare(right.turn_id) || left.file_path.localeCompare(right.file_path);
            if (partitionCompare !== 0) {
              return partitionCompare;
            }

            return (
              right.updated_at - left.updated_at ||
              right.created_at - left.created_at ||
              right.id.localeCompare(left.id)
            );
          })
          .reduce<Array<[string, TurnSnapshotFileRow]>>((bucket, row) => {
            const dedupeKey = `${row.turn_id}::${row.file_path}`;
            if (bucket.some(([key]) => key === dedupeKey)) {
              return bucket;
            }

            bucket.push([dedupeKey, { ...row }]);
            return bucket;
          }, [])
          .map(([, row]) => [row.id, row])
      );
      return;
    }

    const createTableMatch = normalizedSql.match(/^CREATE TABLE IF NOT EXISTS ([a-zA-Z0-9_]+)/i);
    if (createTableMatch) {
      const tableName = createTableMatch[1];
      if (!this.tables.has(tableName)) {
        this.tables.add(tableName);
        this.tableColumns[tableName] = this.getColumnsForTable(tableName);
      }
      return;
    }

    const createIndexMatch = normalizedSql.match(/^CREATE (?:UNIQUE )?INDEX IF NOT EXISTS ([a-zA-Z0-9_]+)/i);
    if (createIndexMatch) {
      this.indexes.add(createIndexMatch[1]);
      return;
    }

    const dropIndexMatch = normalizedSql.match(/^DROP INDEX IF EXISTS ([a-zA-Z0-9_]+)/i);
    if (dropIndexMatch) {
      this.indexes.delete(dropIndexMatch[1]);
      return;
    }

    if (normalizedSql === 'ALTER TABLE conversation_turns RENAME TO conversation_turns_v18_backup') {
      this.backupTurns = cloneMapValues(this.turns);
      this.turns.clear();
      this.renameTable('conversation_turns', 'conversation_turns_v18_backup');
      return;
    }

    if (normalizedSql === 'ALTER TABLE conversation_turn_files RENAME TO conversation_turn_files_v18_backup') {
      this.backupTurnFiles = cloneMapValues(this.turnFiles);
      this.turnFiles.clear();
      this.renameTable('conversation_turn_files', 'conversation_turn_files_v18_backup');
      return;
    }

    if (normalizedSql === 'ALTER TABLE conversation_turns_v19 RENAME TO conversation_turns') {
      this.turns.clear();
      for (const [id, row] of this.stagedTurns.entries()) {
        this.turns.set(id, { ...row });
      }
      this.stagedTurns.clear();
      this.renameTable('conversation_turns_v19', 'conversation_turns');
      this.tableColumns['conversation_turns'] = [...CURRENT_TURN_COLUMNS];
      return;
    }

    if (normalizedSql === 'ALTER TABLE conversation_turn_files_v19_dedup RENAME TO conversation_turn_files') {
      this.turnFiles.clear();
      for (const [id, row] of this.stagedTurnFiles.entries()) {
        this.turnFiles.set(id, { ...row });
      }
      this.stagedTurnFiles.clear();
      this.renameTable('conversation_turn_files_v19_dedup', 'conversation_turn_files');
      this.tableColumns['conversation_turn_files'] = [...TURN_FILE_COLUMNS];
      return;
    }

    const dropTableMatch = normalizedSql.match(/^DROP TABLE IF EXISTS ([a-zA-Z0-9_]+)/i);
    if (dropTableMatch) {
      const tableName = dropTableMatch[1];
      this.tables.delete(tableName);
      delete this.tableColumns[tableName];

      if (tableName === 'conversation_turns_v18_backup') {
        this.backupTurns.clear();
      } else if (tableName === 'conversation_turn_files_v18_backup') {
        this.backupTurnFiles.clear();
      }
    }
  }

  pragma(sql: string, options?: { simple?: boolean }): unknown {
    const normalizedSql = sql.replace(/\s+/g, ' ').trim();

    if (normalizedSql === 'foreign_keys = ON' || normalizedSql === 'foreign_keys = OFF') {
      return [];
    }

    if (normalizedSql === 'journal_mode = WAL') {
      return 'wal';
    }

    if (normalizedSql === 'foreign_key_check') {
      return [];
    }

    if (normalizedSql === 'user_version' && options?.simple) {
      return this.userVersion;
    }

    const setUserVersionMatch = normalizedSql.match(/^user_version = (\d+)$/i);
    if (setUserVersionMatch) {
      this.userVersion = Number(setUserVersionMatch[1]);
      return this.userVersion;
    }

    const tableInfoMatch = normalizedSql.match(/^table_info\(([a-zA-Z0-9_]+)\)$/i);
    if (tableInfoMatch) {
      return (this.tableColumns[tableInfoMatch[1]] ?? []).map((name) => ({ name }));
    }

    return [];
  }

  transaction<T>(fn: (...args: unknown[]) => T): (...args: unknown[]) => T {
    return (...args) => {
      const snapshot = this.snapshotState();
      try {
        return fn(...args);
      } catch (error) {
        this.restoreState(snapshot);
        throw error;
      }
    };
  }

  close(): void {}

  private seedLegacySchema(): void {
    this.tables.add('users');
    this.tables.add('conversations');
    this.tables.add('messages');
    this.tables.add('conversation_turns');
    this.tables.add('conversation_turn_files');

    this.tableColumns['users'] = [
      'id',
      'username',
      'email',
      'password_hash',
      'avatar_path',
      'jwt_secret',
      'created_at',
      'updated_at',
      'last_login',
    ];
    this.tableColumns['conversations'] = [
      'id',
      'user_id',
      'name',
      'type',
      'extra',
      'model',
      'status',
      'source',
      'channel_chat_id',
      'created_at',
      'updated_at',
    ];
    this.tableColumns['messages'] = [
      'id',
      'conversation_id',
      'msg_id',
      'type',
      'content',
      'position',
      'status',
      'created_at',
    ];
    this.tableColumns['conversation_turns'] = this.options.malformedTurnSchema
      ? [...MALFORMED_LEGACY_TURN_COLUMNS]
      : [...LEGACY_TURN_COLUMNS];
    this.tableColumns['conversation_turn_files'] = [...TURN_FILE_COLUMNS];

    this.indexes.add('idx_conversations_user_id');
    this.indexes.add('idx_conversations_updated_at');
    this.indexes.add('idx_conversations_type');
    this.indexes.add('idx_conversations_user_updated');
    this.indexes.add('idx_conversations_source');
    this.indexes.add('idx_conversations_source_updated');
    this.indexes.add('idx_conversations_source_chat');
    this.indexes.add('idx_messages_conversation_id');
    this.indexes.add('idx_messages_created_at');
    this.indexes.add('idx_messages_type');
    this.indexes.add('idx_messages_msg_id');
    this.indexes.add('idx_messages_conversation_created');
    this.indexes.add('idx_turns_conversation_completed');
    this.indexes.add('idx_turn_files_turn_id');
    this.indexes.add('idx_turn_files_conversation_path');
  }

  private getColumnsForTable(tableName: string): string[] {
    if (tableName === 'conversation_turns_v19' || tableName === 'conversation_turns') {
      return [...CURRENT_TURN_COLUMNS];
    }

    if (tableName === 'conversation_turn_files_v19_dedup' || tableName === 'conversation_turn_files') {
      return [...TURN_FILE_COLUMNS];
    }

    return this.tableColumns[tableName] ? [...this.tableColumns[tableName]] : [];
  }

  private renameTable(from: string, to: string): void {
    if (this.tables.delete(from)) {
      this.tables.add(to);
    }

    if (this.tableColumns[from]) {
      this.tableColumns[to] = [...this.tableColumns[from]];
      delete this.tableColumns[from];
    }
  }

  private countDuplicateGroups(): number {
    return this.buildDuplicateGroups().length;
  }

  private countDuplicateRows(): number {
    return this.buildDuplicateGroups().reduce((count, group) => count + group.rows.length - 1, 0);
  }

  private buildDuplicateGroups(): Array<{ key: string; rows: TurnSnapshotFileRow[] }> {
    const groupedRows = new Map<string, TurnSnapshotFileRow[]>();
    for (const row of this.turnFiles.values()) {
      const key = `${row.turn_id}::${row.file_path}`;
      const existingRows = groupedRows.get(key) ?? [];
      existingRows.push(row);
      groupedRows.set(key, existingRows);
    }

    return [...groupedRows.entries()].map(([key, rows]) => ({ key, rows })).filter((group) => group.rows.length > 1);
  }

  private snapshotState(): DriverState {
    return {
      users: cloneMapValues(this.users),
      conversations: cloneMapValues(this.conversations),
      messages: cloneMapValues(this.messages),
      turns: cloneMapValues(this.turns),
      turnFiles: cloneMapValues(this.turnFiles),
      stagedTurns: cloneMapValues(this.stagedTurns),
      stagedTurnFiles: cloneMapValues(this.stagedTurnFiles),
      backupTurns: cloneMapValues(this.backupTurns),
      backupTurnFiles: cloneMapValues(this.backupTurnFiles),
      tables: new Set(this.tables),
      indexes: new Set(this.indexes),
      tableColumns: cloneTableColumns(this.tableColumns),
      userVersion: this.userVersion,
    };
  }

  private restoreState(snapshot: DriverState): void {
    this.users.clear();
    this.conversations.clear();
    this.messages.clear();
    this.turns.clear();
    this.turnFiles.clear();
    this.stagedTurns.clear();
    this.stagedTurnFiles.clear();
    this.backupTurns.clear();
    this.backupTurnFiles.clear();
    this.tables.clear();
    this.indexes.clear();
    Object.keys(this.tableColumns).forEach((key) => delete this.tableColumns[key]);

    for (const [id, value] of snapshot.users) this.users.set(id, value);
    for (const [id, value] of snapshot.conversations) this.conversations.set(id, value);
    for (const [id, value] of snapshot.messages) this.messages.set(id, value);
    for (const [id, value] of snapshot.turns) this.turns.set(id, value);
    for (const [id, value] of snapshot.turnFiles) this.turnFiles.set(id, value);
    for (const [id, value] of snapshot.stagedTurns) this.stagedTurns.set(id, value);
    for (const [id, value] of snapshot.stagedTurnFiles) this.stagedTurnFiles.set(id, value);
    for (const [id, value] of snapshot.backupTurns) this.backupTurns.set(id, value);
    for (const [id, value] of snapshot.backupTurnFiles) this.backupTurnFiles.set(id, value);
    for (const table of snapshot.tables) this.tables.add(table);
    for (const index of snapshot.indexes) this.indexes.add(index);
    Object.assign(this.tableColumns, snapshot.tableColumns);
    this.userVersion = snapshot.userVersion;
  }
}

function createTempDatabaseHandle(): TempDatabaseHandle {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aionui-db-migration-'));
  tempDirectories.add(tempDir);
  return {
    tempDir,
    dbPath: path.join(tempDir, 'aionui.db'),
  };
}

function makeLiveTurnSnapshot(): CreateTurnSnapshotInput {
  return {
    id: 'turn-live',
    conversationId: 'conversation-1',
    backend: 'codex',
    requestMessageId: 'request-live',
    startedAt: 30,
    lifecycleStatus: 'running',
    reviewStatus: 'pending',
    sourceMessageIds: ['message-1'],
    lastActivityAt: 30,
    files: [
      {
        id: 'turn-live-file-1',
        turnId: 'turn-live',
        conversationId: 'conversation-1',
        filePath: 'src/live.ts',
        fileName: 'live.ts',
        action: 'update',
        beforeExists: true,
        afterExists: true,
        beforeHash: 'before-live',
        afterHash: 'after-live',
        beforeContent: 'before live',
        afterContent: 'after live',
        unifiedDiff: '@@ -1 +1 @@',
        sourceMessageIds: ['message-1'],
        revertSupported: true,
        createdAt: 30,
        updatedAt: 30,
      },
    ],
    createdAt: 30,
    updatedAt: 30,
  };
}

afterEach(() => {
  createDriverMock.mockReset();
  vi.restoreAllMocks();

  for (const tempDir of tempDirectories) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  tempDirectories.clear();
});

describe('database migration regression', () => {
  it('migrates a duplicate v18 turn snapshot database to v19 without losing history', async () => {
    const { dbPath } = createTempDatabaseHandle();
    const driver = new MigrationRegressionDriver();
    driver.seedHistoricalConversation();
    driver.seedLegacyTurnSnapshot([
      {
        id: 'dup-updated-old',
        filePath: 'src/example.ts',
        fileName: 'example.ts',
        beforeContent: 'old before',
        afterContent: 'old after',
        createdAt: 100,
        updatedAt: 200,
      },
      {
        id: 'dup-updated-winner',
        filePath: 'src/example.ts',
        fileName: 'example.ts',
        beforeContent: 'winner before',
        afterContent: 'winner after',
        createdAt: 90,
        updatedAt: 300,
      },
      {
        id: 'dup-created-old',
        filePath: 'src/created-tie.ts',
        fileName: 'created-tie.ts',
        beforeContent: 'created old',
        afterContent: 'created old after',
        createdAt: 110,
        updatedAt: 400,
      },
      {
        id: 'dup-created-winner',
        filePath: 'src/created-tie.ts',
        fileName: 'created-tie.ts',
        beforeContent: 'created winner',
        afterContent: 'created winner after',
        createdAt: 120,
        updatedAt: 400,
      },
      {
        id: 'dup-id-a',
        filePath: 'src/id-tie.ts',
        fileName: 'id-tie.ts',
        beforeContent: 'id a',
        afterContent: 'id a after',
        createdAt: 130,
        updatedAt: 500,
      },
      {
        id: 'dup-id-z',
        filePath: 'src/id-tie.ts',
        fileName: 'id-tie.ts',
        beforeContent: 'id z',
        afterContent: 'id z after',
        createdAt: 130,
        updatedAt: 500,
      },
      {
        id: 'unique-row',
        filePath: 'src/unique.ts',
        fileName: 'unique.ts',
        beforeContent: 'unique before',
        afterContent: 'unique after',
        createdAt: 140,
        updatedAt: 600,
      },
    ]);

    createDriverMock.mockResolvedValue(driver);

    const database = await AionUIDatabase.create(dbPath);
    const conversations = database.getUserConversations(undefined, 0, 10);
    const messages = database.getConversationMessages('conversation-1', 0, 10);
    const createTurnResult = database.createTurnSnapshot(makeLiveTurnSnapshot());

    expect(driver.getUserVersion()).toBe(CURRENT_DB_VERSION);
    expect(driver.indexes.has('idx_turn_files_turn_path')).toBe(true);
    expect(conversations.data).toHaveLength(1);
    expect(conversations.data[0]?.id).toBe('conversation-1');
    expect(messages.data).toHaveLength(1);
    expect(createTurnResult.success).toBe(true);

    const dedupedRows = [...driver.turnFiles.values()]
      .filter((row) => row.turn_id === 'turn-1')
      .toSorted((left, right) => left.file_path.localeCompare(right.file_path));

    expect(dedupedRows).toHaveLength(4);
    expect(dedupedRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'dup-updated-winner',
          file_path: 'src/example.ts',
          before_content: 'winner before',
          after_content: 'winner after',
        }),
        expect.objectContaining({
          id: 'dup-created-winner',
          file_path: 'src/created-tie.ts',
        }),
        expect.objectContaining({
          id: 'dup-id-z',
          file_path: 'src/id-tie.ts',
        }),
        expect.objectContaining({
          id: 'unique-row',
          file_path: 'src/unique.ts',
        }),
      ])
    );
  });

  it('adds team tables and indexes when migrating from v19 to current version', async () => {
    const { dbPath } = createTempDatabaseHandle();
    const driver = new MigrationRegressionDriver();
    driver.seedHistoricalConversation();
    createDriverMock.mockResolvedValue(driver);

    await AionUIDatabase.create(dbPath);

    expect(driver.getUserVersion()).toBe(CURRENT_DB_VERSION);
    expect(driver.tables.has('team_runs')).toBe(true);
    expect(driver.tables.has('team_tasks')).toBe(true);
    expect(driver.indexes.has('idx_team_runs_main')).toBe(true);
    expect(driver.indexes.has('idx_team_runs_status')).toBe(true);
    expect(driver.indexes.has('idx_team_tasks_run')).toBe(true);
    expect(driver.indexes.has('idx_team_tasks_parent')).toBe(true);
    expect(driver.indexes.has('idx_team_tasks_sub')).toBe(true);
    expect(driver.indexes.has('idx_team_tasks_status')).toBe(true);
  });

  it('preserves the existing database file when a migration fails', async () => {
    const { tempDir, dbPath } = createTempDatabaseHandle();
    const driver = new MigrationRegressionDriver({ malformedTurnSchema: true });
    driver.seedHistoricalConversation();
    fs.writeFileSync(dbPath, 'legacy-db-placeholder');

    createDriverMock.mockResolvedValue(driver);
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(AionUIDatabase.create(dbPath)).rejects.toBeInstanceOf(DatabaseMigrationError);

    expect(createDriverMock).toHaveBeenCalledTimes(1);
    expect(driver.getUserVersion()).toBe(18);
    expect(fs.existsSync(dbPath)).toBe(true);
    expect(fs.readdirSync(tempDir).filter((entry) => entry.startsWith('aionui.db.backup.'))).toHaveLength(0);
    expect(
      consoleErrorSpy.mock.calls.some(
        ([message, error]) =>
          String(message).includes('Initialization failed during migration; existing database was preserved') &&
          error instanceof DatabaseMigrationError &&
          error.fromVersion === 18 &&
          error.toVersion === CURRENT_DB_VERSION &&
          error.failedVersion === 19
      )
    ).toBe(true);
  });

  it('extracts conflict table and fields from sqlite unique-constraint failures', () => {
    const migrationError = new DatabaseMigrationError({
      fromVersion: 18,
      toVersion: 19,
      failedVersion: 19,
      migrationName: 'Upgrade turn snapshot tables for live aggregation',
      cause: new Error('UNIQUE constraint failed: conversation_turn_files.turn_id, conversation_turn_files.file_path'),
    });

    expect(migrationError.conflictTable).toBe('conversation_turn_files');
    expect(migrationError.conflictColumns).toEqual(['turn_id', 'file_path']);
    expect(migrationError.message).toContain('Conflict table: conversation_turn_files.');
    expect(migrationError.message).toContain('Conflict fields: turn_id, file_path.');
  });
});
