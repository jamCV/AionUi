import { ipcBridge } from '@/common';
import type { IConversationTeamRunStatus, IConversationTeamTaskStatus } from '@/common/adapter/ipcBridge';
import type { TChatConversation } from '@/common/config/storage';
import { Message, Button, Tag } from '@arco-design/web-react';
import { Right, Down } from '@icon-park/react';
import { iconColors } from '@renderer/styles/colors';
import classNames from 'classnames';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { useConversationTabs } from '../hooks/ConversationTabsContext';
import { useTeamRunView } from './useTeamRunView';

type TeamRunPanelProps = {
  conversationId: string;
};

const getRunTone = (status: IConversationTeamRunStatus): string => {
  switch (status) {
    case 'completed':
      return 'green';
    case 'failed':
      return 'red';
    case 'cancelled':
      return 'gray';
    case 'waiting_user':
      return 'orange';
    case 'running':
    default:
      return 'arcoblue';
  }
};

const getTaskTone = (status: IConversationTeamTaskStatus): string => {
  switch (status) {
    case 'completed':
      return 'green';
    case 'failed':
      return 'red';
    case 'cancelled':
      return 'gray';
    case 'waiting_user':
      return 'orange';
    case 'running':
      return 'arcoblue';
    case 'queued':
    default:
      return 'orangered';
  }
};

const TeamRunPanel: React.FC<TeamRunPanelProps> = ({ conversationId }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { activeTab, closeAllTabs, openTab } = useConversationTabs();
  const { teamRunView, childConversationByTaskId } = useTeamRunView(conversationId);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!teamRunView) {
      setExpanded(false);
      return;
    }

    setExpanded(teamRunView.run.status === 'running' || teamRunView.run.status === 'waiting_user');
  }, [teamRunView?.run.id, teamRunView?.run.status]);

  const tasks = useMemo(() => {
    return teamRunView?.tasks.toSorted((left, right) => right.updatedAt - left.updatedAt) ?? [];
  }, [teamRunView?.tasks]);

  const handleOpenConversation = useCallback(
    async (targetConversationId: string): Promise<void> => {
      const conversation = await ipcBridge.conversation.get.invoke({ id: targetConversationId });

      if (!conversation) {
        Message.error(t('conversation.team.openConversationFailed'));
        return;
      }

      const customWorkspace = conversation.extra?.customWorkspace;
      const newWorkspace = conversation.extra?.workspace;

      if (!customWorkspace) {
        closeAllTabs();
        void navigate(`/conversation/${conversation.id}`);
        return;
      }

      const currentWorkspace = activeTab?.workspace;
      if (!currentWorkspace || currentWorkspace !== newWorkspace) {
        closeAllTabs();
      }

      openTab(conversation as TChatConversation);
      void navigate(`/conversation/${conversation.id}`);
    },
    [activeTab?.workspace, closeAllTabs, navigate, openTab, t]
  );

  if (!teamRunView) {
    return null;
  }

  return (
    <div className='mb-12px rounded-12px border border-solid border-3 bg-2'>
      <div className='flex flex-wrap items-start justify-between gap-12px px-16px py-12px'>
        <div className='min-w-0 flex-1'>
          <div className='flex flex-wrap items-center gap-8px'>
            <span className='text-14px font-medium text-t-primary'>{t('conversation.team.title')}</span>
            <Tag color={getRunTone(teamRunView.run.status)}>
              {t(`conversation.team.runStatus.${teamRunView.run.status}`)}
            </Tag>
            <Tag color='arcoblue'>{t(`conversation.team.phase.${teamRunView.run.currentPhase}`)}</Tag>
          </div>
          <div className='mt-6px text-13px text-t-secondary'>
            {t('conversation.team.taskCount', { count: tasks.length })}
          </div>
          <div className='mt-6px text-12px text-t-secondary'>
            {teamRunView.run.awaitingUserInput
              ? t('conversation.team.awaitingUserInput')
              : t('conversation.team.activeTaskCount', { count: teamRunView.run.activeTaskCount })}
          </div>
        </div>

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

      {expanded && (
        <div className='border-t border-solid border-3 px-16px py-12px'>
          {tasks.length === 0 ? (
            <div className='text-12px text-t-secondary'>{t('conversation.team.empty')}</div>
          ) : (
            <div className='flex flex-col gap-8px'>
              {tasks.map((task) => {
                const childConversation = childConversationByTaskId.get(task.id);
                const targetConversationId = childConversation?.subConversationId ?? task.subConversationId;
                const helperName = task.assistantName || childConversation?.assistantName;
                const summaryText = task.lastError || task.summary || childConversation?.summary;

                return (
                  <div
                    key={task.id}
                    className='rounded-8px bg-1 px-12px py-10px flex flex-col gap-8px min-w-0 border border-solid border-3'
                  >
                    <div className='flex flex-wrap items-start justify-between gap-8px'>
                      <div className='min-w-0 flex-1'>
                        <div className='flex flex-wrap items-center gap-8px'>
                          <span className='truncate text-13px font-medium text-t-primary'>{task.title}</span>
                          <Tag color={getTaskTone(task.status)}>{t(`conversation.team.taskStatus.${task.status}`)}</Tag>
                        </div>
                        <div className='mt-6px text-12px text-t-secondary'>
                          {helperName
                            ? t('conversation.team.assistantLabel', { assistant: helperName })
                            : t('conversation.team.assistantUnavailable')}
                        </div>
                        {childConversation?.conversationName && (
                          <div className='mt-4px truncate text-12px text-t-secondary'>
                            {t('conversation.team.childConversationName', {
                              name: childConversation.conversationName,
                            })}
                          </div>
                        )}
                      </div>

                      {targetConversationId && (
                        <Button
                          size='mini'
                          type='secondary'
                          icon={<Right theme='outline' size='14' fill={iconColors.secondary} />}
                          onClick={() => void handleOpenConversation(targetConversationId)}
                        >
                          {t('conversation.team.openConversation')}
                        </Button>
                      )}
                    </div>

                    {(summaryText || task.touchedFiles.length > 0) && (
                      <div className='flex flex-col gap-4px min-w-0'>
                        {summaryText && <div className='text-12px text-t-secondary break-words'>{summaryText}</div>}
                        {task.touchedFiles.length > 0 && (
                          <div className='text-12px text-t-secondary'>
                            {t('messages.fileChangesCount', { count: task.touchedFiles.length })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default React.memo(TeamRunPanel);
