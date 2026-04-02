import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TurnSnapshot } from '@/common/types/turnSnapshot';
import type { IConversationTeamChildConversation, IConversationTeamRunView } from '@/common/adapter/ipcBridge';

let liveHandler: ((event: { conversationId: string; summary: TurnSnapshot; reason: string }) => void) | undefined;
let listChangedHandler: ((event: { conversationId: string; action: string }) => void) | undefined;

const mockListInvoke = vi.fn();
const mockGetInvoke = vi.fn();
const mockKeepInvoke = vi.fn();
const mockRevertInvoke = vi.fn();
const mockTeamGetRunViewInvoke = vi.fn();
const mockTeamListChildConversationsInvoke = vi.fn();
const mockLaunchPreview = vi.fn();
const mockMessageSuccess = vi.fn();
const mockMessageError = vi.fn();

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      listChanged: {
        on: (handler: typeof listChangedHandler) => {
          listChangedHandler = handler;
          return () => {
            if (listChangedHandler === handler) {
              listChangedHandler = undefined;
            }
          };
        },
      },
      turnSnapshot: {
        list: { invoke: (...args: unknown[]) => mockListInvoke(...args) },
        get: { invoke: (...args: unknown[]) => mockGetInvoke(...args) },
        keep: { invoke: (...args: unknown[]) => mockKeepInvoke(...args) },
        revert: { invoke: (...args: unknown[]) => mockRevertInvoke(...args) },
        live: {
          on: (handler: typeof liveHandler) => {
            liveHandler = handler;
            return () => {
              if (liveHandler === handler) {
                liveHandler = undefined;
              }
            };
          },
        },
      },
      team: {
        getRunView: { invoke: (...args: unknown[]) => mockTeamGetRunViewInvoke(...args) },
        listChildConversations: { invoke: (...args: unknown[]) => mockTeamListChildConversationsInvoke(...args) },
      },
    },
  },
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('@/renderer/pages/conversation/hooks/ConversationTabsContext', () => ({
  useConversationTabs: () => ({
    activeTab: null,
    closeAllTabs: vi.fn(),
    openTab: vi.fn(),
  }),
}));

vi.mock('@/renderer/hooks/file/usePreviewLauncher', () => ({
  usePreviewLauncher: () => ({
    launchPreview: mockLaunchPreview,
  }),
}));

vi.mock('@arco-design/web-react', () => ({
  Button: ({ children, onClick, disabled }: { children?: React.ReactNode; onClick?: () => void; disabled?: boolean }) =>
    React.createElement('button', { disabled, onClick }, children),
  Space: ({ children }: { children: React.ReactNode }) => React.createElement('div', {}, children),
  Tag: ({ children }: { children: React.ReactNode }) => React.createElement('span', {}, children),
  Message: {
    success: (...args: unknown[]) => mockMessageSuccess(...args),
    error: (...args: unknown[]) => mockMessageError(...args),
  },
}));

