import { ipcBridge } from '@/common';
import type { IConversationTeamChildConversation, IConversationTeamRunView } from '@/common/adapter/ipcBridge';
import { useCallback, useEffect, useMemo, useState } from 'react';

type UseTeamRunViewResult = {
  childConversationByTaskId: Map<string, IConversationTeamChildConversation>;
  teamRunView?: IConversationTeamRunView;
};

export const useTeamRunView = (conversationId: string): UseTeamRunViewResult => {
  const [teamRunView, setTeamRunView] = useState<IConversationTeamRunView | undefined>();
  const [childConversations, setChildConversations] = useState<IConversationTeamChildConversation[]>([]);

  const loadTeamRunView = useCallback(async (): Promise<void> => {
    if (!conversationId) {
      setTeamRunView(undefined);
      setChildConversations([]);
      return;
    }

    const [nextTeamRunView, nextChildConversations] = await Promise.all([
      ipcBridge.conversation.team.getRunView.invoke({ conversation_id: conversationId }),
      ipcBridge.conversation.team.listChildConversations.invoke({ conversation_id: conversationId }),
    ]);

    setTeamRunView(nextTeamRunView ?? undefined);
    setChildConversations(nextChildConversations);
  }, [conversationId]);

  useEffect(() => {
    let disposed = false;

    if (!conversationId) {
      setTeamRunView(undefined);
      setChildConversations([]);
      return undefined;
    }

    void Promise.all([
      ipcBridge.conversation.team.getRunView.invoke({ conversation_id: conversationId }),
      ipcBridge.conversation.team.listChildConversations.invoke({ conversation_id: conversationId }),
    ])
      .then(([nextTeamRunView, nextChildConversations]) => {
        if (disposed) {
          return;
        }

        setTeamRunView(nextTeamRunView ?? undefined);
        setChildConversations(nextChildConversations);
      })
      .catch(() => {
        if (disposed) {
          return;
        }

        setTeamRunView(undefined);
        setChildConversations([]);
      });

    return () => {
      disposed = true;
    };
  }, [conversationId]);

  useEffect(() => {
    if (!conversationId) {
      return undefined;
    }

    return ipcBridge.conversation.listChanged.on((event) => {
      if (event.conversationId !== conversationId) {
        return;
      }

      void loadTeamRunView();
    });
  }, [conversationId, loadTeamRunView]);

  const childConversationByTaskId = useMemo(() => {
    return new Map(childConversations.map((childConversation) => [childConversation.taskId, childConversation]));
  }, [childConversations]);

  return {
    teamRunView,
    childConversationByTaskId,
  };
};
