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
  DATE_GROUP_EXPANSION_STORAGE_KEY,
  WORKSPACE_EXPANSION_STORAGE_KEY,
  dispatchDateGroupExpansionChange,
  dispatchWorkspaceExpansionChange,
  readExpandedDateGroups,
  readExpandedWorkspaces,
} from './useWorkspaceExpansionState';
import { getTeamParentConversationId } from '../utils/groupingHelpers';

export const useConversations = () => {
  const [expandedWorkspaces, setExpandedWorkspaces] = useState<string[]>(() => readExpandedWorkspaces());
  const [expandedDateGroups, setExpandedDateGroups] = useState<string[]>(() => readExpandedDateGroups());
  const { id } = useParams();
  const {
    conversations,
    isConversationGenerating,
    hasCompletionUnread,
    clearCompletionUnread,
    setActiveConversation,
    groupedHistory,
  } = useConversationHistoryContext();

  const hasAutoExpandedRef = useRef(false);

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

  useEffect(() => {
    try {
      localStorage.setItem(WORKSPACE_EXPANSION_STORAGE_KEY, JSON.stringify(expandedWorkspaces));
    } catch {
      // ignore
    }

    dispatchWorkspaceExpansionChange(expandedWorkspaces);
  }, [expandedWorkspaces]);

  useEffect(() => {
    try {
      localStorage.setItem(DATE_GROUP_EXPANSION_STORAGE_KEY, JSON.stringify(expandedDateGroups));
    } catch {
      // ignore
    }

    dispatchDateGroupExpansionChange(expandedDateGroups);
  }, [expandedDateGroups]);

  const { pinnedConversations, workspaceGroups } = groupedHistory;
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

  useEffect(() => {
    if (hasAutoExpandedRef.current) return;
    if (expandedWorkspaces.length > 0 || expandedDateGroups.length > 0) {
      hasAutoExpandedRef.current = true;
      return;
    }

    const allWorkspaces = workspaceGroups.map((group) => group.key);
    const allDateGroups = workspaceGroups.flatMap((group) => group.dateGroups.map((dateGroup) => dateGroup.key));
    if (allWorkspaces.length > 0) {
      setExpandedWorkspaces(allWorkspaces);
      setExpandedDateGroups(allDateGroups);
      hasAutoExpandedRef.current = true;
    }
  }, [expandedDateGroups.length, expandedWorkspaces.length, workspaceGroups]);

  useEffect(() => {
    const currentWorkspaces = new Set(workspaceGroups.map((group) => group.key));
    const currentDateGroups = new Set(workspaceGroups.flatMap((group) => group.dateGroups.map((dateGroup) => dateGroup.key)));
    if (currentWorkspaces.size === 0) return;

    setExpandedWorkspaces((prev) => {
      const filtered = prev.filter((workspace) => currentWorkspaces.has(workspace));
      return filtered.length === prev.length ? prev : filtered;
    });

    setExpandedDateGroups((prev) => {
      const filtered = prev.filter((dateGroup) => currentDateGroups.has(dateGroup));
      return filtered.length === prev.length ? prev : filtered;
    });
  }, [workspaceGroups]);

  const handleToggleWorkspace = useCallback((workspace: string) => {
    setExpandedWorkspaces((prev) => {
      if (prev.includes(workspace)) {
        return prev.filter((item) => item !== workspace);
      }
      return [...prev, workspace];
    });
  }, []);

  const handleToggleDateGroup = useCallback((dateGroupKey: string) => {
    setExpandedDateGroups((prev) => {
      if (prev.includes(dateGroupKey)) {
        return prev.filter((item) => item !== dateGroupKey);
      }
      return [...prev, dateGroupKey];
    });
  }, []);

  return {
    conversations,
    isConversationGenerating,
    hasCompletionUnread,
    expandedWorkspaces,
    expandedDateGroups,
    pinnedConversations,
    teamChildMap,
    workspaceGroups,
    handleToggleWorkspace,
    handleToggleDateGroup,
  };
};
