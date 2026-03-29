/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IMessageAcpToolCall, IMessageCodexToolCall, TMessage } from '../../src/common/chat/chatLib';
import type { TChatConversation } from '../../src/common/config/storage';
import type { ToolCallUpdate } from '../../src/common/types/acpTypes';
import type { IConversationRepository } from '../../src/process/services/database/IConversationRepository';
import type {
  CreateTurnSnapshotFileInput,
  CreateTurnSnapshotInput,
  TurnSnapshot,
  UpdateTurnSnapshotInput,
} from '../../src/process/services/database/types';
import { TurnSnapshotCoordinator } from '../../src/process/bridge/services/TurnSnapshotCoordinator';
import { createTwoFilesPatch } from 'diff';

type RepoMock = IConversationRepository & {
  createdSnapshots: CreateTurnSnapshotInput[];
  currentSnapshot?: TurnSnapshot;
};

const makeConversation = (workspace: string): TChatConversation => ({
  id: 'conversation-1',
  name: 'Turn Snapshot Conversation',
  type: 'acp',
  extra: {
    backend: 'codex',
    workspace,
  },
  createTime: 1,
  modifyTime: 2,
});

const makeAcpToolCallMessage = (diffPath: string, beforeText: string, afterText: string): IMessageAcpToolCall => {
  const normalizedDiff = createTwoFilesPatch(diffPath, diffPath, beforeText, afterText, '', '', { context: 3 });
  const content: ToolCallUpdate = {
    sessionId: 'session-1',
    update: {
      sessionUpdate: 'tool_call',
      toolCallId: 'tool-1',
      status: 'completed',
      title: 'Edit file',
      kind: 'edit',
      content: [
        {
          type: 'diff',
          path: diffPath,
          oldText: beforeText,
          newText: afterText,
        },
      ],
      normalizedDiffs: [
        {
          path: diffPath,
          action: 'update',
          beforeExists: true,
          afterExists: true,
          unifiedDiff: normalizedDiff,
        },
      ],
      locations: [],
    },
  };

  return {
    id: 'message-1',
    msg_id: 'tool-1',
    type: 'acp_tool_call',
    position: 'left',
    conversation_id: 'conversation-1',
    createdAt: 20,
    content,
  };
};

const makeCodexTurnDiffMessage = (diffPath: string, beforeText: string, afterText: string): IMessageCodexToolCall => ({
  id: 'message-2',
  msg_id: 'tool-2',
  type: 'codex_tool_call',
  position: 'left',
  conversation_id: 'conversation-1',
  createdAt: 20,
  content: {
    toolCallId: 'tool-2',
    status: 'success',
    kind: 'patch',
    subtype: 'turn_diff',
    data: {
      unified_diff: createTwoFilesPatch(diffPath, diffPath, beforeText, afterText, '', '', { context: 3 }),
    },
  },
});