vi.mock('@icon-park/react', () => ({
  Down: () => React.createElement('span', {}, 'Down'),
  Right: () => React.createElement('span', {}, 'Right'),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) => {
      if (key === 'messages.fileChangesCount') {
        return `${options?.count ?? 0} File Changes`;
      }

      const textMap: Record<string, string> = {
        'conversation.turnSummary.title': 'Turn Summary',
        'conversation.turnSummary.expand': 'Expand',
        'conversation.turnSummary.collapse': 'Collapse',
        'conversation.turnSummary.viewChanges': 'View changes',
        'conversation.turnSummary.waitingForChanges': 'Waiting for file changes in this turn.',
        'conversation.turnSummary.noFiles': 'No file changes yet',
        'conversation.turnSummary.lifecycle.running': 'Running',
        'conversation.turnSummary.lifecycle.completed': 'Completed',
        'conversation.turnSummary.lifecycle.interrupted': 'Interrupted',
        'conversation.turnSummary.description.running': 'This turn is still collecting file changes.',
        'conversation.turnSummary.description.pending': 'Review these changes before starting the next turn.',
        'conversation.turnSummary.description.interrupted':
          'This turn was interrupted, but the captured changes can still be reviewed.',
        'conversation.turnSummary.description.unsupported':
          'This turn can be kept, but revert is unavailable for some files.',
        'conversation.turnSummary.description.kept': 'These changes are kept.',
        'conversation.turnSummary.description.autoKept':
          'These changes were kept automatically before the next turn started.',
        'conversation.turnSummary.description.reverted': 'These changes were reverted.',
        'conversation.turnSummary.description.conflict':
          'Revert was blocked because the workspace changed after this turn.',
        'conversation.turnSummary.description.failed': 'Revert failed before all files could be restored.',
        'conversation.team.title': 'Team Run',
        'conversation.team.taskCount': `${options?.count ?? 0} task(s)`,
        'conversation.team.activeTaskCount': `${options?.count ?? 0} active task(s)`,
        'conversation.team.awaitingUserInput': 'Waiting for your confirmation before continuing.',
        'conversation.team.empty': 'No delegated tasks yet.',
        'conversation.team.assistantLabel': `Assistant: ${options?.assistant ?? ''}`,
        'conversation.team.assistantUnavailable': 'Assistant not assigned yet',
        'conversation.team.childConversationName': `Sub-conversation: ${options?.name ?? ''}`,
        'conversation.team.openConversation': 'Open',
        'conversation.team.openConversationFailed': 'Failed to open sub-conversation',
        'conversation.team.runStatus.running': 'Running',
        'conversation.team.runStatus.waiting_user': 'Waiting for user',
        'conversation.team.runStatus.completed': 'Completed',
        'conversation.team.runStatus.failed': 'Failed',
        'conversation.team.runStatus.cancelled': 'Cancelled',
        'conversation.team.phase.delegating': 'Delegating',
        'conversation.team.phase.subtask_running': 'Subtask running',
        'conversation.team.phase.continuing_main': 'Continuing main',
        'conversation.team.phase.completed': 'Completed',
        'conversation.team.phase.failed': 'Failed',
        'conversation.team.taskStatus.queued': 'Queued',
        'conversation.team.taskStatus.running': 'Running',
        'conversation.team.taskStatus.waiting_user': 'Waiting for user',
        'conversation.team.taskStatus.completed': 'Completed',
        'conversation.team.taskStatus.failed': 'Failed',
        'conversation.team.taskStatus.cancelled': 'Cancelled',
        'messages.turnSnapshot.keep': 'Keep This Turn',
        'messages.turnSnapshot.revert': 'Revert This Turn',
        'messages.turnSnapshot.keepSuccess': 'Turn kept',
        'messages.turnSnapshot.keepFailed': 'Failed to keep this turn',
        'messages.turnSnapshot.revertSuccess': 'Turn reverted',
        'messages.turnSnapshot.revertFailed': 'Failed to revert this turn',
        'messages.turnSnapshot.conflict': 'Conflict detected',
        'messages.turnSnapshot.unsupported': 'Revert unavailable',
        'messages.turnSnapshot.kept': 'Kept',
        'messages.turnSnapshot.reverted': 'Reverted',
      };

      return textMap[key] ?? key;
    },
  }),
}));

import TurnSummaryPanel from '@/renderer/pages/conversation/TurnSummaryPanel';

const makeSnapshot = (overrides?: Partial<TurnSnapshot>): TurnSnapshot => ({
  id: 'turn-1',
  conversationId: 'conv-1',
  backend: 'codex',
  requestMessageId: 'msg-1',
  startedAt: 1,
  completedAt: 2,
  completionSignal: 'finish',
  completionSource: 'end_turn',
  lifecycleStatus: 'completed',
  reviewStatus: 'pending',
  fileCount: 1,
  sourceMessageIds: ['msg-1'],
  lastActivityAt: 2,
  createdAt: 1,
  updatedAt: 2,
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
      beforeHash: 'before',
      afterHash: 'after',
      beforeContent: 'before',
      afterContent: 'after',
      unifiedDiff: 'diff --git a/src/example.ts b/src/example.ts\n@@ -1 +1 @@\n-before\n+after',
      sourceMessageIds: ['msg-1'],
      revertSupported: true,
      createdAt: 1,
      updatedAt: 2,
    },
  ],
  ...overrides,
});

