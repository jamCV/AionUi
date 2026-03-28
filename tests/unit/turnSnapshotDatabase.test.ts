/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import type { TChatConversation } from '../../src/common/config/storage';
import { AionUIDatabase } from '../../src/process/services/database';
import type { IStatement, ISqliteDriver } from '../../src/process/services/database/drivers/ISqliteDriver';
import { runMigrations } from '../../src/process/services/database/migrations';
import type {
  CreateTurnSnapshotInput,
  IConversationRow,
  TurnSnapshotFileRow,
  TurnSnapshotRow,
} from '../../src/process/services/database/types';

type TableColumns = Record<string, string[]>;

class FakeSqliteDriver implements ISqliteDriver {
  private readonly conversations = new Map<string, IConversationRow>();
  private readonly turns = new Map<string, TurnSnapshotRow>();
  private readonly turnFiles = new Map<string, TurnSnapshotFileRow>();

  readonly tables = new Set<string>();
  readonly indexes = new Set<string>();
  readonly tableColumns: TableColumns = {};

  prepare(sql: string): IStatement {
    const normalizedSql = sql.replace(/\s+/g, ' ').trim();

    if (normalizedSql.startsWith('INSERT INTO conversations')) {
      return {
        get: () => undefined,
        all: () => [],
        run: (...args) => {
          const row: IConversationRow = {
            id: String(args[0]),
            user_id: String(args[1]),
            name: String(args[2]),
            type: args[3] as IConversationRow['type'],
            extra: String(args[4]),
            model: typeof args[5] === 'string' ? args[5] : undefined,
            status: args[6] as IConversationRow['status'],
            source: args[7] as IConversationRow['source'],
            channel_chat_id: typeof args[8] === 'string' ? args[8] : undefined,
            created_at: Number(args[9]),
            updated_at: Number(args[10]),
          };
          this.conversations.set(row.id, row);
          return { changes: 1, lastInsertRowid: 1 };
        },
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
            completed_at: Number(args[5]),
            completion_signal: String(args[6]),
            completion_source: typeof args[7] === 'string' ? args[7] : null,
            review_status: args[8] as TurnSnapshotRow['review_status'],
            file_count: Number(args[9]),
            source_message_ids: String(args[10]),
            created_at: Number(args[11]),
            updated_at: Number(args[12]),
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
            .sort((left, right) => left.created_at - right.created_at || left.file_path.localeCompare(right.file_path)),
        run: () => ({ changes: 0, lastInsertRowid: 0 }),
      };
    }

    if (normalizedSql.includes('FROM conversation_turns') && normalizedSql.includes('WHERE conversation_id = ?')) {
      return {
        get: () => undefined,
        all: (...args) =>
          [...this.turns.values()]
            .filter((row) => row.conversation_id === String(args[0]))
            .toSorted((left, right) => right.completed_at - left.completed_at)
            .slice(0, Number(args[1])),
        run: () => ({ changes: 0, lastInsertRowid: 0 }),
      };
    }

    if (normalizedSql.includes('UPDATE conversation_turns') && normalizedSql.includes('SET review_status = ?')) {
      return {
        get: () => undefined,
        all: () => [],
        run: (...args) => {
          const turnId = String(args[2]);
          const existingRow = this.turns.get(turnId);
          if (!existingRow) {
            return { changes: 0, lastInsertRowid: 0 };
          }

          this.turns.set(turnId, {
            ...existingRow,
            review_status: args[0] as TurnSnapshotRow['review_status'],
            updated_at: Number(args[1]),
          });
          return { changes: 1, lastInsertRowid: 0 };
        },
      };
    }

    throw new Error(`Unsupported SQL in FakeSqliteDriver.prepare(): ${normalizedSql}`);
  }

