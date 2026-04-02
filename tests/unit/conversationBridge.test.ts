import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('electron', () => ({ app: { isPackaged: false, getPath: vi.fn(() => '/tmp') } }));

// Capture provider handlers so tests can invoke them directly
const handlers: Record<string, (...args: any[]) => any> = {};
const { turnSnapshotServiceMock, turnSnapshotCoordinatorMock } = vi.hoisted(() => ({
  turnSnapshotServiceMock: {
    listTurnSnapshots: vi.fn(async () => []),
    getTurnSnapshot: vi.fn(async () => undefined),
    keepTurn: vi.fn(async () => ({ success: true, turnId: 'turn-1', reviewStatus: 'kept' as const })),
    autoKeepPendingTurn: vi.fn(async () => undefined),
    revertTurn: vi.fn(async () => ({
      success: true,
      turnId: 'turn-1',
      status: 'reverted' as const,
      reviewStatus: 'reverted' as const,
    })),
  },
  turnSnapshotCoordinatorMock: {
    startTurn: vi.fn(async () => undefined),
    discardTurn: vi.fn(async () => undefined),
    completeTurn: vi.fn(async () => undefined),
  },
}));

function makeChannel(name: string) {
  return {
    provider: vi.fn((fn: (...args: any[]) => any) => {
      handlers[name] = fn;
    }),
    emit: vi.fn(),
    invoke: vi.fn(),
  };
}

vi.mock('../../src/common', () => ({
  ipcBridge: {
    conversation: {
      create: makeChannel('create'),
      createWithConversation: makeChannel('createWithConversation'),
      get: makeChannel('get'),
      getAssociateConversation: makeChannel('getAssociateConversation'),
      remove: makeChannel('remove'),
      update: makeChannel('update'),
      reset: makeChannel('reset'),
      stop: makeChannel('stop'),
      sendMessage: makeChannel('sendMessage'),
      getSlashCommands: makeChannel('getSlashCommands'),
      reloadContext: makeChannel('reloadContext'),
      getWorkspace: makeChannel('getWorkspace'),
      responseSearchWorkSpace: makeChannel('responseSearchWorkSpace'),
      warmup: makeChannel('warmup'),
      turnSnapshot: {
        list: makeChannel('turnSnapshot.list'),
        get: makeChannel('turnSnapshot.get'),
        keep: makeChannel('turnSnapshot.keep'),
        revert: makeChannel('turnSnapshot.revert'),
      },
      team: {
        getRunView: makeChannel('conversation.team.getRunView'),
        listChildConversations: makeChannel('conversation.team.listChildConversations'),
      },
      confirmation: {
        confirm: makeChannel('confirmation.confirm'),
        list: makeChannel('confirmation.list'),
      },
      approval: {
        check: makeChannel('approval.check'),
      },
      listChanged: { emit: vi.fn() },
    },
    openclawConversation: {
      getRuntime: makeChannel('openclawConversation.getRuntime'),
    },
  },
}));

vi.mock('../../src/process/utils/initStorage', () => ({
  ProcessChat: { get: vi.fn(async () => []) },
  ProcessConfig: { get: vi.fn(async () => undefined) },
  getSkillsDir: vi.fn(() => '/skills'),
  getBuiltinSkillsCopyDir: vi.fn(() => '/skills/_builtin'),
  getSystemDir: vi.fn(() => ({ cacheDir: '/tmp/cache', workDir: '/tmp/work' })),
}));

vi.mock('../../src/process/bridge/migrationUtils', () => ({
  migrateConversationToDatabase: vi.fn(async () => {}),
}));

vi.mock('../../src/process/bridge/services/TurnSnapshotService', () => ({
  turnSnapshotService: turnSnapshotServiceMock,
}));

vi.mock('../../src/process/bridge/services/TurnSnapshotCoordinator', () => ({
  turnSnapshotCoordinator: turnSnapshotCoordinatorMock,
}));

