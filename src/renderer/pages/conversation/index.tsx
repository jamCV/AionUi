import { ipcBridge } from '@/common';
import { PWA_REFRESH_EVENT } from '@/renderer/components/layout/PwaPullToRefresh';
import { usePreviewContext } from '@/renderer/pages/conversation/Preview';
import { Spin } from '@arco-design/web-react';
import React, { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useParams } from 'react-router-dom';
import useSWR from 'swr';
import { refreshConversationMessages, type HydrateConversationMessagesOptions } from './Messages/hooks';
import ChatConversation from './components/ChatConversation';
import { useConversationTabs } from './hooks/ConversationTabsContext';
import { useAutoTitle } from '@/renderer/hooks/chat/useAutoTitle';

type ConversationLocationState = {
  targetMessageId?: string;
  fromConversationSearch?: boolean;
};

const ChatConversationIndex: React.FC = () => {
  const { id } = useParams();
  const location = useLocation();
  const locationState = useMemo(() => (location.state || {}) as ConversationLocationState, [location.state]);
  const hydrateOptions = useMemo<HydrateConversationMessagesOptions>(() => {
    if (locationState.fromConversationSearch && locationState.targetMessageId) {
      return {
        mode: 'targeted',
        targetMessageId: locationState.targetMessageId,
      };
    }

    return { mode: 'latest' };
  }, [locationState.fromConversationSearch, locationState.targetMessageId]);
  const { t } = useTranslation();
  const { closePreview } = usePreviewContext();
  const { openTab } = useConversationTabs();
  const { syncTitleFromHistory } = useAutoTitle();
  const previousConversationIdRef = useRef<string | undefined>(undefined);
  const defaultConversationTitle = t('conversation.welcome.newConversation');

  useEffect(() => {
    if (!id) return;

    // 切换会话时自动关闭预览面板，避免跨会话残留
    // Close preview on every conversation change, including initial mount
    // (component may remount via React Router, resetting the ref to undefined)
    if (previousConversationIdRef.current !== id) {
      closePreview();
    }

    previousConversationIdRef.current = id;
  }, [id, closePreview]);

  useEffect(() => {
    if (!id) {
      return;
    }

    void refreshConversationMessages(id, hydrateOptions);
  }, [hydrateOptions, id, location.key]);

  const { data, isLoading, mutate } = useSWR(`conversation/${id}`, () => {
    return ipcBridge.conversation.get.invoke({ id });
  });

  useEffect(() => {
    if (!id) {
      return;
    }

    const handlePwaRefresh = () => {
      void refreshConversationMessages(id, hydrateOptions);
      void mutate();
    };

    const unsubscribe = ipcBridge.conversation.listChanged.on((event) => {
      if (event.conversationId !== id || event.action !== 'updated') {
        return;
      }

      void mutate();
    });

    window.addEventListener(PWA_REFRESH_EVENT, handlePwaRefresh);
    return () => {
      window.removeEventListener(PWA_REFRESH_EVENT, handlePwaRefresh);
      unsubscribe();
    };
  }, [hydrateOptions, id, mutate]);

  useEffect(() => {
    if (!data || data.name !== defaultConversationTitle) {
      return;
    }

    void syncTitleFromHistory(data.id);
  }, [data, defaultConversationTitle, syncTitleFromHistory]);

  // 当会话数据加载完成后，自动打开 tab
  // Automatically open tab when conversation data is loaded
  useEffect(() => {
    if (data) {
      openTab(data);
    }
  }, [data, openTab]);

  if (isLoading) return <Spin loading></Spin>;
  return <ChatConversation conversation={data}></ChatConversation>;
};

export default ChatConversationIndex;
