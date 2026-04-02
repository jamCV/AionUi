import { beforeEach, describe, expect, it, vi } from 'vitest';

type TMessage = {
  id: string;
  msg_id: string;
  conversation_id: string;
  type: string;
  position: string;
  content?: string | { content?: string };
  createdAt: number;
};

type TChatConversation = {
  id: string;
  name: string;
  createTime: number;
  modifyTime: number;
  type: string;
  model: {
    id: string;
    name: string;
    useModel: string;
    platform: string;
    baseUrl: string;
    apiKey: string;
  };
  status?: string;
  extra: Record<string, unknown> & {
    workspace?: string;
    team?: Record<string, unknown>;
  };
};

const { mockListTurnSnapshots, mockGetTurnSnapshot, mockListChangedEmit, mockStartTurn, mockDiscardTurn, mockBuildStorage } =
  vi.hoisted(() => ({
    mockListTurnSnapshots: vi.fn(),
    mockGetTurnSnapshot: vi.fn(),
    mockListChangedEmit: vi.fn(),
    mockStartTurn: vi.fn(),
    mockDiscardTurn: vi.fn(),
    mockBuildStorage: vi.fn(() => ({
      get: vi.fn(),
      set: vi.fn(),
      remove: vi.fn(),
      clear: vi.fn(),
    })),
  }));

vi.mock('@office-ai/platform', () => ({
  bridge: {
    buildProvider: vi.fn(() => ({
      provider: vi.fn(),
      invoke: vi.fn(),
    })),
    buildEmitter: vi.fn(() => ({
      emit: vi.fn(),
      on: vi.fn(),
    })),
    adapter: vi.fn(),
  },
  storage: {
    buildStorage: mockBuildStorage,
  },
}));

vi.mock('@/common/platform', () => ({
  getPlatformServices: () => ({
    paths: {
      getDataDir: () => 'E:/data',
      getTempDir: () => 'E:/temp',
      getHomeDir: () => 'E:/home',
      getLogsDir: () => 'E:/logs',
      getAppPath: () => 'E:/app',
      isPackaged: () => false,
      getSystemPath: () => 'E:/system',
      getName: () => 'AionUi',
      getVersion: () => '0.0.0-test',
      needsCliSafeSymlinks: () => false,
    },
    worker: {
      fork: vi.fn(),
    },
    power: {
      preventSleep: () => null,
      allowSleep: () => {},
    },
    notification: {
      send: () => {},
    },
  }),
}));

vi.mock('@/common/config/storage', () => ({
  ChatStorage: {},
  ChatMessageStorage: {},
  ConfigStorage: {},
  EnvStorage: {},
}));

