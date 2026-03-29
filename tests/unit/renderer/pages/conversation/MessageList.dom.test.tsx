import { render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockUseMessageList = vi.fn();

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
});
