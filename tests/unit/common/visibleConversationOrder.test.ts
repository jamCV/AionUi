/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import type { TChatConversation } from '../../../src/common/config/storage';
import type { WorkspaceDateGroup, WorkspaceHistoryGroup } from '../../../src/renderer/pages/conversation/GroupedHistory/types';
import { buildVisibleConversationIds } from '../../../src/renderer/pages/conversation/GroupedHistory/utils/visibleConversationOrder';

const createConversation = (id: string): TChatConversation => ({
  createTime: 1,
  modifyTime: 1,
  name: `Conversation ${id}`,
  id,
  type: 'gemini',
  extra: {
    workspace: `/workspace/${id}`,
    customWorkspace: true,
  },
  model: {
    id: 'model-1',
    name: 'Gemini',
    useModel: 'gemini-2.0-flash',
    platform: 'gemini',
    baseUrl: '',
    apiKey: '',
  } as TChatConversation['model'],
});

const createDateGroup = (workspace: string, date: string, conversationIds: string[]): WorkspaceDateGroup => ({
  key: `${workspace}::${date}`,
  label: date,
  time: 1,
  conversations: conversationIds.map((conversationId) => createConversation(conversationId)),
});

const createWorkspaceHistoryGroup = (workspace: string, dates: Array<{ date: string; ids: string[] }>): WorkspaceHistoryGroup => ({
  key: workspace,
  workspace,
  displayName: workspace,
  isTemporaryBucket: false,
  time: 1,
  dateGroups: dates.map(({ date, ids }) => createDateGroup(workspace, date, ids)),
});

describe('buildVisibleConversationIds', () => {
  it('keeps pinned conversations first and preserves rendered workspace/date order', () => {
    const visibleConversationIds = buildVisibleConversationIds({
      pinnedConversations: [createConversation('pinned-1'), createConversation('pinned-2')],
      workspaceGroups: [
        createWorkspaceHistoryGroup('/workspace/project-a', [
          { date: '2026-04-03', ids: ['ws-1', 'ws-2'] },
          { date: '2026-04-02', ids: ['ws-3'] },
        ]),
      ],
      expandedWorkspaces: ['/workspace/project-a'],
      siderCollapsed: false,
    });

    expect(visibleConversationIds).toEqual(['pinned-1', 'pinned-2', 'ws-1', 'ws-2', 'ws-3']);
  });

  it('skips conversations inside collapsed workspace groups', () => {
    const visibleConversationIds = buildVisibleConversationIds({
      pinnedConversations: [],
      workspaceGroups: [createWorkspaceHistoryGroup('/workspace/project-a', [{ date: '2026-04-03', ids: ['ws-1', 'ws-2'] }])],
      expandedWorkspaces: [],
      siderCollapsed: false,
    });

    expect(visibleConversationIds).toEqual([]);
  });

  it('includes workspace conversations when the sidebar is collapsed', () => {
    const visibleConversationIds = buildVisibleConversationIds({
      pinnedConversations: [],
      workspaceGroups: [createWorkspaceHistoryGroup('/workspace/project-a', [{ date: '2026-04-03', ids: ['ws-1', 'ws-2'] }])],
      expandedWorkspaces: [],
      siderCollapsed: true,
    });

    expect(visibleConversationIds).toEqual(['ws-1', 'ws-2']);
  });
});