const makeRepo = (conversation: TChatConversation, messages: TMessage[]): RepoMock => {
  const createdSnapshots: CreateTurnSnapshotInput[] = [];
  let currentSnapshot: TurnSnapshot | undefined;

  const materializeSnapshot = (input: CreateTurnSnapshotInput): TurnSnapshot => ({
    ...input,
    fileCount: input.files.length,
    createdAt: input.createdAt ?? input.startedAt,
    updatedAt: input.updatedAt ?? input.createdAt ?? input.startedAt,
    files: input.files.map((file) => ({
      ...file,
      createdAt: file.createdAt ?? input.createdAt ?? input.startedAt,
      updatedAt: file.updatedAt ?? file.createdAt ?? input.createdAt ?? input.startedAt,
    })),
  });

  const upsertFile = (file: CreateTurnSnapshotFileInput): void => {
    if (!currentSnapshot) {
      return;
    }

    const nextFile = {
      ...file,
      createdAt: file.createdAt ?? currentSnapshot.createdAt,
      updatedAt: file.updatedAt ?? file.createdAt ?? currentSnapshot.updatedAt,
    };
    const existingIndex = currentSnapshot.files.findIndex((item) => item.filePath === file.filePath);
    if (existingIndex >= 0) {
      currentSnapshot.files[existingIndex] = {
        ...currentSnapshot.files[existingIndex],
        ...nextFile,
      };
    } else {
      currentSnapshot.files.push(nextFile);
    }
    currentSnapshot.fileCount = currentSnapshot.files.length;
  };

  const applyUpdate = (input: UpdateTurnSnapshotInput): void => {
    if (!currentSnapshot) {
      return;
    }

    currentSnapshot = {
      ...currentSnapshot,
      completedAt: input.completedAt ?? currentSnapshot.completedAt,
      completionSignal: input.completionSignal ?? currentSnapshot.completionSignal,
      completionSource: input.completionSource ?? currentSnapshot.completionSource,
      lifecycleStatus: input.lifecycleStatus ?? currentSnapshot.lifecycleStatus,
      reviewStatus: input.reviewStatus ?? currentSnapshot.reviewStatus,
      fileCount: input.fileCount ?? currentSnapshot.fileCount,
      sourceMessageIds: input.sourceMessageIds ?? currentSnapshot.sourceMessageIds,
      lastActivityAt: input.lastActivityAt ?? currentSnapshot.lastActivityAt,
      autoKeptAt: input.autoKeptAt ?? currentSnapshot.autoKeptAt,
      updatedAt: input.updatedAt ?? currentSnapshot.updatedAt,
      files: currentSnapshot.files,
    };
  };

  const repo = {
    createdSnapshots,
    getConversation: vi.fn(async () => conversation),
    createConversation: vi.fn(async () => undefined),
    updateConversation: vi.fn(async () => undefined),
    deleteConversation: vi.fn(async () => undefined),
    getMessages: vi.fn(async () => ({
      data: messages,
      total: messages.length,
      hasMore: false,
    })),
    insertMessage: vi.fn(async () => undefined),
    getUserConversations: vi.fn(async () => ({ data: [], total: 0, hasMore: false })),
    listAllConversations: vi.fn(async () => []),
    searchMessages: vi.fn(async () => ({ items: [], total: 0, page: 0, pageSize: 20, hasMore: false })),
    createTurnSnapshot: vi.fn(async (input: CreateTurnSnapshotInput) => {
      createdSnapshots.push(input);
      currentSnapshot = materializeSnapshot(input);
    }),
    upsertTurnSnapshotFile: vi.fn(async (input: CreateTurnSnapshotFileInput) => {
      upsertFile(input);
    }),
    getTurnSnapshot: vi.fn(async () => currentSnapshot),
    getTurnSnapshotsByConversation: vi.fn(async () => (currentSnapshot ? [currentSnapshot] : [])),
    updateTurnSnapshot: vi.fn(async (input: UpdateTurnSnapshotInput) => {
      applyUpdate(input);
    }),
    updateTurnReviewStatus: vi.fn(async () => undefined),
    getTurnSnapshotFiles: vi.fn(async () => currentSnapshot?.files ?? []),
    deleteTurnSnapshot: vi.fn(async () => {
      currentSnapshot = undefined;
    }),
  } satisfies RepoMock;

  Object.defineProperty(repo, 'currentSnapshot', {
    get: () => currentSnapshot,
  });

  return repo;
};

