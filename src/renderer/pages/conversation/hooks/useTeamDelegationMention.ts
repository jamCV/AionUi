import { ipcBridge } from '@/common';
import type { IConversationTeamAssistantDescriptor } from '@/common/adapter/ipcBridge';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

type UseTeamDelegationMentionParams = {
  conversationId: string;
  input: string;
  setInput: (value: string) => void;
};

const SUPPORTED_TEAM_TYPES = new Set(['codex', 'gemini', 'acp']);
const LEADING_MENTION_QUERY = /^@([^\s]*)$/;
const LEADING_MENTION_TOKEN = /^@\S+\s*/;

const normalizeKeyword = (value: string): string => value.trim().toLowerCase();

const scoreAssistant = (assistant: IConversationTeamAssistantDescriptor, keyword: string): number => {
  const lowerName = assistant.name.toLowerCase();
  const lowerAlias = assistant.alias?.toLowerCase() || '';
  const lowerId = assistant.id.toLowerCase();

  if (!keyword) {
    return 0;
  }
  if (lowerAlias && lowerAlias.startsWith(keyword)) {
    return 0;
  }
  if (lowerName.startsWith(keyword)) {
    return 1;
  }
  if (lowerId.startsWith(keyword)) {
    return 2;
  }
  if (lowerAlias.includes(keyword)) {
    return 3;
  }
  if (lowerName.includes(keyword)) {
    return 4;
  }
  if (lowerId.includes(keyword)) {
    return 5;
  }
  return 10;
};

const matchesAssistant = (assistant: IConversationTeamAssistantDescriptor, keyword: string): boolean => {
  if (!keyword) {
    return true;
  }
  const lowerKeyword = normalizeKeyword(keyword);
  return (
    assistant.name.toLowerCase().includes(lowerKeyword) ||
    assistant.id.toLowerCase().includes(lowerKeyword) ||
    assistant.alias?.toLowerCase().includes(lowerKeyword) === true
  );
};

export const useTeamDelegationMention = ({
  conversationId,
  input,
  setInput,
}: UseTeamDelegationMentionParams): {
  enabled: boolean;
  loading: boolean;
  selectedAssistant?: IConversationTeamAssistantDescriptor;
  filteredAssistants: IConversationTeamAssistantDescriptor[];
  menuOpen: boolean;
  activeIndex: number;
  setActiveIndex: (index: number) => void;
  handleInputChange: (value: string) => void;
  handleKeyDown: (event: ReactKeyboardEvent) => boolean;
  selectAssistantById: (assistantId: string) => void;
  clearSelectedAssistant: () => void;
} => {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [assistants, setAssistants] = useState<IConversationTeamAssistantDescriptor[]>([]);
  const [selectedAssistant, setSelectedAssistant] = useState<IConversationTeamAssistantDescriptor | undefined>(
    undefined
  );
  const [query, setQuery] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    let disposed = false;
    setEnabled(false);
    setAssistants([]);
    setSelectedAssistant(undefined);
    setQuery('');
    setMenuOpen(false);
    setActiveIndex(0);

    const load = async () => {
      const conversation = await ipcBridge.conversation.get.invoke({ id: conversationId });
      if (!conversation || disposed) {
        return;
      }

      const isSupportedConversation =
        SUPPORTED_TEAM_TYPES.has(conversation.type) && conversation.extra?.team?.role !== 'subagent';
      setEnabled(isSupportedConversation);
      if (!isSupportedConversation) {
        return;
      }

      setLoading(true);
      try {
        const nextAssistants = await ipcBridge.conversation.team.listAvailableAssistants.invoke({
          conversation_id: conversationId,
        });
        if (!disposed) {
          setAssistants(nextAssistants);
        }
      } finally {
        if (!disposed) {
          setLoading(false);
        }
      }
    };

    void load();
    return () => {
      disposed = true;
    };
  }, [conversationId]);

  const filteredAssistants = useMemo(() => {
    const normalizedQuery = normalizeKeyword(query);
    return assistants
      .filter((assistant) => matchesAssistant(assistant, normalizedQuery))
      .toSorted((left, right) => {
        const scoreDiff = scoreAssistant(left, normalizedQuery) - scoreAssistant(right, normalizedQuery);
        if (scoreDiff !== 0) {
          return scoreDiff;
        }
        return left.name.localeCompare(right.name);
      });
  }, [assistants, query]);

  const selectAssistantById = useCallback(
    (assistantId: string) => {
      const matched = assistants.find((assistant) => assistant.id === assistantId);
      if (!matched) {
        return;
      }
      setSelectedAssistant(matched);
      setInput(input.replace(LEADING_MENTION_TOKEN, ''));
      setMenuOpen(false);
      setQuery('');
      setActiveIndex(0);
    },
    [assistants, input, setInput]
  );

  const clearSelectedAssistant = useCallback(() => {
    setSelectedAssistant(undefined);
  }, []);

  const handleInputChange = useCallback(
    (value: string) => {
      setInput(value);
      if (!enabled || selectedAssistant) {
        setMenuOpen(false);
        return;
      }

      const mentionMatch = value.match(LEADING_MENTION_QUERY);
      if (!mentionMatch) {
        setMenuOpen(false);
        setQuery('');
        setActiveIndex(0);
        return;
      }

      setQuery(mentionMatch[1] || '');
      setMenuOpen(true);
      setActiveIndex(0);
    },
    [enabled, selectedAssistant, setInput]
  );

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent) => {
      if (!menuOpen || filteredAssistants.length === 0) {
        return false;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setMenuOpen(false);
        return true;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((previous) => (previous + 1) % filteredAssistants.length);
        return true;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((previous) => (previous - 1 + filteredAssistants.length) % filteredAssistants.length);
        return true;
      }
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        const activeAssistant = filteredAssistants[activeIndex];
        if (!activeAssistant) {
          return true;
        }
        selectAssistantById(activeAssistant.id);
        return true;
      }
      return false;
    },
    [activeIndex, filteredAssistants, menuOpen, selectAssistantById]
  );

  return {
    enabled,
    loading,
    selectedAssistant,
    filteredAssistants,
    menuOpen,
    activeIndex,
    setActiveIndex,
    handleInputChange,
    handleKeyDown,
    selectAssistantById,
    clearSelectedAssistant,
  };
};
