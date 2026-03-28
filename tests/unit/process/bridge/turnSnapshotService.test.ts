import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TChatConversation } from '../../../../src/common/config/storage';
import type { TurnReviewStatus, TurnSnapshot } from '../../../../src/common/types/turnSnapshot';
import { TurnSnapshotService } from '../../../../src/process/bridge/services/TurnSnapshotService';
import type { IConversationRepository } from '../../../../src/process/services/database/IConversationRepository';

const { emitMock } = vi.hoisted(() => ({
  emitMock: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    fileStream: {
      contentUpdate: {
        emit: emitMock,
      },
    },
  },
}));

type RepoState = {
  snapshot?: TurnSnapshot;
  statusUpdates: TurnReviewStatus[];
};

const cloneSnapshot = (snapshot: TurnSnapshot | undefined): TurnSnapshot | undefined =>
  snapshot ? JSON.parse(JSON.stringify(snapshot)) : undefined;

const makeConversation = (workspace: string): TChatConversation =>
  ({
    id: 'conversation-1',
    name: 'Turn Snapshot Conversation',
    type: 'acp',
    extra: {
      backend: 'codex',
      workspace,
    },
    createTime: 1,
    modifyTime: 2,
  }) as TChatConversation;

const hashContent = (content: string): string => createHash('sha1').update(content).digest('hex');

const makeSnapshot = (): TurnSnapshot => ({
  id: 'turn-1',
  conversationId: 'conversation-1',
  backend: 'acp:codex',
  requestMessageId: 'request-1',
  startedAt: 10,
  completedAt: 20,
  completionSignal: 'finish',
  completionSource: 'end_turn',
  reviewStatus: 'pending',
  fileCount: 3,
  sourceMessageIds: ['m1'],
  createdAt: 20,
  updatedAt: 20,
  files: [
    {
      id: 'file-1',
      turnId: 'turn-1',
      conversationId: 'conversation-1',
      filePath: 'src/update.ts',
      fileName: 'update.ts',
      action: 'update',
      beforeExists: true,
      afterExists: true,
      beforeHash: hashContent('before update\n'),
      afterHash: hashContent('after update\n'),
      beforeContent: 'before update\n',
      afterContent: 'after update\n',
      unifiedDiff: 'diff-1',
      sourceMessageIds: ['m1'],
      revertSupported: true,
      createdAt: 20,
      updatedAt: 20,
    },
    {
      id: 'file-2',
      turnId: 'turn-1',
      conversationId: 'conversation-1',
      filePath: 'src/create.ts',
      fileName: 'create.ts',
      action: 'create',
      beforeExists: false,
      afterExists: true,
      afterHash: hashContent('created by turn\n'),
      afterContent: 'created by turn\n',
      unifiedDiff: 'diff-2',
      sourceMessageIds: ['m1'],
      revertSupported: true,
      createdAt: 20,
      updatedAt: 20,
    },
    {
      id: 'file-3',
      turnId: 'turn-1',
      conversationId: 'conversation-1',
      filePath: 'src/delete.ts',
      fileName: 'delete.ts',
      action: 'delete',
      beforeExists: true,
      afterExists: false,
      beforeHash: hashContent('restore deleted file\n'),
      beforeContent: 'restore deleted file\n',
      unifiedDiff: 'diff-3',
      sourceMessageIds: ['m1'],
      revertSupported: true,
      createdAt: 20,
      updatedAt: 20,
    },
  ],
});

function makeRepo(
  conversation: TChatConversation,
  snapshot: TurnSnapshot
): { repo: IConversationRepository; state: RepoState } {
  const state: RepoState = {
    snapshot: cloneSnapshot(snapshot),
    statusUpdates: [],
  };

  const repo: IConversationRepository = {
    getConversation: vi.fn(async () => conversation),
    createConversation: vi.fn(async () => undefined),
    updateConversation: vi.fn(async () => undefined),
    deleteConversation: vi.fn(async () => undefined),
    getMessages: vi.fn(async () => ({ data: [], total: 0, hasMore: false })),
    insertMessage: vi.fn(async () => undefined),
    getUserConversations: vi.fn(async () => ({ data: [], total: 0, hasMore: false })),
    listAllConversations: vi.fn(async () => []),
    searchMessages: vi.fn(async () => ({ items: [], total: 0, page: 0, pageSize: 20, hasMore: false })),
    createTurnSnapshot: vi.fn(async () => undefined),
    getTurnSnapshot: vi.fn(async () => cloneSnapshot(state.snapshot)),
    getTurnSnapshotsByConversation: vi.fn(async () => (state.snapshot ? [cloneSnapshot(state.snapshot)!] : [])),
    updateTurnReviewStatus: vi.fn(async (_turnId: string, status: TurnReviewStatus) => {
      state.statusUpdates.push(status);
      if (state.snapshot) {
        state.snapshot.reviewStatus = status;
      }
    }),
    getTurnSnapshotFiles: vi.fn(async () => cloneSnapshot(state.snapshot)?.files ?? []),
  };

  return { repo, state };
}

