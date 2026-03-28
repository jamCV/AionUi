import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockListInvoke = vi.fn();
const mockKeepInvoke = vi.fn();
const mockUseMessageList = vi.fn();
const mockMessageSuccess = vi.fn();

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      turnSnapshot: {
        list: { invoke: (...args: unknown[]) => mockListInvoke(...args) },
        keep: { invoke: (...args: unknown[]) => mockKeepInvoke(...args) },
        revert: { invoke: vi.fn() },
      },
    },
  },
}));

vi.mock('@/renderer/hooks/context/ConversationContext', () => ({
  useConversationContextSafe: () => ({
    conversationId: 'conv-1',
  }),
}));

vi.mock('@/renderer/pages/conversation/Messages/hooks', () => ({
  useMessageList: () => mockUseMessageList(),
}));

vi.mock('@/renderer/pages/conversation/Messages/useAutoScroll', () => ({
  useAutoScroll: () => ({
    virtuosoRef: { current: null },
    handleScroll: vi.fn(),
    handleAtBottomStateChange: vi.fn(),
    handleFollowOutput: false,
    showScrollButton: false,
    scrollToBottom: vi.fn(),
    hideScrollButton: vi.fn(),
  }),
}));

vi.mock('@arco-design/web-react', () => ({
  Image: {
    PreviewGroup: ({ children }: { children: React.ReactNode }) => React.createElement('div', {}, children),
  },
  Message: {
    success: (...args: unknown[]) => mockMessageSuccess(...args),
    error: vi.fn(),
  },
}));

