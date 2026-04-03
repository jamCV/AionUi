/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import type { TChatConversation } from '../../src/common/config/storage';
import type { WorkspaceHistoryGroup } from '../../src/renderer/pages/conversation/GroupedHistory/types';

const storageMap = new Map<string, string>();
const localStorageMock = {
  getItem: vi.fn((key: string) => storageMap.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => storageMap.set(key, value)),
  removeItem: vi.fn((key: string) => storageMap.delete(key)),
  clear: vi.fn(() => storageMap.clear()),
  get length() {
    return storageMap.size;
  },
  key: vi.fn((_index: number) => null),
};
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true, configurable: true });

vi.mock('react-router-dom', () => ({
  useParams: () => ({}),
}));

const testState = {
  workspaceGroups: [] as WorkspaceHistoryGroup[],
  conversations: [] as TChatConversation[],
};

const mockSetActiveConversation = vi.fn();

vi.mock('../../src/renderer/hooks/context/ConversationHistoryContext', () => ({
  useConversationHistoryContext: () => ({
    conversations: testState.conversations,
    isConversationGenerating: () => false,
    hasCompletionUnread: () => false,
    clearCompletionUnread: () => {},
    setActiveConversation: mockSetActiveConversation,
    groupedHistory: {
      pinnedConversations: [],
      workspaceGroups: testState.workspaceGroups,
    },
  }),
}));

vi.mock('../../src/renderer/utils/emitter', () => ({
  addEventListener: () => () => {},
}));

vi.mock('../../src/renderer/pages/conversation/GroupedHistory/hooks/useConversationListSync', () => ({
  useConversationListSync: () => ({
    conversations: [],
    isConversationGenerating: () => false,
    hasCompletionUnread: () => false,
    clearCompletionUnread: () => {},
    setActiveConversation: mockSetActiveConversation,
  }),
}));

vi.mock('../../src/renderer/pages/conversation/GroupedHistory/utils/groupingHelpers', () => ({
  buildGroupedHistory: () => ({
    pinnedConversations: [],
    workspaceGroups: testState.workspaceGroups,
  }),
  getTeamParentConversationId: (conversation: TChatConversation) =>
    conversation.extra?.team?.role === 'subagent' ? conversation.extra.team.parentConversationId : undefined,
}));

const STORAGE_KEY = 'aionui_workspace_expansion';
const DATE_GROUP_STORAGE_KEY = 'aionui_date_group_expansion';

const makeWorkspaceGroups = (workspaces: string[]): WorkspaceHistoryGroup[] => {
  return workspaces.map((workspace) => ({
    key: workspace,
    workspace,
    displayName: workspace.split('/').pop()!,
    isTemporaryBucket: false,
    time: Date.now(),
    dateGroups: [
      {
        key: `${workspace}::2026-04-03`,
        label: '2026-04-03',
        time: Date.now(),
        conversations: [],
      },
    ],
  }));
};

const makeConversation = (id: string, overrides?: Partial<TChatConversation>): TChatConversation =>
  ({
    id,
    name: id,
    createTime: Date.now(),
    modifyTime: Date.now(),
    type: 'gemini',
    model: {
      id: 'provider-1',
      name: 'Gemini',
      useModel: 'gemini-2.5-pro',
      platform: 'gemini-with-google-auth',
      baseUrl: '',
      apiKey: '',
    },
    extra: {},
    ...overrides,
  }) as TChatConversation;

import { useConversations } from '../../src/renderer/pages/conversation/GroupedHistory/hooks/useConversations';

