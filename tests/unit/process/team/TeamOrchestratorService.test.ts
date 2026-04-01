import type { TMessage } from '@/common/chat/chatLib';
import type { TChatConversation } from '@/common/config/storage';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockListTurnSnapshots = vi.fn();
const mockGetTurnSnapshot = vi.fn();

vi.mock('@process/bridge/services/TurnSnapshotService', () => ({
  turnSnapshotService: {
    listTurnSnapshots: (...args: unknown[]) => mockListTurnSnapshots(...args),
    getTurnSnapshot: (...args: unknown[]) => mockGetTurnSnapshot(...args),
  },
}));

import { TeamOrchestratorService } from '@/process/team/TeamOrchestratorService';

const makeConversation = (id: string, overrides?: Partial<TChatConversation>): TChatConversation =>
  ({
    id,
    name: id,
    createTime: 1,
    modifyTime: 2,
    type: 'gemini',
    model: {
      id: 'provider-1',
      name: 'Gemini',
      useModel: 'gemini-2.5-pro',
      platform: 'gemini-with-google-auth',
      baseUrl: '',
      apiKey: '',
    },
    extra: {
      workspace: 'E:/workspace',
    },
    ...overrides,
  }) as TChatConversation;

const makeAssistantMessage = (content: string): TMessage =>
  ({
    id: 'msg-1',
    msg_id: 'msg-1',
    conversation_id: 'sub-1',
    type: 'text',
    position: 'left',
    content: { content },
    createdAt: 1,
  }) as TMessage;

describe('TeamOrchestratorService', () => {
  const teamRepo = {
    findTeamRunByMainConversationId: vi.fn(),
    listTeamTasksByRun: vi.fn(),
    listTeamTasksByParentConversationId: vi.fn(),
  };
  const conversationRepo = {
    getMessages: vi.fn(),
  };
  const conversationService = {
    getConversation: vi.fn(),
  };
  const workerTaskManager = {
    getTask: vi.fn(),
  };

  const service = new TeamOrchestratorService(
    teamRepo as never,
    conversationRepo as never,
    conversationService as never,
    workerTaskManager as never
  );

  beforeEach(() => {
    vi.clearAllMocks();
    mockListTurnSnapshots.mockResolvedValue([]);
    mockGetTurnSnapshot.mockResolvedValue(undefined);
  });

  it('builds a team run view with task summaries and touched files', async () => {
    const run = {
      id: 'run-1',
      mainConversationId: 'main-1',
      rootConversationId: 'main-1',
      status: 'running',
      currentPhase: 'subtask_running',
      awaitingUserInput: false,
      activeTaskCount: 1,
      createdAt: 1,
      updatedAt: 2,
    };
    const task = {
      id: 'task-1',
      runId: 'run-1',
      parentConversationId: 'main-1',
      subConversationId: 'sub-1',
      assistantId: 'builtin-researcher',
      assistantName: 'Research Assistant',
      status: 'running',
      title: 'Investigate bug',
      taskPrompt: 'Check the root cause',
      selectionMode: 'recommended',
      selectionReason: 'preset match',
      ownedPaths: ['src/app.ts'],
      createdAt: 1,
      updatedAt: 2,
    };

    conversationService.getConversation.mockResolvedValue(makeConversation('main-1'));
    teamRepo.findTeamRunByMainConversationId.mockResolvedValue(run);
    teamRepo.listTeamTasksByRun.mockResolvedValue([task]);
    conversationRepo.getMessages.mockResolvedValue({
      data: [makeAssistantMessage('Patch ready for review')],
    });
    mockListTurnSnapshots.mockResolvedValue([{ id: 'turn-1' }]);
    mockGetTurnSnapshot.mockResolvedValue({
      files: [{ filePath: 'src/app.ts' }, { filePath: 'tests/app.test.ts' }],
    });

    const result = await service.getTeamRunView('main-1');

    expect(result).toMatchObject({
      run,
      tasks: [
        {
          id: 'task-1',
          summary: 'Patch ready for review',
          touchedFiles: ['src/app.ts', 'tests/app.test.ts'],
        },
      ],
    });
    expect(teamRepo.findTeamRunByMainConversationId).toHaveBeenCalledWith('main-1');
  });

  it('lists child conversations from a subagent conversation id', async () => {
    const subagentConversation = makeConversation('subagent-parent', {
      extra: {
        workspace: 'E:/workspace',
        team: {
          runId: 'run-1',
          role: 'subagent',
          rootConversationId: 'main-1',
          parentConversationId: 'main-1',
          taskId: 'task-parent',
        },
      },
    });
    const childConversation = makeConversation('child-1', {
      name: 'Child Conversation',
      status: 'running',
      extra: {
        workspace: 'E:/workspace',
        team: {
          runId: 'run-1',
          role: 'subagent',
          rootConversationId: 'main-1',
          parentConversationId: 'main-1',
          taskId: 'task-1',
        },
      },
    });
    const task = {
      id: 'task-1',
      runId: 'run-1',
      parentConversationId: 'main-1',
      subConversationId: 'child-1',
      assistantId: 'builtin-researcher',
      assistantName: 'Research Assistant',
      status: 'running',
      title: 'Investigate bug',
      taskPrompt: 'Check the root cause',
      selectionMode: 'recommended',
      ownedPaths: [],
      createdAt: 1,
      updatedAt: 2,
    };

    conversationService.getConversation.mockImplementation(async (conversationId: string) => {
      if (conversationId === 'subagent-parent') {
        return subagentConversation;
      }

      if (conversationId === 'child-1') {
        return childConversation;
      }

      return undefined;
    });
    teamRepo.listTeamTasksByParentConversationId.mockResolvedValue([task]);
    conversationRepo.getMessages.mockResolvedValue({
      data: [makeAssistantMessage('Investigating the failing path')],
    });

    const result = await service.listChildConversations('subagent-parent');

    expect(result).toEqual([
      {
        taskId: 'task-1',
        parentConversationId: 'main-1',
        rootConversationId: 'main-1',
        subConversationId: 'child-1',
        title: 'Investigate bug',
        assistantId: 'builtin-researcher',
        assistantName: 'Research Assistant',
        status: 'running',
        conversationName: 'Child Conversation',
        conversationStatus: 'running',
        updatedAt: 2,
        summary: 'Investigating the failing path',
      },
    ]);
  });
});