vi.mock('@process/utils/initStorage', () => ({
  getAssistantsDir: () => 'E:/assistants',
  ProcessConfig: {
    get: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('@process/extensions', () => ({
  ExtensionRegistry: {
    getInstance: () => ({
      getAssistants: () => [],
    }),
  },
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      listChanged: {
        emit: (...args: unknown[]) => mockListChangedEmit(...args),
      },
    },
  },
}));

vi.mock('@process/task/MessageMiddleware', () => ({
  extractTextFromMessage: (message: TMessage) => {
    if (!message.content) {
      return '';
    }
    if (typeof message.content === 'string') {
      return message.content;
    }
    if (typeof message.content === 'object' && 'content' in message.content) {
      const contentObj = message.content as { content?: string };
      return contentObj.content ?? '';
    }
    return '';
  },
}));

vi.mock('@process/bridge/services/TurnSnapshotCoordinator', () => ({
  turnSnapshotCoordinator: {
    startTurn: (...args: unknown[]) => mockStartTurn(...args),
    discardTurn: (...args: unknown[]) => mockDiscardTurn(...args),
  },
}));

vi.mock('@process/bridge/services/TurnSnapshotService', () => ({
  turnSnapshotService: {
    listTurnSnapshots: (...args: unknown[]) => mockListTurnSnapshots(...args),
    getTurnSnapshot: (...args: unknown[]) => mockGetTurnSnapshot(...args),
  },
}));

vi.mock('@/process/team/AssistantCatalogService', () => ({
  AssistantCatalogService: class AssistantCatalogService {},
}));

let TeamOrchestratorServiceClass: typeof import('@/process/team/TeamOrchestratorService').TeamOrchestratorService;

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

const makeAssistantMessage = (content: string, overrides?: Partial<TMessage>): TMessage =>
  ({
    id: 'msg-1',
    msg_id: 'msg-1',
    conversation_id: 'sub-1',
    type: 'text',
    position: 'left',
    content: { content },
    createdAt: 1,
    ...overrides,
  }) as TMessage;

describe('TeamOrchestratorService', () => {
  let service: import('@/process/team/TeamOrchestratorService').TeamOrchestratorService;
  const teamRepo = {
    findTeamRunByMainConversationId: vi.fn(),
    listTeamTasksByRun: vi.fn(),
    listTeamTasksByParentConversationId: vi.fn(),
    getTeamRun: vi.fn(),
    updateTeamRun: vi.fn(),
    createTeamTask: vi.fn(),
    getTeamTask: vi.fn(),
    updateTeamTask: vi.fn(),
    createTeamRun: vi.fn(),
  };
  const conversationRepo = {
    getMessages: vi.fn(),
  };
  const conversationService = {
    getConversation: vi.fn(),
    updateConversation: vi.fn(),
    createConversation: vi.fn(),
  };
  const workerTaskManager = {
    getTask: vi.fn(),
    getOrBuildTask: vi.fn(),
  };
  const assistantCatalogService = {
    selectAssistant: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    mockListTurnSnapshots.mockResolvedValue([]);
    mockGetTurnSnapshot.mockResolvedValue(undefined);
    mockListChangedEmit.mockReset();
    mockStartTurn.mockResolvedValue(undefined);
    mockDiscardTurn.mockResolvedValue(undefined);
    teamRepo.findTeamRunByMainConversationId.mockReset();
    teamRepo.listTeamTasksByRun.mockReset();
    teamRepo.listTeamTasksByParentConversationId.mockReset();
    teamRepo.getTeamRun.mockReset();
    teamRepo.updateTeamRun.mockReset();
    teamRepo.createTeamTask.mockReset();
    teamRepo.getTeamTask.mockReset();
    teamRepo.updateTeamTask.mockReset();
    teamRepo.createTeamRun.mockReset();
    conversationRepo.getMessages.mockReset();
    conversationService.getConversation.mockReset();
    conversationService.updateConversation.mockReset();
    conversationService.createConversation.mockReset();
    workerTaskManager.getTask.mockReset();
    workerTaskManager.getOrBuildTask.mockReset();
    assistantCatalogService.selectAssistant.mockReset();

    if (!TeamOrchestratorServiceClass) {
      ({ TeamOrchestratorService: TeamOrchestratorServiceClass } = await import('@/process/team/TeamOrchestratorService'));
    }

    service = new TeamOrchestratorServiceClass(
      teamRepo as never,
      conversationRepo as never,
      conversationService as never,
      workerTaskManager as never,
      assistantCatalogService as never
    );
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

  it('strips hidden team command blocks from visible task summaries', async () => {
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
      data: [
        makeAssistantMessage(
          'Visible summary\n<aionui-team-command hidden>{"action":"delegate","title":"x","taskPrompt":"y"}</aionui-team-command>\nDone'
        ),
      ],
    });
    mockListTurnSnapshots.mockResolvedValue([]);

    const result = await service.getTeamRunView('main-1');

    expect(result?.tasks[0]?.summary).toBe('Visible summary\nDone');
  });

  it('ignores visible team command json when no trusted event command is provided', async () => {
    conversationService.getConversation.mockResolvedValue(makeConversation('main-1'));
    conversationRepo.getMessages.mockResolvedValue({
      data: [
        makeAssistantMessage('{"action":"delegate","title":"Investigate","taskPrompt":"Do the work"}', {
          conversation_id: 'main-1',
        }),
      ],
    });

    await service.handleMainTurnCompleted('main-1', {
      conversationId: 'main-1',
      assistantMessageId: 'msg-1',
      completionSignal: 'finish',
      completionSource: 'task_complete',
    });

    expect(assistantCatalogService.selectAssistant).not.toHaveBeenCalled();
    expect(teamRepo.createTeamTask).not.toHaveBeenCalled();
    expect(conversationService.updateConversation).not.toHaveBeenCalled();
  });

  it('creates a delegated task when a trusted team command is provided by the completion event', async () => {
    conversationService.getConversation.mockResolvedValue(makeConversation('main-1'));
    conversationRepo.getMessages.mockResolvedValue({
      data: [
        makeAssistantMessage('ordinary visible text', {
          conversation_id: 'main-1',
        }),
      ],
    });

    const createdTask = {
      id: 'task-1',
      runId: 'run-1',
      parentConversationId: 'main-1',
      assistantId: 'assistant-1',
      assistantName: 'Research Assistant',
      status: 'queued',
      title: 'Investigate bug',
      taskPrompt: 'Check the root cause',
      selectionMode: 'recommended',
      selectionReason: 'preset match',
      assistantBinding: {
        descriptorId: 'assistant-1',
        assistantName: 'Research Assistant',
        runtime: 'codex',
        createConversationParams: {
          type: 'codex',
          extra: {},
        },
      },
      ownedPaths: [],
      createdAt: 1,
      updatedAt: 2,
    };

    teamRepo.findTeamRunByMainConversationId.mockResolvedValueOnce(undefined);
    teamRepo.createTeamRun.mockResolvedValue({
      id: 'run-1',
      mainConversationId: 'main-1',
      rootConversationId: 'main-1',
      status: 'running',
      currentPhase: 'delegating',
      awaitingUserInput: false,
      activeTaskCount: 0,
      createdAt: 1,
      updatedAt: 2,
    });
    teamRepo.createTeamTask.mockResolvedValue(createdTask);
    teamRepo.getTeamTask
      .mockResolvedValueOnce(createdTask)
      .mockResolvedValueOnce({
        ...createdTask,
        subConversationId: 'sub-1',
      });
    teamRepo.listTeamTasksByRun.mockResolvedValue([]);
    teamRepo.getTeamRun.mockResolvedValue({
      id: 'run-1',
      mainConversationId: 'main-1',
      rootConversationId: 'main-1',
      status: 'running',
      currentPhase: 'delegating',
      awaitingUserInput: false,
      activeTaskCount: 0,
      createdAt: 1,
      updatedAt: 2,
    });
    assistantCatalogService.selectAssistant.mockResolvedValue({
      assistantId: 'assistant-1',
      assistantName: 'Research Assistant',
      selectionMode: 'recommended',
      selectionReason: 'preset match',
      binding: {
        descriptorId: 'assistant-1',
        assistantName: 'Research Assistant',
        runtime: 'codex',
        createConversationParams: {
          type: 'codex',
          extra: {},
        },
      },
    });
    conversationService.createConversation.mockResolvedValue(
      makeConversation('sub-1', {
        type: 'codex',
        extra: {
          workspace: 'E:/workspace',
        },
      })
    );
    conversationService.updateConversation.mockResolvedValue(undefined);
    workerTaskManager.getOrBuildTask.mockResolvedValue({
      sendMessage: vi.fn().mockResolvedValue({ success: true }),
    });

    await service.handleMainTurnCompleted('main-1', {
      conversationId: 'main-1',
      assistantMessageId: 'msg-1',
      completionSignal: 'finish',
      completionSource: 'task_complete',
      teamCommand: {
        action: 'delegate',
        title: 'Investigate bug',
        taskPrompt: 'Check the root cause',
      },
    });

    expect(assistantCatalogService.selectAssistant).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'main-1' }),
      expect.objectContaining({ action: 'delegate', title: 'Investigate bug' })
    );
    expect(teamRepo.createTeamTask).toHaveBeenCalled();
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
