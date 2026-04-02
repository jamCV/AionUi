import type { TurnSnapshot } from '@/common/types/turnSnapshot';
import { Button, Space, Tag } from '@arco-design/web-react';
import { Down } from '@icon-park/react';
import { usePreviewLauncher } from '@renderer/hooks/file/usePreviewLauncher';
import { diffColors, iconColors } from '@renderer/styles/colors';
import classNames from 'classnames';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import TeamRunPanel from './TeamRunPanel';
import { useTurnSummarySnapshot } from './useTurnSummarySnapshot';
import {
  canKeepTurnSnapshot,
  canRevertTurnSnapshot,
  getDefaultExpanded,
  getDescriptionKey,
  getLifecycleTone,
  getReviewKey,
  getReviewTone,
  toFileChangeInfo,
} from './utils';

type TurnSummaryPanelProps = {
  conversationId: string;
};

const renderFileCount = (t: ReturnType<typeof useTranslation>['t'], snapshot: TurnSnapshot): string => {
  if (snapshot.fileCount === 0) {
    return t('conversation.turnSummary.noFiles');
  }

  return t('messages.fileChangesCount', { count: snapshot.fileCount });
};

const TurnSummaryPanel: React.FC<TurnSummaryPanelProps> = ({ conversationId }) => {
  const { t } = useTranslation();
  const { launchPreview } = usePreviewLauncher();
  const { snapshot, actionLoading, handleKeep, handleRevert } = useTurnSummarySnapshot(conversationId);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!snapshot) {
      setExpanded(false);
      return;
    }

    setExpanded(getDefaultExpanded(snapshot.lifecycleStatus));
  }, [snapshot?.id, snapshot?.lifecycleStatus]);

  const files = useMemo(
    () =>
      snapshot?.files.map(toFileChangeInfo).toSorted((left, right) => left.fullPath.localeCompare(right.fullPath)) ??
      [],
    [snapshot?.files]
  );

  const canKeep = canKeepTurnSnapshot(snapshot);
  const canRevert = canRevertTurnSnapshot(snapshot);

  return (
    <>
      <TeamRunPanel conversationId={conversationId} />

      {snapshot && (
        <div className='mb-12px rounded-12px border border-solid border-3 bg-2'>
          <div className='flex items-center justify-between gap-12px px-16px py-12px'>
            <div className='min-w-0 flex-1'>
              <div className='flex items-center gap-8px min-w-0 overflow-hidden'>
                <span className='truncate text-14px font-medium text-t-primary'>{t('conversation.turnSummary.title')}</span>
                <Tag color={getLifecycleTone(snapshot.lifecycleStatus)}>
                  {t(`conversation.turnSummary.lifecycle.${snapshot.lifecycleStatus}`)}
                </Tag>
                {snapshot.reviewStatus !== 'pending' && (
                  <Tag color={getReviewTone(snapshot.reviewStatus)}>{t(getReviewKey(snapshot.reviewStatus))}</Tag>
                )}
              </div>
              {expanded && (
                <>
                  <div className='mt-6px text-13px text-t-secondary'>{renderFileCount(t, snapshot)}</div>
                  <div className='mt-6px text-12px text-t-secondary'>{t(getDescriptionKey(snapshot))}</div>
                </>
              )}
            </div>

            <div className='flex items-center justify-end gap-8px shrink-0'>
              {canKeep && (
                <Button size='mini' loading={actionLoading === 'keep'} onClick={() => void handleKeep()}>
                  {t('messages.turnSnapshot.keep')}
                </Button>
              )}
              {canRevert && (
                <Button
                  size='mini'
                  status='danger'
                  loading={actionLoading === 'revert'}
                  onClick={() => void handleRevert()}
                >
                  {t('messages.turnSnapshot.revert')}
                </Button>
              )}
              <Button
                size='mini'
                type='text'
                icon={
                  <Down
                    theme='outline'
                    size='16'
                    fill={iconColors.secondary}
                    className={classNames('transition-transform duration-200', expanded && 'rotate-180')}
                  />
                }
                onClick={() => setExpanded((currentExpanded) => !currentExpanded)}
              >
                {expanded ? t('conversation.turnSummary.collapse') : t('conversation.turnSummary.expand')}
              </Button>
            </div>
          </div>

          {expanded && (
            <div className='border-t border-solid border-3 px-16px py-12px'>
              {files.length === 0 ? (
                <div className='text-12px text-t-secondary'>{t('conversation.turnSummary.waitingForChanges')}</div>
              ) : (
                <div
                  data-testid='turn-summary-file-list'
                  className='max-h-320px overflow-y-auto pr-4px flex flex-col gap-8px'
                >
                  {files.map((file) => (
                    <div
                      key={file.fullPath}
                      className='flex flex-wrap items-center justify-between gap-8px rounded-8px bg-1 px-12px py-10px'
                    >
                      <div className='min-w-0 flex-1'>
                        <div className='truncate text-13px font-medium text-t-primary'>{file.fileName}</div>
                        <div className='truncate text-12px text-t-secondary'>{file.fullPath}</div>
                      </div>

                      <Space size={8}>
                        <span className='text-12px font-medium' style={{ color: diffColors.addition }}>
                          +{file.insertions}
                        </span>
                        <span className='text-12px font-medium' style={{ color: diffColors.deletion }}>
                          -{file.deletions}
                        </span>
                        <Button
                          size='mini'
                          type='text'
                          onClick={() =>
                            void launchPreview({
                              fileName: file.fileName,
                              contentType: 'diff',
                              editable: false,
                              language: 'diff',
                              diffContent: file.diff,
                            })
                          }
                        >
                          {t('conversation.turnSummary.viewChanges')}
                        </Button>
                      </Space>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
};

export default React.memo(TurnSummaryPanel);
