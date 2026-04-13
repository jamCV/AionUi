/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@/common/config/storage';
import { getActivityTime } from '@/renderer/utils/chat/timeline';
import { getWorkspaceDisplayName } from '@/renderer/utils/workspace/workspace';
import { getWorkspaceUpdateTime } from '@/renderer/utils/workspace/workspaceHistory';

import type {
  GroupedHistoryResult,
  TimelineItem,
  TimelineSection,
  WorkspaceDateGroup,
  WorkspaceHistoryGroup,
} from '../types';
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

export const isCronJobConversation = (conversation: TChatConversation): boolean => {
  const extra = conversation.extra as { cronJobId?: string } | undefined;
  return Boolean(extra?.cronJobId);
};

export const getConversationPinnedAt = (conversation: TChatConversation): number => {
  const extra = conversation.extra as { pinnedAt?: number } | undefined;
  if (typeof extra?.pinnedAt === 'number') {
    return extra.pinnedAt;
  }
  return 0;
};

export const groupConversationsByWorkspace = (
  conversations: TChatConversation[],
  t: (key: string) => string
): TimelineSection[] => {
  const allWorkspaceGroups = new Map<string, TChatConversation[]>();
  const withoutWorkspaceConvs: TChatConversation[] = [];

  conversations.forEach((conv) => {
    const workspace = conv.extra?.workspace;
    const customWorkspace = conv.extra?.customWorkspace;

    if (customWorkspace && workspace) {
      if (!allWorkspaceGroups.has(workspace)) {
        allWorkspaceGroups.set(workspace, []);
      }
      allWorkspaceGroups.get(workspace)!.push(conv);
    } else {
      withoutWorkspaceConvs.push(conv);
    }
  });

  const items: TimelineItem[] = [];

  allWorkspaceGroups.forEach((convList, workspace) => {
    const sortedConvs = [...convList].toSorted((a, b) => getActivityTime(b) - getActivityTime(a));
    const latestConversationTime = getActivityTime(sortedConvs[0]);
    const updateTime = getWorkspaceUpdateTime(workspace);
    const time = Math.max(updateTime, latestConversationTime);
    items.push({
      type: 'workspace',
      time,
      workspaceGroup: {
        workspace,
        displayName: getWorkspaceDisplayName(workspace),
        conversations: sortedConvs,
      },
    });
  });

  withoutWorkspaceConvs.forEach((conv) => {
    items.push({
      type: 'conversation',
      time: getActivityTime(conv),
      conversation: conv,
    });
  });

  items.sort((a, b) => b.time - a.time);

  if (items.length === 0) return [];

  return [
    {
      timeline: t('conversation.history.recents'),
      items,
    },
  ];
};

/** Check whether a conversation belongs to a team (should be hidden from sidebar). */
const isTeamConversation = (conversation: TChatConversation): boolean => {
  const extra = conversation.extra as { teamId?: string } | undefined;
  return Boolean(extra?.teamId);
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
    const workspaceConversations = workspaces.get(workspaceKey) ?? [];
    workspaceConversations.push(conversation);
    workspaces.set(workspaceKey, workspaceConversations);
  });

  return [...workspaces.entries()]
    .map(([workspaceKey, workspaceConversations]) => {
      const sortedConversations = [...workspaceConversations].toSorted((left, right) => {
        return getActivityTime(right) - getActivityTime(left);
      });
      const dateGroupsMap = new Map<string, TChatConversation[]>();

      sortedConversations.forEach((conversation) => {
        const dateKey = formatDateKey(getActivityTime(conversation));
        const dateConversations = dateGroupsMap.get(dateKey) ?? [];
        dateConversations.push(conversation);
        dateGroupsMap.set(dateKey, dateConversations);
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
  // Filter out team-owned conversations; they are only visible via the Teams panel
  const visibleConversations = conversations.filter((conv) => !isTeamConversation(conv));

  const pinnedConversations = visibleConversations
    .filter((conversation) => isConversationPinned(conversation))
    .toSorted((a, b) => {
      const orderA = getConversationSortOrder(a);
      const orderB = getConversationSortOrder(b);
      if (orderA !== undefined && orderB !== undefined) return orderA - orderB;
      if (orderA !== undefined) return -1;
      if (orderB !== undefined) return 1;
      return getConversationPinnedAt(b) - getConversationPinnedAt(a);
    });

  const normalConversations = visibleConversations.filter(
    (conversation) => !isConversationPinned(conversation) && !isCronJobConversation(conversation)
  );

  return {
    pinnedConversations,
    timelineSections: groupConversationsByWorkspace(normalConversations, t),
    workspaceGroups: buildWorkspaceGroups(normalConversations, t),
  };
};