vi.mock('@icon-park/react', () => ({
  Down: () => React.createElement('span', {}, 'Down'),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('react-router-dom', () => ({
  useLocation: () => ({
    key: 'loc-1',
    state: {},
  }),
}));

vi.mock('react-virtuoso', () => ({
  Virtuoso: ({
    data,
    itemContent,
  }: {
    data: unknown[];
    itemContent: (index: number, item: unknown) => React.ReactNode;
  }) =>
    React.createElement(
      'div',
      {},
      data.map((item, index) => React.createElement('div', { key: index }, itemContent(index, item)))
    ),
}));

vi.mock('@renderer/utils/ui/HOC', () => ({
  __esModule: true,
  default:
    (Wrapper: React.ComponentType<{ children: React.ReactNode }>) =>
    (Component: React.ComponentType<Record<string, unknown>>) =>
    (props: Record<string, unknown>) =>
      React.createElement(Wrapper, props, React.createElement(Component, props)),
}));

vi.mock('@renderer/utils/common', () => ({
  uuid: () => 'uuid-1',
}));

vi.mock('@/renderer/pages/conversation/Messages/codex/MessageFileChanges', () => ({
  __esModule: true,
  default: ({
    turnId,
    turnReviewStatus,
    canKeep,
    canRevert,
    onKeepTurn,
    onRevertTurn,
  }: {
    turnId?: string;
    turnReviewStatus?: string;
    canKeep?: boolean;
    canRevert?: boolean;
    onKeepTurn?: () => void;
    onRevertTurn?: () => void;
  }) =>
    React.createElement(
      'div',
      {},
      React.createElement(
        'span',
        {},
        `${turnId ?? 'none'}:${turnReviewStatus ?? 'none'}:${String(canKeep)}:${String(canRevert)}`
      ),
      onKeepTurn ? React.createElement('button', { onClick: onKeepTurn }, 'keep-turn') : null,
      onRevertTurn ? React.createElement('button', { onClick: onRevertTurn }, 'revert-turn') : null
    ),
  parseDiff: (diff: string, fileNameHint?: string) => ({
    fileName: fileNameHint ?? 'test.ts',
    fullPath: fileNameHint ?? 'test.ts',
    insertions: 1,
    deletions: 1,
    diff,
  }),
}));

vi.mock('@/renderer/pages/conversation/Messages/components/MessageToolGroupSummary', () => ({
  __esModule: true,
  default: () => React.createElement('div', {}, 'tool-summary'),
}));

vi.mock('@/renderer/pages/conversation/Messages/acp/MessageAcpPermission', () => ({
  __esModule: true,
  default: () => React.createElement('div', {}, 'acp-permission'),
}));

vi.mock('@/renderer/pages/conversation/Messages/acp/MessageAcpToolCall', () => ({
  __esModule: true,
  default: () => React.createElement('div', {}, 'acp-tool-call'),
}));

vi.mock('@/renderer/pages/conversation/Messages/codex/MessageCodexToolCall', () => ({
  __esModule: true,
  default: () => React.createElement('div', {}, 'codex-tool-call'),
}));

vi.mock('@/renderer/pages/conversation/Messages/components/MessageAgentStatus', () => ({
  __esModule: true,
  default: () => React.createElement('div', {}, 'agent-status'),
}));

vi.mock('@/renderer/pages/conversation/Messages/components/MessagePlan', () => ({
  __esModule: true,
  default: () => React.createElement('div', {}, 'plan'),
}));

vi.mock('@/renderer/pages/conversation/Messages/components/MessageTips', () => ({
  __esModule: true,
  default: () => React.createElement('div', {}, 'tips'),
}));

vi.mock('@/renderer/pages/conversation/Messages/components/MessageToolCall', () => ({
  __esModule: true,
  default: () => React.createElement('div', {}, 'tool-call'),
}));

vi.mock('@/renderer/pages/conversation/Messages/components/MessageToolGroup', () => ({
  __esModule: true,
  default: () => React.createElement('div', {}, 'tool-group'),
}));

vi.mock('@/renderer/pages/conversation/Messages/components/MessagetText', () => ({
  __esModule: true,
  default: () => React.createElement('div', {}, 'message-text'),
}));

import MessageList from '@/renderer/pages/conversation/Messages/MessageList';

describe('MessageList turn snapshot wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseMessageList.mockReturnValue([
      {
        id: 'acp-message-1',
        msg_id: 'msg-1',
        type: 'acp_tool_call',
        position: 'left',
        conversation_id: 'conv-1',
        content: {
          update: {
            toolCallId: 'tool-1',
            kind: 'edit',
            status: 'completed',
            normalizedDiffs: [
              {
                path: 'src/example.ts',
                action: 'update',
                beforeExists: true,
                afterExists: true,
                unifiedDiff: 'diff --git a/src/example.ts b/src/example.ts',
              },
            ],
          },
        },
      },
    ]);
  });

  it('maps ACP normalized diffs to file summary and refreshes after keep', async () => {
    let status: 'pending' | 'kept' = 'pending';

    mockListInvoke.mockImplementation(async () => [
      {
        id: 'turn-1',
        conversationId: 'conv-1',
        backend: 'codex',
        startedAt: 1,
        completedAt: 2,
        completionSignal: 'finish',
        reviewStatus: status,
        fileCount: 1,
        sourceMessageIds: ['acp-message-1'],
        createdAt: 1,
        updatedAt: 1,
      },
    ]);
    mockKeepInvoke.mockImplementation(async ({ turnId }: { turnId: string }) => {
      status = 'kept';
      return { success: true, turnId, reviewStatus: 'kept' };
    });

    render(<MessageList />);

    await waitFor(() => {
      expect(screen.getByText('turn-1:pending:true:true')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('keep-turn'));

    await waitFor(() => {
      expect(mockKeepInvoke).toHaveBeenCalledWith({ turnId: 'turn-1' });
      expect(mockMessageSuccess).toHaveBeenCalledWith('messages.turnSnapshot.keepSuccess');
      expect(screen.getByText('turn-1:kept:false:false')).toBeTruthy();
    });
  });

  it('renders unsupported snapshots as keep-only', async () => {
    mockListInvoke.mockResolvedValue([
      {
        id: 'turn-unsupported',
        conversationId: 'conv-1',
        backend: 'codex',
        startedAt: 1,
        completedAt: 2,
        completionSignal: 'finish',
        reviewStatus: 'unsupported',
        fileCount: 1,
        sourceMessageIds: ['acp-message-1'],
        createdAt: 1,
        updatedAt: 1,
      },
    ]);

    render(<MessageList />);

    await waitFor(() => {
      expect(screen.getByText('turn-unsupported:unsupported:true:false')).toBeTruthy();
    });

    expect(screen.queryByText('revert-turn')).toBeNull();
  });
});
