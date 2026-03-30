import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockUseMessageList = vi.fn();
const mockUseConversationMessagePagination = vi.fn();
const mockScrollToIndex = vi.fn();
const mockHideScrollButton = vi.fn();
const mockLocation = {
  key: 'loc-1',
  state: {},
};

vi.mock('@/renderer/hooks/context/ConversationContext', () => ({
  useConversationContextSafe: () => ({
    conversationId: 'conv-1',
  }),
}));

vi.mock('@/renderer/pages/conversation/Messages/hooks', () => ({
  useMessageList: () => mockUseMessageList(),
  useConversationMessagePagination: () => mockUseConversationMessagePagination(),
}));

vi.mock('@/renderer/pages/conversation/Messages/useAutoScroll', () => ({
  useAutoScroll: () => ({
    virtuosoRef: { current: { scrollToIndex: mockScrollToIndex } },
    handleScroll: vi.fn(),
    handleAtBottomStateChange: vi.fn(),
    handleFollowOutput: false,
    showScrollButton: false,
    scrollToBottom: vi.fn(),
    hideScrollButton: mockHideScrollButton,
  }),
}));

vi.mock('@arco-design/web-react', () => ({
  Button: ({
    children,
    onClick,
    loading,
    disabled,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    loading?: boolean;
    disabled?: boolean;
  }) => React.createElement('button', { onClick, disabled: disabled || loading }, children),
  Image: {
    PreviewGroup: ({ children }: { children: React.ReactNode }) => React.createElement('div', {}, children),
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
  useLocation: () => mockLocation,
}));

vi.mock('react-virtuoso', () => ({
  Virtuoso: ({
    data,
    itemContent,
    components,
  }: {
    data: unknown[];
    itemContent: (index: number, item: unknown) => React.ReactNode;
    components?: {
      Header?: React.ComponentType;
      Footer?: React.ComponentType;
    };
  }) =>
    React.createElement(
      'div',
      {},
      components?.Header ? React.createElement(components.Header) : null,
      data.map((item, index) => React.createElement('div', { key: index }, itemContent(index, item))),
      components?.Footer ? React.createElement(components.Footer) : null
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
  default: ({ diffsChanges }: { diffsChanges: Array<{ fullPath: string }> }) =>
    React.createElement('div', {}, `file-summary:${diffsChanges.map((diff) => diff.fullPath).join(',')}`),
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

describe('MessageList file summary grouping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLocation.key = 'loc-1';
    mockLocation.state = {};
    mockUseConversationMessagePagination.mockReturnValue({
      hasOlder: false,
      isInitialLoading: false,
      isLoadingOlder: false,
      loadOlder: vi.fn(),
    });
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

  it('maps ACP normalized diffs into a file summary item', () => {
    render(<MessageList />);

    expect(screen.getByText('file-summary:src/example.ts')).toBeTruthy();
  });

  it('shows a load older button when older pages exist', () => {
    mockUseConversationMessagePagination.mockReturnValue({
      hasOlder: true,
      isInitialLoading: false,
      isLoadingOlder: false,
      loadOlder: vi.fn(),
    });

    render(<MessageList />);

    expect(screen.getByRole('button', { name: 'messages.loadOlderMessages' })).toBeTruthy();
  });

  it('calls loadOlder when clicking the load older button', () => {
    const loadOlder = vi.fn();
    mockUseConversationMessagePagination.mockReturnValue({
      hasOlder: true,
      isInitialLoading: false,
      isLoadingOlder: false,
      loadOlder,
    });

    render(<MessageList />);

    screen.getByRole('button', { name: 'messages.loadOlderMessages' }).click();

    expect(loadOlder).toHaveBeenCalledTimes(1);
  });

  it('hides the load older button during initial loading', () => {
    mockUseConversationMessagePagination.mockReturnValue({
      hasOlder: true,
      isInitialLoading: true,
      isLoadingOlder: false,
      loadOlder: vi.fn(),
    });

    render(<MessageList />);

    expect(screen.queryByRole('button', { name: 'messages.loadOlderMessages' })).toBeNull();
  });

  it('scrolls to and highlights the targeted message from search state', async () => {
    mockLocation.key = 'loc-search';
    mockLocation.state = {
      fromConversationSearch: true,
      targetMessageId: 'acp-message-1',
    };

    render(<MessageList />);

    await waitFor(() => {
      expect(mockHideScrollButton).toHaveBeenCalledTimes(1);
      expect(mockScrollToIndex).toHaveBeenCalledWith({
        index: 10000,
        behavior: 'smooth',
        align: 'center',
      });
    });

    const highlighted = document.getElementById('message-acp-message-1');
    expect(highlighted?.style.backgroundColor).toBe('var(--color-aou-1)');
  });
});