describe('TurnSummaryPanel', () => {
  let currentSnapshot: TurnSnapshot;
  let currentTeamRunView: IConversationTeamRunView | null;
  let currentChildConversations: IConversationTeamChildConversation[];

  beforeEach(() => {
    vi.clearAllMocks();
    liveHandler = undefined;
    listChangedHandler = undefined;

    currentSnapshot = makeSnapshot();
    currentTeamRunView = null;
    currentChildConversations = [];
    mockListInvoke.mockImplementation(async () => [{ id: currentSnapshot.id }]);
    mockGetInvoke.mockImplementation(async () => currentSnapshot);
    mockKeepInvoke.mockImplementation(async () => {
      currentSnapshot = {
        ...currentSnapshot,
        reviewStatus: 'kept',
      };
      return { success: true, turnId: currentSnapshot.id, reviewStatus: 'kept' };
    });
    mockRevertInvoke.mockResolvedValue({
      success: true,
      turnId: 'turn-1',
      status: 'reverted',
      reviewStatus: 'reverted',
    });
    mockTeamGetRunViewInvoke.mockImplementation(async () => currentTeamRunView);
    mockTeamListChildConversationsInvoke.mockImplementation(async () => currentChildConversations);
  });

  it('renders completed pending turns with keep and revert actions', async () => {
    render(<TurnSummaryPanel conversationId='conv-1' />);

    await waitFor(() => {
      expect(screen.getByText('Turn Summary')).toBeTruthy();
      expect(screen.getByText('Keep This Turn')).toBeTruthy();
      expect(screen.getByText('Revert This Turn')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Keep This Turn'));

    await waitFor(() => {
      expect(mockKeepInvoke).toHaveBeenCalledWith({ turnId: 'turn-1' });
      expect(mockMessageSuccess).toHaveBeenCalledWith('Turn kept');
      expect(screen.getByText('Kept')).toBeTruthy();
    });
  });

  it('renders unsupported turns as keep-only', async () => {
    currentSnapshot = makeSnapshot({
      reviewStatus: 'unsupported',
    });

    render(<TurnSummaryPanel conversationId='conv-1' />);

    await waitFor(() => {
      expect(screen.getByText('Revert unavailable')).toBeTruthy();
      expect(screen.getByText('Keep This Turn')).toBeTruthy();
    });

    expect(screen.queryByText('Revert This Turn')).toBeNull();
  });

  it('expands running turns and auto-collapses after a completed live update', async () => {
    currentSnapshot = makeSnapshot({
      completedAt: undefined,
      completionSignal: undefined,
      lifecycleStatus: 'running',
      fileCount: 0,
      files: [],
    });

    render(<TurnSummaryPanel conversationId='conv-1' />);

    await waitFor(() => {
      expect(screen.getByText('Running')).toBeTruthy();
      expect(screen.getByText('Waiting for file changes in this turn.')).toBeTruthy();
    });

    expect(screen.queryByText('Keep This Turn')).toBeNull();

    act(() => {
      liveHandler?.({
        conversationId: 'conv-1',
        summary: makeSnapshot(),
        reason: 'completed',
      });
    });

    await waitFor(() => {
      expect(screen.getByText('Keep This Turn')).toBeTruthy();
      expect(screen.getByText('Revert This Turn')).toBeTruthy();
      expect(screen.queryByText('example.ts')).toBeNull();
    });

    fireEvent.click(screen.getByText('Expand'));
    fireEvent.click(screen.getByText('View changes'));

    expect(mockLaunchPreview).toHaveBeenCalledWith(
      expect.objectContaining({
        fileName: 'example.ts',
        contentType: 'diff',
        editable: false,
      })
    );
  });

  it('keeps the turn summary header compact while collapsed', async () => {
    render(<TurnSummaryPanel conversationId='conv-1' />);

    await waitFor(() => {
      expect(screen.getByText('Turn Summary')).toBeTruthy();
      expect(screen.getByText('Expand')).toBeTruthy();
    });

    expect(screen.queryByText('1 File Changes')).toBeNull();
    expect(screen.queryByText('Review these changes before starting the next turn.')).toBeNull();

    fireEvent.click(screen.getByText('Expand'));

    await waitFor(() => {
      expect(screen.getByText('1 File Changes')).toBeTruthy();
      expect(screen.getByText('Review these changes before starting the next turn.')).toBeTruthy();
    });
  });

  it('adds an internal scroll container for long file lists', async () => {
    currentSnapshot = makeSnapshot({
      fileCount: 30,
      files: Array.from({ length: 30 }, (_, index) => ({
        id: `file-${index}`,
        turnId: 'turn-1',
        conversationId: 'conv-1',
        filePath: `src/example-${index}.ts`,
        fileName: `example-${index}.ts`,
        action: 'update',
        beforeExists: true,
        afterExists: true,
        beforeHash: `before-${index}`,
        afterHash: `after-${index}`,
        beforeContent: 'before',
        afterContent: 'after',
        unifiedDiff: `diff --git a/src/example-${index}.ts b/src/example-${index}.ts\n@@ -1 +1 @@\n-before\n+after`,
        sourceMessageIds: ['msg-1'],
        revertSupported: true,
        createdAt: 1,
        updatedAt: 2,
      })),
    });

    render(<TurnSummaryPanel conversationId='conv-1' />);

    await waitFor(() => {
      expect(screen.getByText('Expand')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('Expand'));

    const list = await screen.findByTestId('turn-summary-file-list');
    expect(list.className).toContain('max-h-320px');
    expect(list.className).toContain('overflow-y-auto');
    expect(screen.getByText('example-0.ts')).toBeTruthy();
    expect(screen.getByText('example-29.ts')).toBeTruthy();
  });

  it('keeps the team run header compact while collapsed', async () => {
    currentSnapshot = makeSnapshot({
      completedAt: undefined,
      completionSignal: undefined,
      lifecycleStatus: 'running',
      fileCount: 0,
      files: [],
    });
    currentTeamRunView = {
      run: {
        id: 'run-1',
        mainConversationId: 'conv-1',
        rootConversationId: 'conv-1',
        status: 'completed',
        currentPhase: 'completed',
        awaitingUserInput: false,
        activeTaskCount: 0,
        createdAt: 1,
        updatedAt: 2,
      },
      tasks: [],
    };

    render(<TurnSummaryPanel conversationId='conv-1' />);

    await waitFor(() => {
      expect(screen.getByText('Team Run')).toBeTruthy();
      expect(screen.getAllByText('Expand').length).toBeGreaterThan(0);
    });

    expect(screen.queryByText('0 task(s)')).toBeNull();
    expect(screen.queryByText('0 active task(s)')).toBeNull();
  });

  it('renders team runs even when no turn snapshot exists', async () => {
    currentTeamRunView = {
      run: {
        id: 'run-1',
        mainConversationId: 'conv-1',
        rootConversationId: 'conv-1',
        status: 'running',
        currentPhase: 'subtask_running',
        awaitingUserInput: false,
        activeTaskCount: 1,
        createdAt: 1,
        updatedAt: 2,
      },
      tasks: [
        {
          id: 'task-1',
          runId: 'run-1',
          parentConversationId: 'conv-1',
          subConversationId: 'sub-1',
          assistantId: 'builtin-researcher',
          assistantName: 'Research Assistant',
          status: 'running',
          title: 'Investigate bug',
          taskPrompt: 'Find the root cause',
          selectionMode: 'recommended',
          selectionReason: 'matched preset',
          ownedPaths: ['src/app.ts'],
          createdAt: 1,
          updatedAt: 2,
          touchedFiles: ['src/app.ts'],
        },
      ],
    };
    currentChildConversations = [
      {
        taskId: 'task-1',
        parentConversationId: 'conv-1',
        rootConversationId: 'conv-1',
        subConversationId: 'sub-1',
        title: 'Investigate bug',
        assistantId: 'builtin-researcher',
        assistantName: 'Research Assistant',
        status: 'running',
        conversationName: 'Bug investigation',
        conversationStatus: 'running',
        updatedAt: 2,
        summary: 'Checking the stack trace',
      },
    ];
    mockListInvoke.mockResolvedValue([]);

    render(<TurnSummaryPanel conversationId='conv-1' />);

    await waitFor(() => {
      expect(screen.getByText('Team Run')).toBeTruthy();
      expect(screen.getByText('Investigate bug')).toBeTruthy();
      expect(screen.getByText('Assistant: Research Assistant')).toBeTruthy();
    });

    expect(screen.queryByText('Turn Summary')).toBeNull();
  });
});