describe('useConversations - workspace expansion', () => {
  beforeEach(() => {
    storageMap.clear();
    testState.workspaceGroups = [];
    testState.conversations = [];
    mockSetActiveConversation.mockReset();
  });

  it('should auto-expand all workspaces on first load when localStorage is empty', async () => {
    testState.workspaceGroups = makeWorkspaceGroups(['/ws/a', '/ws/b']);

    const { result } = renderHook(() => useConversations());
    await act(async () => {});

    expect(result.current.expandedWorkspaces).toEqual(expect.arrayContaining(['/ws/a', '/ws/b']));
    expect(result.current.expandedWorkspaces).toHaveLength(2);
    expect(result.current.expandedDateGroups).toEqual(
      expect.arrayContaining(['/ws/a::2026-04-03', '/ws/b::2026-04-03'])
    );
  });

  it('should restore expansion state from localStorage', async () => {
    storageMap.set(STORAGE_KEY, JSON.stringify(['/ws/a']));
    testState.workspaceGroups = makeWorkspaceGroups(['/ws/a', '/ws/b']);

    const { result } = renderHook(() => useConversations());
    await act(async () => {});

    expect(result.current.expandedWorkspaces).toEqual(['/ws/a']);
  });

  it('should toggle workspace expansion on handleToggleWorkspace', async () => {
    testState.workspaceGroups = makeWorkspaceGroups(['/ws/a', '/ws/b']);

    const { result } = renderHook(() => useConversations());
    await act(async () => {});
    expect(result.current.expandedWorkspaces).toContain('/ws/a');

    act(() => {
      result.current.handleToggleWorkspace('/ws/a');
    });
    expect(result.current.expandedWorkspaces).not.toContain('/ws/a');
    expect(result.current.expandedWorkspaces).toContain('/ws/b');

    act(() => {
      result.current.handleToggleWorkspace('/ws/a');
    });
    expect(result.current.expandedWorkspaces).toContain('/ws/a');
  });

  it('should toggle date group expansion on handleToggleDateGroup', async () => {
    testState.workspaceGroups = makeWorkspaceGroups(['/ws/a']);

    const { result } = renderHook(() => useConversations());
    await act(async () => {});
    expect(result.current.expandedDateGroups).toContain('/ws/a::2026-04-03');

    act(() => {
      result.current.handleToggleDateGroup('/ws/a::2026-04-03');
    });
    expect(result.current.expandedDateGroups).not.toContain('/ws/a::2026-04-03');

    act(() => {
      result.current.handleToggleDateGroup('/ws/a::2026-04-03');
    });
    expect(result.current.expandedDateGroups).toContain('/ws/a::2026-04-03');
  });

  it('should persist date group expansion state to localStorage', async () => {
    testState.workspaceGroups = makeWorkspaceGroups(['/ws/a']);

    const { result } = renderHook(() => useConversations());
    await act(async () => {});

    act(() => {
      result.current.handleToggleDateGroup('/ws/a::2026-04-03');
    });

    const stored = JSON.parse(storageMap.get(DATE_GROUP_STORAGE_KEY)!);
    expect(stored).toEqual([]);
  });

  it('should persist expansion state to localStorage', async () => {
    testState.workspaceGroups = makeWorkspaceGroups(['/ws/a', '/ws/b']);

    const { result } = renderHook(() => useConversations());
    await act(async () => {});

    act(() => {
      result.current.handleToggleWorkspace('/ws/a');
    });

    const stored = JSON.parse(storageMap.get(STORAGE_KEY)!);
    expect(stored).toEqual(['/ws/b']);
  });

  it('should remove stale workspace entries from expandedWorkspaces', async () => {
    storageMap.set(STORAGE_KEY, JSON.stringify(['/ws/a', '/ws/stale']));
    testState.workspaceGroups = makeWorkspaceGroups(['/ws/a', '/ws/b']);

    const { result } = renderHook(() => useConversations());
    await act(async () => {});

    expect(result.current.expandedWorkspaces).not.toContain('/ws/stale');
    expect(result.current.expandedWorkspaces).toContain('/ws/a');
  });

  it('should not re-expand workspaces after user manually collapses all (#1156)', async () => {
    testState.workspaceGroups = makeWorkspaceGroups(['/ws/a']);

    const { result } = renderHook(() => useConversations());
    await act(async () => {});
    expect(result.current.expandedWorkspaces).toEqual(['/ws/a']);

    act(() => {
      result.current.handleToggleWorkspace('/ws/a');
    });

    expect(result.current.expandedWorkspaces).toEqual([]);
  });

  it('should group subagent conversations under their parent conversation', async () => {
    const parentConversation = makeConversation('parent-conversation');
    const childConversation = makeConversation('child-conversation', {
      extra: {
        team: {
          runId: 'run-1',
          role: 'subagent',
          rootConversationId: 'parent-conversation',
          parentConversationId: 'parent-conversation',
          assistantName: 'Research Assistant',
        },
      },
    });
    const orphanConversation = makeConversation('orphan-conversation', {
      extra: {
        team: {
          runId: 'run-2',
          role: 'subagent',
          rootConversationId: 'missing-parent',
          parentConversationId: 'missing-parent',
        },
      },
    });

    testState.conversations = [parentConversation, childConversation, orphanConversation];

    const { result } = renderHook(() => useConversations());
    await act(async () => {});

    expect(result.current.teamChildMap.get('parent-conversation')?.map((conversation) => conversation.id)).toEqual([
      'child-conversation',
    ]);
    expect(result.current.teamChildMap.has('missing-parent')).toBe(false);
  });
});
