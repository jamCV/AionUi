import type { GroupedHistoryResult } from '../types';

type VisibleConversationOrderInput = GroupedHistoryResult & {
  expandedWorkspaces: string[];
  siderCollapsed: boolean;
};

export const buildVisibleConversationIds = ({
  pinnedConversations,
  workspaceGroups,
  timelineSections,
  expandedWorkspaces,
  siderCollapsed,
}: VisibleConversationOrderInput): string[] => {
  const expandedWorkspaceSet = new Set(expandedWorkspaces);
  const visibleConversationIds: string[] = [];

  pinnedConversations.forEach((conversation) => {
    visibleConversationIds.push(conversation.id);
  });

  if (workspaceGroups && workspaceGroups.length > 0) {
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
  }

  timelineSections.forEach((section) => {
    section.items.forEach((item) => {
      if (item.type === 'conversation' && item.conversation) {
        visibleConversationIds.push(item.conversation.id);
        return;
      }

      if (item.type === 'workspace' && item.workspaceGroup) {
        if (!siderCollapsed && !expandedWorkspaceSet.has(item.workspaceGroup.workspace)) {
          return;
        }

        item.workspaceGroup.conversations.forEach((conversation) => {
          visibleConversationIds.push(conversation.id);
        });
      }
    });
  });

  return visibleConversationIds;
};
