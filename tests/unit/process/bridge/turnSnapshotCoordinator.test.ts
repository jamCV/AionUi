/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TurnSnapshotCoordinator,
  parseCompletionSource,
} from '../../../../src/process/bridge/services/TurnSnapshotCoordinator';

describe('TurnSnapshotCoordinator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a turn snapshot from ACP diff messages after draining pending writes', async () => {
    const workspace = 'C:/workspace';
    const createdSnapshots: any[] = [];
    const repo = {
      getConversation: vi.fn(async () => ({
        id: 'conv-1',
        type: 'acp',
        extra: { workspace, backend: 'claude' },
      })),
      getMessages: vi.fn(async () => ({
        data: [
          {
            id: 'before-turn',
            conversation_id: 'conv-1',
            type: 'text',
            content: { content: 'ignored' },
            createdAt: 50,
          },
          {
            id: 'tool-msg-1',
            conversation_id: 'conv-1',
            type: 'acp_tool_call',
            content: {
              update: {
                sessionUpdate: 'tool_call',
                toolCallId: 'tool-1',
                status: 'completed',
                title: 'Edit file',
                kind: 'edit',
                content: [
                  {
                    type: 'diff',
                    path: 'src/new-file.ts',
                    oldText: null,
                    newText: 'export const value = 1;\n',
                  },
                ],
              },
            },
            createdAt: 110,
          },
        ],
        total: 2,
        hasMore: false,
      })),
      createTurnSnapshot: vi.fn(async (snapshot) => {
        createdSnapshots.push(snapshot);
      }),
    };
    const deps = {
      now: vi.fn(() => 200),
      createId: vi.fn().mockReturnValueOnce('turn-1').mockReturnValueOnce('file-1'),
      readWorkspaceFile: vi.fn(async () => 'export const value = 1;\n'),
      drainWrites: vi.fn(async () => {}),
    };
    const coordinator = new TurnSnapshotCoordinator(repo as any, deps);

    await coordinator.startTurn({
      conversationId: 'conv-1',
      backend: 'acp:claude',
      requestMessageId: 'req-1',
      startedAt: 100,
    });
    await coordinator.completeTurn({
      conversationId: 'conv-1',
      completionSignal: 'finish',
      completionSource: 'end_turn',
    });

    expect(deps.drainWrites).toHaveBeenCalledWith('conv-1');
    expect(deps.readWorkspaceFile).toHaveBeenCalledWith(path.join(workspace, 'src/new-file.ts'));
    expect(repo.createTurnSnapshot).toHaveBeenCalledOnce();
    expect(createdSnapshots[0]).toMatchObject({
      id: 'turn-1',
      conversationId: 'conv-1',
      backend: 'acp:claude',
      requestMessageId: 'req-1',
      completionSignal: 'finish',
      completionSource: 'end_turn',
      reviewStatus: 'pending',
      sourceMessageIds: ['tool-msg-1'],
      files: [
        {
          id: 'file-1',
          turnId: 'turn-1',
          filePath: 'src/new-file.ts',
          fileName: 'new-file.ts',
          action: 'create',
          beforeExists: false,
          afterExists: true,
          beforeContent: undefined,
          afterContent: 'export const value = 1;\n',
          revertSupported: true,
          sourceMessageIds: ['tool-msg-1'],
        },
      ],
    });
  });

  it('creates a reversible snapshot from legacy codex turn diffs', async () => {
    const workspace = 'C:/workspace';
    const createdSnapshots: any[] = [];
    const repo = {
      getConversation: vi.fn(async () => ({
        id: 'conv-1',
        type: 'acp',
        extra: { workspace, backend: 'codex' },
      })),
      getMessages: vi.fn(async () => ({
        data: [
          {
            id: 'codex-msg-1',
            conversation_id: 'conv-1',
            type: 'codex_tool_call',
            content: {
              toolCallId: 'tool-1',
              status: 'success',
              kind: 'patch',
              subtype: 'turn_diff',
              data: {
                unified_diff: [
                  '--- a/src/app.ts',
                  '+++ b/src/app.ts',
                  '@@ -1 +1 @@',
                  '-old value',
                  '+new value',
                  '',
                ].join('\n'),
              },
            },
            createdAt: 110,
          },
        ],
        total: 1,
        hasMore: false,
      })),
      createTurnSnapshot: vi.fn(async (snapshot) => {
        createdSnapshots.push(snapshot);
      }),
    };
    const deps = {
      now: vi.fn(() => 200),
      createId: vi.fn().mockReturnValueOnce('turn-1').mockReturnValueOnce('file-1'),
      readWorkspaceFile: vi.fn(async () => 'new value\n'),
      drainWrites: vi.fn(async () => {}),
    };
    const coordinator = new TurnSnapshotCoordinator(repo as any, deps);

    await coordinator.startTurn({
      conversationId: 'conv-1',
      backend: 'codex',
      startedAt: 100,
    });
    await coordinator.completeTurn({
      conversationId: 'conv-1',
      completionSignal: 'finish',
    });

    expect(repo.createTurnSnapshot).toHaveBeenCalledOnce();
    expect(createdSnapshots[0].files[0]).toMatchObject({
      filePath: 'src/app.ts',
      action: 'update',
      beforeExists: true,
      afterExists: true,
      beforeContent: 'old value\n',
      afterContent: 'new value\n',
      revertSupported: true,
      sourceMessageIds: ['codex-msg-1'],
    });
  });

  it('skips snapshot creation when the completed turn has no file diffs', async () => {
    const repo = {
      getConversation: vi.fn(async () => ({
        id: 'conv-1',
        type: 'acp',
        extra: { workspace: 'C:/workspace', backend: 'claude' },
      })),
      getMessages: vi.fn(async () => ({
        data: [
          {
            id: 'msg-1',
            conversation_id: 'conv-1',
            type: 'text',
            content: { content: 'plain reply' },
            createdAt: 110,
          },
        ],
        total: 1,
        hasMore: false,
      })),
      createTurnSnapshot: vi.fn(async () => {}),
    };
    const deps = {
      now: vi.fn(() => 200),
      createId: vi.fn().mockReturnValue('turn-1'),
      readWorkspaceFile: vi.fn(),
      drainWrites: vi.fn(async () => {}),
    };
    const coordinator = new TurnSnapshotCoordinator(repo as any, deps);

    await coordinator.startTurn({
      conversationId: 'conv-1',
      backend: 'acp:claude',
      startedAt: 100,
    });
    await coordinator.completeTurn({
      conversationId: 'conv-1',
      completionSignal: 'finish',
    });

    expect(repo.createTurnSnapshot).not.toHaveBeenCalled();
  });

  it('extracts completionSource only from object payloads', () => {
    expect(parseCompletionSource({ completionSource: 'cancel' })).toBe('cancel');
    expect(parseCompletionSource({ completionSource: 1 })).toBeUndefined();
    expect(parseCompletionSource(null)).toBeUndefined();
  });
});
