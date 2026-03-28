import type { TurnReviewStatus } from '@/common/types/turnSnapshot';
import { Button, Space, Tag } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';

export interface TurnSnapshotActionsProps {
  reviewStatus?: TurnReviewStatus;
  canKeep?: boolean;
  canRevert?: boolean;
  actionLoading?: boolean;
  onKeep?: () => void;
  onRevert?: () => void;
}

const STATUS_COLOR_MAP: Record<Exclude<TurnReviewStatus, 'pending'>, string> = {
  kept: 'green',
  reverted: 'arcoblue',
  conflict: 'red',
  unsupported: 'orange',
  failed: 'red',
};

const STATUS_KEY_MAP: Record<Exclude<TurnReviewStatus, 'pending'>, string> = {
  kept: 'messages.turnSnapshot.kept',
  reverted: 'messages.turnSnapshot.reverted',
  conflict: 'messages.turnSnapshot.conflict',
  unsupported: 'messages.turnSnapshot.unsupported',
  failed: 'messages.turnSnapshot.revertFailed',
};

const TurnSnapshotActions: React.FC<TurnSnapshotActionsProps> = ({
  reviewStatus,
  canKeep = false,
  canRevert = false,
  actionLoading = false,
  onKeep,
  onRevert,
}) => {
  const { t } = useTranslation();

  if (!reviewStatus) {
    return null;
  }

  if (reviewStatus === 'pending' && canRevert) {
    return (
      <Space size={8}>
        {canKeep && (
          <Button size='mini' loading={actionLoading} onClick={onKeep}>
            {t('messages.turnSnapshot.keep')}
          </Button>
        )}
        <Button size='mini' status='danger' loading={actionLoading} onClick={onRevert}>
          {t('messages.turnSnapshot.revert')}
        </Button>
      </Space>
    );
  }

  if (reviewStatus === 'pending' || reviewStatus === 'unsupported') {
    return (
      <Space size={8}>
        <Tag color={STATUS_COLOR_MAP.unsupported}>{t(STATUS_KEY_MAP.unsupported)}</Tag>
        {canKeep && (
          <Button size='mini' loading={actionLoading} onClick={onKeep}>
            {t('messages.turnSnapshot.keep')}
          </Button>
        )}
      </Space>
    );
  }

  return <Tag color={STATUS_COLOR_MAP[reviewStatus]}>{t(STATUS_KEY_MAP[reviewStatus])}</Tag>;
};

export default React.memo(TurnSnapshotActions);
