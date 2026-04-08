import { ipcBridge } from '@/common';
import type { TurnSnapshot } from '@/common/types/turnSnapshot';
import { Message } from '@arco-design/web-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

type TurnAction = 'keep' | 'revert' | null;

type UseTurnSummarySnapshotResult = {
  actionLoading: TurnAction;
  handleKeep: () => Promise<void>;
  handleRevert: () => Promise<void>;
  snapshot?: TurnSnapshot;
};

export const useTurnSummarySnapshot = (
  conversationId: string,
  busy: boolean
): UseTurnSummarySnapshotResult => {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<TurnSnapshot | undefined>();
  const [actionLoading, setActionLoading] = useState<TurnAction>(null);
  const previousConversationRef = useRef<string | null>(null);
  const previousBusyRef = useRef(busy);

  const loadSnapshot = useCallback(async (turnId: string): Promise<TurnSnapshot | undefined> => {
    const nextSnapshot = await ipcBridge.conversation.turnSnapshot.get.invoke({ turnId });
    return nextSnapshot ?? undefined;
  }, []);

  const loadLatestSnapshot = useCallback(async (): Promise<TurnSnapshot | undefined> => {
    if (!conversationId) {
      return undefined;
    }

    const snapshots = await ipcBridge.conversation.turnSnapshot.list.invoke({
      conversation_id: conversationId,
      limit: 1,
    });
    const latestSnapshot = snapshots[0];
    if (!latestSnapshot) {
      return undefined;
    }

    return loadSnapshot(latestSnapshot.id);
  }, [conversationId, loadSnapshot]);

  const refreshSnapshot = useCallback(async (): Promise<void> => {
    try {
      setSnapshot(await loadLatestSnapshot());
    } catch {
      setSnapshot(undefined);
    }
  }, [loadLatestSnapshot]);

  const syncActionSnapshot = useCallback(
    async (turnId: string, fallback?: TurnSnapshot): Promise<void> => {
      const nextSnapshot = await loadSnapshot(turnId).catch((): undefined => undefined);
      setSnapshot(nextSnapshot ?? fallback);
    },
    [loadSnapshot]
  );

  useEffect(() => {
    if (!conversationId) {
      previousConversationRef.current = null;
      setSnapshot(undefined);
      previousBusyRef.current = busy;
      return;
    }

    if (previousConversationRef.current === conversationId) {
      return;
    }

    previousConversationRef.current = conversationId;
    previousBusyRef.current = busy;
    void refreshSnapshot();
  }, [busy, conversationId, refreshSnapshot]);

  useEffect(() => {
    if (!conversationId) {
      return;
    }

    const wasBusy = previousBusyRef.current;
    previousBusyRef.current = busy;

    if (!wasBusy || busy) {
      return;
    }

    const timer = setTimeout(() => {
      void refreshSnapshot();
    }, 150);

    return () => {
      clearTimeout(timer);
    };
  }, [busy, conversationId, refreshSnapshot]);

  const handleKeep = useCallback(async (): Promise<void> => {
    if (!snapshot) {
      return;
    }

    setActionLoading('keep');
    let fallbackSnapshot = snapshot;

    try {
      const result = await ipcBridge.conversation.turnSnapshot.keep.invoke({ turnId: snapshot.id });
      fallbackSnapshot = result.snapshot ?? fallbackSnapshot;

      if (result.success) {
        Message.success(t('messages.turnSnapshot.keepSuccess'));
      } else {
        Message.error(result.msg || t('messages.turnSnapshot.keepFailed'));
      }
    } catch (error) {
      Message.error(error instanceof Error ? error.message : t('messages.turnSnapshot.keepFailed'));
    } finally {
      await syncActionSnapshot(snapshot.id, fallbackSnapshot);
      setActionLoading(null);
    }
  }, [snapshot, syncActionSnapshot, t]);

  const handleRevert = useCallback(async (): Promise<void> => {
    if (!snapshot) {
      return;
    }

    setActionLoading('revert');
    let fallbackSnapshot = snapshot;

    try {
      const result = await ipcBridge.conversation.turnSnapshot.revert.invoke({ turnId: snapshot.id });
      fallbackSnapshot = result.snapshot ?? fallbackSnapshot;

      if (result.success) {
        Message.success(t('messages.turnSnapshot.revertSuccess'));
      } else if (result.status === 'conflict') {
        Message.error(result.msg || t('messages.turnSnapshot.conflict'));
      } else if (result.status === 'unsupported') {
        Message.error(result.msg || t('messages.turnSnapshot.unsupported'));
      } else {
        Message.error(result.msg || t('messages.turnSnapshot.revertFailed'));
      }
    } catch (error) {
      Message.error(error instanceof Error ? error.message : t('messages.turnSnapshot.revertFailed'));
    } finally {
      await syncActionSnapshot(snapshot.id, fallbackSnapshot);
      setActionLoading(null);
    }
  }, [snapshot, syncActionSnapshot, t]);

  return {
    snapshot,
    actionLoading,
    handleKeep,
    handleRevert,
  };
};