  exec(sql: string): void {
    const statements = sql
      .split(';')
      .map((statement) => statement.trim())
      .filter(Boolean);

    for (const statement of statements) {
      const createTableMatch = statement.match(/^CREATE TABLE IF NOT EXISTS ([a-zA-Z0-9_]+)/i);
      if (createTableMatch) {
        const tableName = createTableMatch[1];
        this.tables.add(tableName);

        if (tableName === 'conversation_turns') {
          this.tableColumns[tableName] = [
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
        } else if (tableName === 'conversation_turn_files') {
          this.tableColumns[tableName] = [
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
        }

        continue;
      }

      const createIndexMatch = statement.match(/^CREATE INDEX IF NOT EXISTS ([a-zA-Z0-9_]+)/i);
      if (createIndexMatch) {
        this.indexes.add(createIndexMatch[1]);
        continue;
      }

      const dropIndexMatch = statement.match(/^DROP INDEX IF EXISTS ([a-zA-Z0-9_]+)/i);
      if (dropIndexMatch) {
        this.indexes.delete(dropIndexMatch[1]);
        continue;
      }

      const dropTableMatch = statement.match(/^DROP TABLE IF EXISTS ([a-zA-Z0-9_]+)/i);
      if (dropTableMatch) {
        this.tables.delete(dropTableMatch[1]);
        delete this.tableColumns[dropTableMatch[1]];
      }
    }
  }

  pragma(sql: string, _options?: { simple?: boolean }): unknown {
    const tableInfoMatch = sql.match(/^table_info\(([a-zA-Z0-9_]+)\)$/i);
    if (tableInfoMatch) {
      const tableName = tableInfoMatch[1];
      return (this.tableColumns[tableName] ?? []).map((name) => ({ name }));
    }

    return [];
  }

  transaction<T>(fn: (...args: unknown[]) => T): (...args: unknown[]) => T {
    return (...args) => fn(...args);
  }

  close(): void {}
}

const DatabaseConstructor = AionUIDatabase as unknown as { new (db: ISqliteDriver): AionUIDatabase };

const makeDatabase = (): AionUIDatabase => new DatabaseConstructor(new FakeSqliteDriver());

const makeConversation = (): TChatConversation => ({
  id: 'conversation-1',
  name: 'Turn Snapshot Conversation',
  type: 'acp',
  extra: {
    backend: 'codex',
    workspace: '/workspace',
  },
  createTime: 1,
  modifyTime: 2,
});

const makeTurnSnapshotInput = (): CreateTurnSnapshotInput => ({
  id: 'turn-1',
  conversationId: 'conversation-1',
  backend: 'codex',
  requestMessageId: 'request-1',
  startedAt: 10,
  completedAt: 20,
  completionSignal: 'finish',
  completionSource: 'end_turn',
  reviewStatus: 'pending',
  sourceMessageIds: ['message-1', 'message-2'],
  files: [
    {
      id: 'turn-file-1',
      turnId: 'turn-1',
      conversationId: 'conversation-1',
      filePath: 'src/example.ts',
      fileName: 'example.ts',
      action: 'update',
      beforeExists: true,
      afterExists: true,
      beforeHash: 'before-hash',
      afterHash: 'after-hash',
      beforeContent: 'before',
      afterContent: 'after',
      unifiedDiff: '@@ -1 +1 @@',
      sourceMessageIds: ['message-1'],
      revertSupported: true,
      createdAt: 10,
      updatedAt: 20,
    },
    {
      id: 'turn-file-2',
      turnId: 'turn-1',
      conversationId: 'conversation-1',
      filePath: 'src/new-file.ts',
      fileName: 'new-file.ts',
      action: 'create',
      beforeExists: false,
      afterExists: true,
      afterHash: 'new-hash',
      afterContent: 'new content',
      unifiedDiff: '@@ -0,0 +1 @@',
      sourceMessageIds: ['message-2'],
      revertSupported: true,
      createdAt: 11,
      updatedAt: 21,
    },
  ],
  createdAt: 10,
  updatedAt: 20,
});

describe('turn snapshot migration', () => {
  it('creates turn snapshot tables and indexes in v18 migration', () => {
    const driver = new FakeSqliteDriver();

    driver.exec(`
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY);
    `);

    runMigrations(driver, 17, 18);

    expect(driver.tables.has('conversation_turns')).toBe(true);
    expect(driver.tables.has('conversation_turn_files')).toBe(true);
    expect(driver.indexes.has('idx_turns_conversation_completed')).toBe(true);
    expect(driver.indexes.has('idx_turn_files_turn_id')).toBe(true);
    expect(driver.indexes.has('idx_turn_files_conversation_path')).toBe(true);
    expect(driver.tableColumns['conversation_turns']).toContain('completion_source');
  });
});

describe('turn snapshot persistence', () => {
  it('persists and loads a turn snapshot with files', () => {
    const database = makeDatabase();
    database.createConversation(makeConversation());

    const createResult = database.createTurnSnapshot(makeTurnSnapshotInput());
    const snapshotResult = database.getTurnSnapshot('turn-1');

    expect(createResult.success).toBe(true);
    expect(snapshotResult.success).toBe(true);
    expect(snapshotResult.data?.completionSignal).toBe('finish');
    expect(snapshotResult.data?.completionSource).toBe('end_turn');
    expect(snapshotResult.data?.fileCount).toBe(2);
    expect(snapshotResult.data?.files).toHaveLength(2);
    expect(snapshotResult.data?.files[0]?.filePath).toBe('src/example.ts');
    expect(snapshotResult.data?.files[1]?.action).toBe('create');
  });

  it('lists snapshots by conversation and updates review status', () => {
    const database = makeDatabase();
    database.createConversation(makeConversation());
    database.createTurnSnapshot(makeTurnSnapshotInput());

    const listResult = database.getTurnSnapshotsByConversation('conversation-1', 10);
    const updateResult = database.updateTurnReviewStatus('turn-1', 'kept');
    const filesResult = database.getTurnSnapshotFiles('turn-1');
    const snapshotResult = database.getTurnSnapshot('turn-1');

    expect(listResult.success).toBe(true);
    expect(listResult.data).toHaveLength(1);
    expect(updateResult.success).toBe(true);
    expect(updateResult.data).toBe(true);
    expect(filesResult.success).toBe(true);
    expect(filesResult.data).toHaveLength(2);
    expect(snapshotResult.data?.reviewStatus).toBe('kept');
  });

  it('returns not found for a missing turn snapshot', () => {
    const database = makeDatabase();

    const snapshotResult = database.getTurnSnapshot('missing-turn');

    expect(snapshotResult.success).toBe(false);
    expect(snapshotResult.error).toBe('Turn snapshot not found');
  });
});
