/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useConversationHistoryContext } from '@/renderer/hooks/context/ConversationHistoryContext';
import type { TChatConversation } from '@/common/config/storage';
import {
  dispatchWorkspaceExpansionChange,
  readExpandedWorkspaces,
  WORKSPACE_EXPANSION_STORAGE_KEY,
} from './useWorkspaceExpansionState';
import { getTeamParentConversationId } from '../utils/groupingHelpers';

export const useConversations = () => {
  const [expandedWorkspaces, setExpandedWorkspaces] = useState<string[]>(() => readExpandedWorkspaces());
  const { id } = useParams();
  const {
    conversations,
    isConversationGenerating,
    hasCompletionUnread,
    clearCompletionUnread,
    setActiveConversation,
    groupedHistory,
  } = useConversationHistoryContext();

  // Track whether auto-expand has already been performed to avoid
  // re-expanding workspaces after a user manually collapses them (#1156)
  const hasAutoExpandedRef = useRef(false);

  // Scroll active conversation into view
  useEffect(() => {
    if (!id) {
      setActiveConversation(null);
      return;
    }

    setActiveConversation(id);
    clearCompletionUnread(id);
    const rafId = requestAnimationFrame(() => {
      const element = document.getElementById('c-' + id);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });
    return () => cancelAnimationFrame(rafId);
  }, [clearCompletionUnread, id, setActiveConversation]);

  // Persist expansion state
  useEffect(() => {
    try {
      localStorage.setItem(WORKSPACE_EXPANSION_STORAGE_KEY, JSON.stringify(expandedWorkspaces));
    } catch {
      // ignore
    }

    dispatchWorkspaceExpansionChange(expandedWorkspaces);
  }, [expandedWorkspaces]);

  const { pinnedConversations, timelineSections } = groupedHistory;
  const conversationIds = useMemo(() => {
    return new Set(conversations.map((conversation) => conversation.id));
  }, [conversations]);

  const teamChildMap = useMemo(() => {
    const nextChildMap = new Map<string, TChatConversation[]>();

    conversations.forEach((conversation) => {
      const parentConversationId = getTeamParentConversationId(conversation);
      if (!parentConversationId || !conversationIds.has(parentConversationId)) {
        return;
      }

      const childConversations = nextChildMap.get(parentConversationId) ?? [];
      childConversations.push(conversation);
      nextChildMap.set(parentConversationId, childConversations);
    });

    nextChildMap.forEach((childConversations) => {
      childConversations.sort((left, right) => right.modifyTime - left.modifyTime);
    });

    return nextChildMap;
  }, [conversationIds, conversations]);

  // Auto-expand all workspaces on first load only (#1156)
  useEffect(() => {
    if (hasAutoExpandedRef.current) return;
    if (expandedWorkspaces.length > 0) {
      hasAutoExpandedRef.current = true;
      return;
    }
    const allWorkspaces: string[] = [];
    timelineSections.forEach((section) => {
      section.items.forEach((item) => {
        if (item.type === 'workspace' && item.workspaceGroup) {
          allWorkspaces.push(item.workspaceGroup.workspace);
        }
      });
    });
    if (allWorkspaces.length > 0) {
      setExpandedWorkspaces(allWorkspaces);
      hasAutoExpandedRef.current = true;
    }
  }, [timelineSections]);

  // Remove stale workspace entries that no longer exist in the data
  useEffect(() => {
    const currentWorkspaces = new Set<string>();
    timelineSections.forEach((section) => {
      section.items.forEach((item) => {
        if (item.type === 'workspace' && item.workspaceGroup) {
          currentWorkspaces.add(item.workspaceGroup.workspace);
        }
      });
    });
    if (currentWorkspaces.size === 0) return;
    setExpandedWorkspaces((prev) => {
      const filtered = prev.filter((ws) => currentWorkspaces.has(ws));
      return filtered.length === prev.length ? prev : filtered;
    });
  }, [timelineSections]);

  const handleToggleWorkspace = useCallback((workspace: string) => {
    setExpandedWorkspaces((prev) => {
      if (prev.includes(workspace)) {
        return prev.filter((item) => item !== workspace);
      }
      return [...prev, workspace];
    });
  }, []);

  return {
    conversations,
    isConversationGenerating,
    hasCompletionUnread,
    expandedWorkspaces,
    pinnedConversations,
    teamChildMap,
    timelineSections,
    handleToggleWorkspace,
  };
};