vi.mock('../../src/agent/gemini', () => ({
  GeminiAgent: { buildFileServer: vi.fn(() => ({})) },
  GeminiApprovalStore: { createKeysFromConfirmation: vi.fn(() => []) },
}));

vi.mock('../../src/process/utils', () => ({
  copyFilesToDirectory: vi.fn(async () => []),
  readDirectoryRecursive: vi.fn(async () => null),
}));

vi.mock('../../src/process/utils/openclawUtils', () => ({
  computeOpenClawIdentityHash: vi.fn(async () => 'hash'),
}));

vi.mock('../../src/process/task/agentUtils', () => ({
  prepareFirstMessage: vi.fn(async (msg: string) => msg),
}));

import { initConversationBridge } from '../../src/process/bridge/conversationBridge';
import type { IConversationService } from '../../src/process/services/IConversationService';
import type { IWorkerTaskManager } from '../../src/process/task/IWorkerTaskManager';
import type { TChatConversation } from '../../src/common/config/storage';

function makeService(overrides?: Partial<IConversationService>): IConversationService {
  return {
    createConversation: vi.fn(),
    deleteConversation: vi.fn(),
    updateConversation: vi.fn(),
    getConversation: vi.fn(async () => undefined),
    createWithMigration: vi.fn(),
    listAllConversations: vi.fn(async () => []),
    ...overrides,
  };
}

function makeTaskManager(overrides?: Partial<IWorkerTaskManager>): IWorkerTaskManager {
  return {
    getTask: vi.fn(() => undefined),
    getOrBuildTask: vi.fn(async () => {
      throw new Error('not found');
    }),
    addTask: vi.fn(),
    kill: vi.fn(),
    clear: vi.fn(),
    listTasks: vi.fn(() => []),
    ...overrides,
  };
}

function makeConversation(id: string, workspace = '/ws'): TChatConversation {
  return { id, type: 'gemini', name: 'test', extra: { workspace } } as unknown as TChatConversation;
}