describe('TurnSnapshotService', () => {
  let workspace: string;

  beforeEach(() => {
    emitMock.mockReset();
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'turn-snapshot-service-'));
  });

  afterEach(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it('marks a pending turn as kept', async () => {
    const conversation = makeConversation(workspace);
    const snapshot = makeSnapshot();
    const { repo, state } = makeRepo(conversation, snapshot);
    const service = new TurnSnapshotService(repo);

    const result = await service.keepTurn(snapshot.id);

    expect(result.success).toBe(true);
    expect(result.reviewStatus).toBe('kept');
    expect(state.statusUpdates).toEqual(['kept']);
    expect(state.snapshot?.reviewStatus).toBe('kept');
  });

  it('reverts create, update, and delete files atomically on success', async () => {
    const conversation = makeConversation(workspace);
    const snapshot = makeSnapshot();
    const { repo, state } = makeRepo(conversation, snapshot);
    const service = new TurnSnapshotService(repo);

    fs.mkdirSync(path.join(workspace, 'src'), { recursive: true });
    fs.writeFileSync(path.join(workspace, 'src/update.ts'), 'after update\n', 'utf8');
    fs.writeFileSync(path.join(workspace, 'src/create.ts'), 'created by turn\n', 'utf8');

    const result = await service.revertTurn(snapshot.id);

    expect(result.success).toBe(true);
    expect(result.status).toBe('reverted');
    expect(state.statusUpdates).toEqual(['reverted']);
    expect(fs.readFileSync(path.join(workspace, 'src/update.ts'), 'utf8')).toBe('before update\n');
    expect(fs.existsSync(path.join(workspace, 'src/create.ts'))).toBe(false);
    expect(fs.readFileSync(path.join(workspace, 'src/delete.ts'), 'utf8')).toBe('restore deleted file\n');
    expect(emitMock).toHaveBeenCalledTimes(3);
  });

  it('marks the turn as conflict when workspace content no longer matches snapshot after-state', async () => {
    const conversation = makeConversation(workspace);
    const snapshot = makeSnapshot();
    const { repo, state } = makeRepo(conversation, snapshot);
    const service = new TurnSnapshotService(repo);

    fs.mkdirSync(path.join(workspace, 'src'), { recursive: true });
    fs.writeFileSync(path.join(workspace, 'src/update.ts'), 'manually edited\n', 'utf8');
    fs.writeFileSync(path.join(workspace, 'src/create.ts'), 'created by turn\n', 'utf8');

    const result = await service.revertTurn(snapshot.id);

    expect(result.success).toBe(false);
    expect(result.status).toBe('conflict');
    expect(result.reviewStatus).toBe('conflict');
    expect(result.conflicts).toEqual([
      {
        filePath: 'src/update.ts',
        expectedExists: true,
        actualExists: true,
        expectedHash: hashContent('after update\n'),
        actualHash: hashContent('manually edited\n'),
      },
    ]);
    expect(state.statusUpdates).toEqual(['conflict']);
    expect(fs.readFileSync(path.join(workspace, 'src/update.ts'), 'utf8')).toBe('manually edited\n');
  });

  it('rolls back file writes when revert fails midway', async () => {
    const conversation = makeConversation(workspace);
    const snapshot = makeSnapshot();
    const { repo, state } = makeRepo(conversation, snapshot);
    const writeFile = vi.fn(async (filePath: string, content: string) => {
      if (filePath.endsWith(path.join('src', 'delete.ts'))) {
        throw new Error('simulated write failure');
      }
      await fs.promises.writeFile(filePath, content, 'utf8');
    });
    const service = new TurnSnapshotService(repo, {
      readFile: (filePath) => fs.promises.readFile(filePath, 'utf8'),
      writeFile,
      removeFile: (filePath) => fs.promises.rm(filePath, { force: true }),
      ensureDir: (dirPath) => fs.promises.mkdir(dirPath, { recursive: true }),
    });

    fs.mkdirSync(path.join(workspace, 'src'), { recursive: true });
    fs.writeFileSync(path.join(workspace, 'src/update.ts'), 'after update\n', 'utf8');
    fs.writeFileSync(path.join(workspace, 'src/create.ts'), 'created by turn\n', 'utf8');

    const result = await service.revertTurn(snapshot.id);

    expect(result.success).toBe(false);
    expect(result.status).toBe('failed');
    expect(state.statusUpdates).toEqual(['failed']);
    expect(fs.readFileSync(path.join(workspace, 'src/update.ts'), 'utf8')).toBe('after update\n');
    expect(fs.readFileSync(path.join(workspace, 'src/create.ts'), 'utf8')).toBe('created by turn\n');
    expect(fs.existsSync(path.join(workspace, 'src/delete.ts'))).toBe(false);
  });
});
