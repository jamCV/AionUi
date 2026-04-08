/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fileContentUpdateEmit = vi.hoisted(() => vi.fn());

vi.mock('@/common', () => ({
  ipcBridge: {
    fileStream: {
      contentUpdate: {
        emit: fileContentUpdateEmit,
      },
    },
  },
}));

import { TurnSnapshotService } from '../../../../src/process/bridge/services/TurnSnapshotService';

const sha1 = (content: string): string => createHash('sha1').update(content).digest('hex');

const makeSnapshot = (overrides?: Partial<any>) => ({
  id: 'turn-1',
  conversationId: 'conv-1',
  backend: 'acp:claude',
  requestMessageId: 'req-1',
  startedAt: 100,
  completedAt: 120,
  completionSignal: 'finish',
  reviewStatus: 'pending',
  fileCount: 1,
  sourceMessageIds: ['tool-msg-1'],
  createdAt: 120,
  updatedAt: 120,
  files: [
    {
      id: 'file-1',
      turnId: 'turn-1',
      conversationId: 'conv-1',
      filePath: 'src/example.ts',
      fileName: 'example.ts',
      action: 'update',
      beforeExists: true,
      afterExists: true,
      beforeHash: sha1('before content\n'),
      afterHash: sha1('after content\n'),
      beforeContent: 'before content\n',
      afterContent: 'after content\n',
      unifiedDiff: 'diff',
      sourceMessageIds: ['tool-msg-1'],
      revertSupported: true,
      createdAt: 120,
      updatedAt: 120,
    },
  ],
  ...overrides,
});

describe('TurnSnapshotService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('marks pending snapshots as kept', async () => {
    const snapshot = makeSnapshot();
    const repo = {
      getTurnSnapshot: vi
        .fn()
        .mockResolvedValueOnce(snapshot)
        .mockResolvedValueOnce({ ...snapshot, reviewStatus: 'kept' }),
      updateTurnReviewStatus: vi.fn(async () => {}),
    };
    const service = new TurnSnapshotService(repo as any, {} as any);

    const result = await service.keepTurn('turn-1');

    expect(repo.updateTurnReviewStatus).toHaveBeenCalledWith('turn-1', 'kept');
    expect(result).toMatchObject({
      success: true,
      turnId: 'turn-1',
      reviewStatus: 'kept',
    });
  });

  it('reports conflicts when workspace content no longer matches the snapshot', async () => {
    const snapshot = makeSnapshot();
    const workspace = 'C:/workspace';
    const repo = {
      getTurnSnapshot: vi
        .fn()
        .mockResolvedValueOnce(snapshot)
        .mockResolvedValueOnce({ ...snapshot, reviewStatus: 'conflict' }),
      getConversation: vi.fn(async () => ({
        id: 'conv-1',
        type: 'acp',
        extra: { workspace },
      })),
      updateTurnReviewStatus: vi.fn(async () => {}),
    };
    const deps = {
      readFile: vi.fn(async () => 'manually changed\n'),
      writeFile: vi.fn(async () => {}),
      removeFile: vi.fn(async () => {}),
      ensureDir: vi.fn(async () => {}),
    };
    const service = new TurnSnapshotService(repo as any, deps);

    const result = await service.revertTurn('turn-1');

    expect(result).toMatchObject({
      success: false,
      turnId: 'turn-1',
      status: 'conflict',
      reviewStatus: 'conflict',
    });
    expect(repo.updateTurnReviewStatus).toHaveBeenCalledWith('turn-1', 'conflict');
    expect(deps.writeFile).not.toHaveBeenCalled();
    expect(deps.removeFile).not.toHaveBeenCalled();
  });

  it('restores prior file contents and emits a file-stream update on successful revert', async () => {
    const workspace = 'C:/workspace';
    const snapshot = makeSnapshot();
    const repo = {
      getTurnSnapshot: vi
        .fn()
        .mockResolvedValueOnce(snapshot)
        .mockResolvedValueOnce({ ...snapshot, reviewStatus: 'reverted' }),
      getConversation: vi.fn(async () => ({
        id: 'conv-1',
        type: 'acp',
        extra: { workspace },
      })),
      updateTurnReviewStatus: vi.fn(async () => {}),
    };
    const deps = {
      readFile: vi.fn(async () => 'after content\n'),
      writeFile: vi.fn(async () => {}),
      removeFile: vi.fn(async () => {}),
      ensureDir: vi.fn(async () => {}),
    };
    const service = new TurnSnapshotService(repo as any, deps);

    const result = await service.revertTurn('turn-1');

    expect(result).toMatchObject({
      success: true,
      turnId: 'turn-1',
      status: 'reverted',
      reviewStatus: 'reverted',
    });
    expect(repo.updateTurnReviewStatus).toHaveBeenCalledWith('turn-1', 'reverted');
    expect(deps.ensureDir).toHaveBeenCalledWith(path.dirname(path.join(workspace, 'src/example.ts')));
    expect(deps.writeFile).toHaveBeenCalledWith(path.join(workspace, 'src/example.ts'), 'before content\n');
    expect(fileContentUpdateEmit).toHaveBeenCalledWith({
      filePath: path.join(workspace, 'src/example.ts'),
      content: 'before content\n',
      workspace,
      relativePath: 'src/example.ts',
      operation: 'write',
    });
  });
});