describe('conversationBridge', () => {
  let service: IConversationService;
  let taskManager: IWorkerTaskManager;

  beforeEach(() => {
    vi.clearAllMocks();
    turnSnapshotServiceMock.listTurnSnapshots.mockResolvedValue([]);
    turnSnapshotServiceMock.getTurnSnapshot.mockResolvedValue(undefined);
    turnSnapshotServiceMock.keepTurn.mockResolvedValue({ success: true, turnId: 'turn-1', reviewStatus: 'kept' });
    turnSnapshotServiceMock.autoKeepPendingTurn.mockResolvedValue(undefined);
    turnSnapshotServiceMock.revertTurn.mockResolvedValue({
      success: true,
      turnId: 'turn-1',
      status: 'reverted',
      reviewStatus: 'reverted',
    });
    turnSnapshotCoordinatorMock.startTurn.mockResolvedValue(undefined);
    turnSnapshotCoordinatorMock.discardTurn.mockResolvedValue(undefined);
    turnSnapshotCoordinatorMock.completeTurn.mockResolvedValue(undefined);
    // Re-register providers by re-initializing the bridge
    service = makeService();
    taskManager = makeTaskManager();
    initConversationBridge(service, taskManager);
  });

  describe('getAssociateConversation — listAllConversations path', () => {
    it('returns data from injected service without calling getDatabase()', async () => {
      const current = makeConversation('c1', '/ws/project');
      const sibling = makeConversation('c2', '/ws/project');
      const other = makeConversation('c3', '/other');

      vi.mocked(service.getConversation).mockResolvedValue(current);
      vi.mocked(service.listAllConversations).mockResolvedValue([current, sibling, other]);

      const handler = handlers['getAssociateConversation'];
      const result = await handler({ conversation_id: 'c1' });

      expect(service.listAllConversations).toHaveBeenCalled();
      // Only conversations with matching workspace should be returned
      expect(result).toHaveLength(2);
      expect(result.map((c: TChatConversation) => c.id)).toEqual(expect.arrayContaining(['c1', 'c2']));
    });

    it('returns empty array when repo returns empty list', async () => {
      const current = makeConversation('c1', '/ws/project');
      vi.mocked(service.getConversation).mockResolvedValue(current);
      vi.mocked(service.listAllConversations).mockResolvedValue([]);

      const handler = handlers['getAssociateConversation'];
      const result = await handler({ conversation_id: 'c1' });

      expect(result).toEqual([]);
    });

    it('returns empty array when current conversation has no workspace', async () => {
      const noWorkspace = { id: 'c1', type: 'gemini', name: 'test', extra: {} } as unknown as TChatConversation;
      vi.mocked(service.getConversation).mockResolvedValue(noWorkspace);

      const handler = handlers['getAssociateConversation'];
      const result = await handler({ conversation_id: 'c1' });

      expect(result).toEqual([]);
      // Should not call listAllConversations when conversation has no workspace
      expect(service.listAllConversations).not.toHaveBeenCalled();
    });

    it('returns empty array when current conversation is not found', async () => {
      vi.mocked(service.getConversation).mockResolvedValue(undefined);

      const handler = handlers['getAssociateConversation'];
      const result = await handler({ conversation_id: 'missing' });

      expect(result).toEqual([]);
    });
  });

  describe('createWithConversation — getOrBuildTask rejection', () => {
    it('does not produce unhandled rejection when getOrBuildTask fails', async () => {
      const conversation = makeConversation('new-id');
      vi.mocked(service.createWithMigration).mockResolvedValue(conversation);

      // getOrBuildTask rejects (conversation not yet persisted — race condition)
      const rejectingTaskManager = makeTaskManager({
        getOrBuildTask: vi.fn().mockRejectedValue(new Error('Conversation not found: new-id')),
      });
      initConversationBridge(service, rejectingTaskManager);

      // Should complete without throwing / unhandled rejection
      const result = await handlers['createWithConversation']({
        conversation,
        sourceConversationId: undefined,
        migrateCron: false,
      });

      expect(result).toEqual(conversation);
      expect(rejectingTaskManager.getOrBuildTask).toHaveBeenCalledWith('new-id');
    });
  });

  describe('getWorkspace — ENOENT handling', () => {
    it('passes applyIgnoreRules false to workspace tree reads', async () => {
      const utilsMod = await vi.importMock<typeof import('../../src/process/utils')>('../../src/process/utils');
      const tree = {
        name: '.agent',
        fullPath: '/ws/.agent',
        relativePath: '.agent',
        isDir: true,
        isFile: false,
        children: [],
      };
      utilsMod.readDirectoryRecursive.mockResolvedValueOnce(tree);

      const handler = handlers['getWorkspace'];
      const result = await handler({ workspace: '/ws', path: '/ws', search: '' });

      expect(utilsMod.readDirectoryRecursive).toHaveBeenCalledWith(
        '/ws',
        expect.objectContaining({
          root: '/ws',
          applyIgnoreRules: false,
          maxDepth: 10,
        })
      );
      expect(result).toEqual([tree]);
    });

    it('returns empty array when buildFileServer throws', async () => {
      const geminiMod = await vi.importMock<typeof import('../../src/agent/gemini')>('../../src/agent/gemini');
      geminiMod.GeminiAgent.buildFileServer.mockImplementation(() => {
        throw new Error('ENOENT: no such file or directory');
      });

      const handler = handlers['getWorkspace'];
      const result = await handler({ workspace: '/missing/path', path: '/missing/path', search: '' });

      expect(result).toEqual([]);
      geminiMod.GeminiAgent.buildFileServer.mockReturnValue({});
    });

    it('returns empty array when readDirectoryRecursive rejects with ENOENT', async () => {
      const utilsMod = await vi.importMock<typeof import('../../src/process/utils')>('../../src/process/utils');
      utilsMod.readDirectoryRecursive.mockRejectedValueOnce(new Error('ENOENT: no such file or directory, stat'));

      const handler = handlers['getWorkspace'];
      const result = await handler({ workspace: '/missing', path: '/missing', search: '' });

      expect(result).toEqual([]);
    });
  });

  describe('sendMessage — copyFilesToDirectory failure', () => {
    it('does not reject when copyFilesToDirectory throws ENOENT', async () => {
      const utilsMod = await vi.importMock<typeof import('../../src/process/utils')>('../../src/process/utils');
      utilsMod.copyFilesToDirectory.mockRejectedValueOnce(new Error('ENOENT: no such file or directory, stat'));

      const mockTask = {
        workspace: '/deleted/workspace',
        sendMessage: vi.fn().mockResolvedValue(undefined),
      };
      const tm = makeTaskManager({
        getOrBuildTask: vi.fn().mockResolvedValue(mockTask),
      });
      initConversationBridge(service, tm);

      const handler = handlers['sendMessage'];
      const result = await handler({
        conversation_id: 'c1',
        input: 'hello',
        files: ['/some/file.txt'],
      });

      expect(result).toEqual({ success: true });
      // sendMessage should still be called with empty files array
      expect(mockTask.sendMessage).toHaveBeenCalled();
    });

    it('auto-keeps the previous pending turn before starting a tracked backend turn', async () => {
      const conversation = { id: 'c1', type: 'codex', name: 'test', extra: { workspace: '/ws' } } as TChatConversation;
      const mockTask = {
        type: 'codex',
        workspace: '/ws',
        sendMessage: vi.fn().mockResolvedValue(undefined),
      };

      vi.mocked(service.getConversation).mockResolvedValue(conversation);

      const tm = makeTaskManager({
        getOrBuildTask: vi.fn().mockResolvedValue(mockTask),
      });
      initConversationBridge(service, tm);

      const result = await handlers['sendMessage']({
        conversation_id: 'c1',
        input: 'hello',
        files: [],
        msg_id: 'm1',
      });

      expect(result).toEqual({ success: true });
      expect(turnSnapshotServiceMock.autoKeepPendingTurn).toHaveBeenCalledWith('c1');
      expect(turnSnapshotCoordinatorMock.startTurn).toHaveBeenCalledWith({
        conversationId: 'c1',
        backend: 'codex',
        requestMessageId: 'm1',
      });
      expect(turnSnapshotServiceMock.autoKeepPendingTurn.mock.invocationCallOrder[0]).toBeLessThan(
        turnSnapshotCoordinatorMock.startTurn.mock.invocationCallOrder[0]
      );
    });
  });

  describe('session cleanup auto-keep', () => {
    it('auto-keeps before removing a conversation', async () => {
      vi.mocked(service.getConversation).mockResolvedValue(makeConversation('c1'));

      const result = await handlers['remove']({ id: 'c1' });

      expect(result).toBe(true);
      expect(turnSnapshotServiceMock.autoKeepPendingTurn).toHaveBeenCalledWith('c1');
      expect(taskManager.kill).toHaveBeenCalledWith('c1');
      expect(turnSnapshotServiceMock.autoKeepPendingTurn.mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(taskManager.kill).mock.invocationCallOrder[0]
      );
      expect(service.deleteConversation).toHaveBeenCalledWith('c1');
    });

    it('auto-keeps before resetting a single conversation', async () => {
      await handlers['reset']({ id: 'c1' });

      expect(turnSnapshotServiceMock.autoKeepPendingTurn).toHaveBeenCalledWith('c1');
      expect(taskManager.kill).toHaveBeenCalledWith('c1');
      expect(turnSnapshotServiceMock.autoKeepPendingTurn.mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(taskManager.kill).mock.invocationCallOrder[0]
      );
      expect(taskManager.clear).not.toHaveBeenCalled();
    });
  });

  describe('warmup', () => {
    it('calls getOrBuildTask for the given conversation_id', async () => {
      const handler = handlers['warmup'];
      await handler({ conversation_id: 'test-id' });

      expect(taskManager.getOrBuildTask).toHaveBeenCalledWith('test-id');
    });

    it('calls initAgent() when task type is "acp"', async () => {
      const initAgent = vi.fn();
      const acpTask = { type: 'acp', initAgent };
      vi.mocked(taskManager.getOrBuildTask).mockResolvedValue(acpTask as any);

      const handler = handlers['warmup'];
      await handler({ conversation_id: 'acp-id' });

      expect(taskManager.getOrBuildTask).toHaveBeenCalledWith('acp-id');
      expect(initAgent).toHaveBeenCalled();
    });

    it('does not call initAgent when task type is not "acp"', async () => {
      const initAgent = vi.fn();
      const geminiTask = { type: 'gemini', initAgent };
      vi.mocked(taskManager.getOrBuildTask).mockResolvedValue(geminiTask as any);

      const handler = handlers['warmup'];
      await handler({ conversation_id: 'gemini-id' });

      expect(taskManager.getOrBuildTask).toHaveBeenCalledWith('gemini-id');
      expect(initAgent).not.toHaveBeenCalled();
    });

    it('silently ignores errors (best-effort)', async () => {
      vi.mocked(taskManager.getOrBuildTask).mockRejectedValue(new Error('Task build failed'));

      const handler = handlers['warmup'];
      // Should not throw
      await expect(handler({ conversation_id: 'failing-id' })).resolves.toBeUndefined();

      expect(taskManager.getOrBuildTask).toHaveBeenCalledWith('failing-id');
    });
  });

  describe('turnSnapshot providers', () => {
    it('lists snapshots for a conversation', async () => {
      const snapshots = [
        {
          id: 'turn-1',
          conversationId: 'c1',
          backend: 'acp:codex',
          startedAt: 1,
          completedAt: 2,
          completionSignal: 'finish',
          reviewStatus: 'pending',
          fileCount: 1,
          sourceMessageIds: ['m1'],
          createdAt: 2,
          updatedAt: 2,
        },
      ];
      turnSnapshotServiceMock.listTurnSnapshots.mockResolvedValue(snapshots);

      const result = await handlers['turnSnapshot.list']({ conversation_id: 'c1', limit: 10 });

      expect(turnSnapshotServiceMock.listTurnSnapshots).toHaveBeenCalledWith('c1', 10);
      expect(result).toEqual(snapshots);
    });

    it('gets a single turn snapshot', async () => {
      const snapshot = {
        id: 'turn-1',
        conversationId: 'c1',
        backend: 'acp:codex',
        startedAt: 1,
        completedAt: 2,
        completionSignal: 'finish',
        reviewStatus: 'pending',
        fileCount: 1,
        sourceMessageIds: ['m1'],
        createdAt: 2,
        updatedAt: 2,
        files: [],
      };
      turnSnapshotServiceMock.getTurnSnapshot.mockResolvedValue(snapshot);

      const result = await handlers['turnSnapshot.get']({ turnId: 'turn-1' });

      expect(turnSnapshotServiceMock.getTurnSnapshot).toHaveBeenCalledWith('turn-1');
      expect(result).toEqual(snapshot);
    });

    it('keeps a turn snapshot through the service', async () => {
      const keepResult = {
        success: true,
        turnId: 'turn-1',
        reviewStatus: 'kept' as const,
      };
      turnSnapshotServiceMock.keepTurn.mockResolvedValue(keepResult);

      const result = await handlers['turnSnapshot.keep']({ turnId: 'turn-1' });

      expect(turnSnapshotServiceMock.keepTurn).toHaveBeenCalledWith('turn-1');
      expect(result).toEqual(keepResult);
    });

    it('reverts a turn snapshot through the service', async () => {
      const revertResult = {
        success: false,
        turnId: 'turn-1',
        status: 'conflict' as const,
        reviewStatus: 'conflict' as const,
        conflicts: [{ filePath: 'src/example.ts', expectedExists: true, actualExists: true }],
      };
      turnSnapshotServiceMock.revertTurn.mockResolvedValue(revertResult);

      const result = await handlers['turnSnapshot.revert']({ turnId: 'turn-1' });

      expect(turnSnapshotServiceMock.revertTurn).toHaveBeenCalledWith('turn-1');
      expect(result).toEqual(revertResult);
    });
  });
});
