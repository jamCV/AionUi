import type { GroupedHistoryResult } from '../types';

type VisibleConversationOrderInput = GroupedHistoryResult & {
  expandedWorkspaces: string[];
  siderCollapsed: boolean;
};

export const buildVisibleConversationIds = ({
  pinnedConversations,
  workspaceGroups,
  expandedWorkspaces,
  siderCollapsed,
}: VisibleConversationOrderInput): string[] => {
  const expandedWorkspaceSet = new Set(expandedWorkspaces);
  const visibleConversationIds: string[] = [];

  pinnedConversations.forEach((conversation) => {
    visibleConversationIds.push(conversation.id);
  });

  workspaceGroups.forEach((workspaceGroup) => {
    if (!siderCollapsed && !expandedWorkspaceSet.has(workspaceGroup.key)) {
      return;
    }

    workspaceGroup.dateGroups.forEach((dateGroup) => {
      dateGroup.conversations.forEach((conversation) => {
        visibleConversationIds.push(conversation.id);
      });
    });
  });

  return visibleConversationIds;
};