describe('TurnSnapshotCoordinator', () => {
  let workspace: string;

  beforeEach(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'turn-snapshot-'));
  });

  afterEach(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it('creates a turn snapshot from ACP diff messages', async () => {
    const filePath = 'src/example.ts';
    const beforeText = 'before\\n';
    const afterText = 'after\\n';
    const absoluteFilePath = path.join(workspace, filePath);

    fs.mkdirSync(path.dirname(absoluteFilePath), { recursive: true });
    fs.writeFileSync(absoluteFilePath, afterText, 'utf8');

    const repo = makeRepo(makeConversation(workspace), [makeAcpToolCallMessage(filePath, beforeText, afterText)]);
    const drainWrites = vi.fn(async () => undefined);
    const coordinator = new TurnSnapshotCoordinator(repo, {
      now: () => 100,
      createId: () => 'turn-id',
      readWorkspaceFile: async (targetPath) => fs.promises.readFile(targetPath, 'utf8'),
      drainWrites,
    });

    await coordinator.startTurn({
      conversationId: 'conversation-1',
      backend: 'acp:codex',
      requestMessageId: 'request-1',
      startedAt: 10,
    });
    await coordinator.completeTurn({
      conversationId: 'conversation-1',
      completionSignal: 'finish',
      completionSource: 'end_turn',
    });

    expect(drainWrites).toHaveBeenCalledWith('conversation-1');
    expect(repo.createdSnapshots).toHaveLength(1);
    expect(repo.currentSnapshot?.backend).toBe('acp:codex');
    expect(repo.currentSnapshot?.reviewStatus).toBe('pending');
    expect(repo.currentSnapshot?.lifecycleStatus).toBe('completed');
    expect(repo.currentSnapshot?.files[0]?.filePath).toBe(filePath);
    expect(repo.currentSnapshot?.files[0]?.beforeContent).toBe(beforeText);
    expect(repo.currentSnapshot?.files[0]?.afterContent).toBe(afterText);
  });

  it('creates a turn snapshot from Codex unified diff messages', async () => {
    const filePath = 'src/codex.ts';
    const beforeText = 'const value = 1;\\n';
    const afterText = 'const value = 2;\\n';
    const absoluteFilePath = path.join(workspace, filePath);

    fs.mkdirSync(path.dirname(absoluteFilePath), { recursive: true });
    fs.writeFileSync(absoluteFilePath, afterText, 'utf8');

    const repo = makeRepo(makeConversation(workspace), [makeCodexTurnDiffMessage(filePath, beforeText, afterText)]);
    const coordinator = new TurnSnapshotCoordinator(repo, {
      now: () => 200,
      createId: () => 'codex-turn-id',
      readWorkspaceFile: async (targetPath) => fs.promises.readFile(targetPath, 'utf8'),
      drainWrites: async () => undefined,
    });

    await coordinator.startTurn({
      conversationId: 'conversation-1',
      backend: 'codex',
      requestMessageId: 'request-2',
      startedAt: 10,
    });
    await coordinator.completeTurn({
      conversationId: 'conversation-1',
      completionSignal: 'finish',
      completionSource: 'task_complete',
    });

    expect(repo.createdSnapshots).toHaveLength(1);
    expect(repo.currentSnapshot?.files[0]?.beforeContent).toBe(beforeText);
    expect(repo.currentSnapshot?.files[0]?.afterContent).toBe(afterText);
    expect(repo.currentSnapshot?.completionSource).toBe('task_complete');
  });

  it('does not persist a turn snapshot when no file changes are found', async () => {
    const repo = makeRepo(makeConversation(workspace), [
      {
        id: 'message-3',
        msg_id: 'message-3',
        type: 'text',
        position: 'left',
        conversation_id: 'conversation-1',
        createdAt: 20,
        content: { content: 'plain text' },
      } as TMessage,
    ]);
    const coordinator = new TurnSnapshotCoordinator(repo, {
      now: () => 300,
      createId: () => 'empty-turn-id',
      readWorkspaceFile: async (targetPath) => fs.promises.readFile(targetPath, 'utf8'),
      drainWrites: async () => undefined,
    });

    await coordinator.startTurn({
      conversationId: 'conversation-1',
      backend: 'acp:codex',
      startedAt: 10,
    });
    await coordinator.completeTurn({
      conversationId: 'conversation-1',
      completionSignal: 'finish',
      completionSource: 'end_turn',
    });

    expect(repo.createdSnapshots).toHaveLength(1);
    expect(repo.currentSnapshot).toBeUndefined();
  });

  it('marks the snapshot as unsupported when a Codex diff cannot be reversed safely', async () => {
    const filePath = 'src/mismatch.ts';
    const beforeText = 'const version = 1;\n';
    const afterText = 'const version = 2;\n';
    const absoluteFilePath = path.join(workspace, filePath);

    fs.mkdirSync(path.dirname(absoluteFilePath), { recursive: true });
    fs.writeFileSync(absoluteFilePath, 'const version = 999;\n', 'utf8');

    const repo = makeRepo(makeConversation(workspace), [makeCodexTurnDiffMessage(filePath, beforeText, afterText)]);
    const coordinator = new TurnSnapshotCoordinator(repo, {
      now: () => 400,
      createId: () => 'unsupported-turn-id',
      readWorkspaceFile: async (targetPath) => fs.promises.readFile(targetPath, 'utf8'),
      drainWrites: async () => undefined,
    });

    await coordinator.startTurn({
      conversationId: 'conversation-1',
      backend: 'codex',
      requestMessageId: 'request-3',
      startedAt: 10,
    });
    await coordinator.completeTurn({
      conversationId: 'conversation-1',
      completionSignal: 'finish',
      completionSource: 'task_complete',
    });

    expect(repo.createdSnapshots).toHaveLength(1);
    expect(repo.currentSnapshot?.reviewStatus).toBe('unsupported');
    expect(repo.currentSnapshot?.files[0]?.revertSupported).toBe(false);
    expect(repo.currentSnapshot?.files[0]?.revertError).toBe('Failed to reverse codex turn diff patch.');
    expect(repo.currentSnapshot?.files[0]?.beforeContent).toBeUndefined();
    expect(repo.currentSnapshot?.files[0]?.afterContent).toBe('const version = 999;\n');
  });
});
