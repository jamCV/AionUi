/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@/common/config/storage';
import { getActivityTime } from '@/renderer/utils/chat/timeline';
import { getWorkspaceDisplayName } from '@/renderer/utils/workspace/workspace';

import type { GroupedHistoryResult, WorkspaceDateGroup, WorkspaceHistoryGroup } from '../types';
import { getConversationSortOrder } from './sortOrderHelpers';

const TEMPORARY_BUCKET_KEY = '__temporary_workspace_bucket__';

const formatDateKey = (timestamp: number): string => {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const isConversationPinned = (conversation: TChatConversation): boolean => {
  const extra = conversation.extra as { pinned?: boolean } | undefined;
  return Boolean(extra?.pinned);
};

export const getTeamParentConversationId = (conversation: TChatConversation): string | undefined => {
  const teamMeta = conversation.extra?.team;
  if (teamMeta?.role !== 'subagent') {
    return undefined;
  }

  return teamMeta.parentConversationId;
};

export const isSubagentConversation = (conversation: TChatConversation): boolean => {
  return Boolean(getTeamParentConversationId(conversation));
};

export const getConversationPinnedAt = (conversation: TChatConversation): number => {
  const extra = conversation.extra as { pinnedAt?: number } | undefined;
  if (typeof extra?.pinnedAt === 'number') {
    return extra.pinnedAt;
  }
  return 0;
};

const buildWorkspaceGroups = (
  conversations: TChatConversation[],
  t: (key: string) => string
): WorkspaceHistoryGroup[] => {
  const workspaces = new Map<string, TChatConversation[]>();

  conversations.forEach((conversation) => {
    const workspace = conversation.extra?.workspace;
    const customWorkspace = conversation.extra?.customWorkspace;
    const workspaceKey = customWorkspace && workspace ? workspace : TEMPORARY_BUCKET_KEY;
    const list = workspaces.get(workspaceKey) ?? [];
    list.push(conversation);
    workspaces.set(workspaceKey, list);
  });

  return [...workspaces.entries()]
    .map(([workspaceKey, workspaceConversations]) => {
      const sortedConversations = [...workspaceConversations].toSorted((left, right) => {
        return getActivityTime(right) - getActivityTime(left);
      });
      const dateGroupsMap = new Map<string, TChatConversation[]>();

      sortedConversations.forEach((conversation) => {
        const dateKey = formatDateKey(getActivityTime(conversation));
        const list = dateGroupsMap.get(dateKey) ?? [];
        list.push(conversation);
        dateGroupsMap.set(dateKey, list);
      });

      const dateGroups: WorkspaceDateGroup[] = [...dateGroupsMap.entries()]
        .map(([dateKey, dateConversations]) => {
          const sortedDateConversations = [...dateConversations].toSorted((left, right) => {
            return getActivityTime(right) - getActivityTime(left);
          });

          return {
            key: `${workspaceKey}::${dateKey}`,
            label: dateKey,
            time: getActivityTime(sortedDateConversations[0]),
            conversations: sortedDateConversations,
          };
        })
        .toSorted((left, right) => right.time - left.time);

      const isTemporaryBucket = workspaceKey === TEMPORARY_BUCKET_KEY;
      const displayName = isTemporaryBucket
        ? t('conversation.history.temporaryWorkspaceGroup')
        : getWorkspaceDisplayName(workspaceKey, t);

      return {
        key: workspaceKey,
        workspace: workspaceKey,
        displayName,
        isTemporaryBucket,
        time: dateGroups[0]?.time ?? 0,
        dateGroups,
      };
    })
    .toSorted((left, right) => right.time - left.time);
};

export const buildGroupedHistory = (
  conversations: TChatConversation[],
  t: (key: string) => string
): GroupedHistoryResult => {
  const conversationIds = new Set(conversations.map((conversation) => conversation.id));
  const rootConversations = conversations.filter((conversation) => {
    const parentConversationId = getTeamParentConversationId(conversation);
    return !parentConversationId || !conversationIds.has(parentConversationId);
  });

  const pinnedConversations = rootConversations
    .filter((conversation) => isConversationPinned(conversation))
    .toSorted((a, b) => {
      const orderA = getConversationSortOrder(a);
      const orderB = getConversationSortOrder(b);
      if (orderA !== undefined && orderB !== undefined) return orderA - orderB;
      if (orderA !== undefined) return -1;
      if (orderB !== undefined) return 1;
      return getConversationPinnedAt(b) - getConversationPinnedAt(a);
    });

  const normalConversations = rootConversations.filter((conversation) => !isConversationPinned(conversation));

  return {
    pinnedConversations,
    workspaceGroups: buildWorkspaceGroups(normalConversations, t),
  };
};
