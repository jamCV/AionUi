import { ipcBridge } from '@/common';
import type { TurnSnapshot } from '@/common/types/turnSnapshot';
import { Message } from '@arco-design/web-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

type TurnAction = 'keep' | 'revert' | null;

type UseTurnSummarySnapshotResult = {
  actionLoading: TurnAction;
  handleKeep: () => Promise<void>;
  handleRevert: () => Promise<void>;
  snapshot?: TurnSnapshot;
};

export const useTurnSummarySnapshot = (conversationId: string): UseTurnSummarySnapshotResult => {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<TurnSnapshot | undefined>();
  const [actionLoading, setActionLoading] = useState<TurnAction>(null);

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

  useEffect(() => {
    let disposed = false;

    if (!conversationId) {
      setSnapshot(undefined);
      return undefined;
    }

    void loadLatestSnapshot()
      .then((latestSnapshot) => {
        if (!disposed) {
          setSnapshot(latestSnapshot);
        }
      })
      .catch(() => {
        if (!disposed) {
          setSnapshot(undefined);
        }
      });

    return () => {
      disposed = true;
    };
  }, [conversationId, loadLatestSnapshot]);

  useEffect(() => {
    if (!conversationId) {
      return undefined;
    }

    return ipcBridge.conversation.turnSnapshot.live.on((event) => {
      if (event.conversationId !== conversationId) {
        return;
      }

      setSnapshot(event.summary);
    });
  }, [conversationId]);

  const handleKeep = useCallback(async (): Promise<void> => {
    if (!snapshot) {
      return;
    }

    setActionLoading('keep');
    try {
      const result = await ipcBridge.conversation.turnSnapshot.keep.invoke({ turnId: snapshot.id });
      if (result.success) {
        Message.success(t('messages.turnSnapshot.keepSuccess'));
      } else {
        Message.error(result.msg || t('messages.turnSnapshot.keepFailed'));
      }
    } catch (error) {
      Message.error(error instanceof Error ? error.message : t('messages.turnSnapshot.keepFailed'));
    } finally {
      const latestSnapshot = await loadSnapshot(snapshot.id).catch((): undefined => undefined);
      if (latestSnapshot) {
        setSnapshot(latestSnapshot);
      }
      setActionLoading(null);
    }
  }, [loadSnapshot, snapshot, t]);

  const handleRevert = useCallback(async (): Promise<void> => {
    if (!snapshot) {
      return;
    }

    setActionLoading('revert');
    try {
      const result = await ipcBridge.conversation.turnSnapshot.revert.invoke({ turnId: snapshot.id });
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
      const latestSnapshot = await loadSnapshot(snapshot.id).catch((): undefined => undefined);
      if (latestSnapshot) {
        setSnapshot(latestSnapshot);
      }
      setActionLoading(null);
    }
  }, [loadSnapshot, snapshot, t]);

  return {
    snapshot,
    actionLoading,
    handleKeep,
    handleRevert,
  };
};
