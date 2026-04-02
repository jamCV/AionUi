import { ipcBridge } from '@/common';
import type { IConversationTeamRunStatus, IConversationTeamTaskStatus } from '@/common/adapter/ipcBridge';
import type { TChatConversation } from '@/common/config/storage';
import { Button, Message, Tag } from '@arco-design/web-react';
import { Right, Down } from '@icon-park/react';
import { iconColors } from '@renderer/styles/colors';
import classNames from 'classnames';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { stripHiddenTeamCommandTags, hasHiddenTeamCommandTags } from '@renderer/utils/chat/thinkTagFilter';
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
    case 'bootstrapping':
      return 'purple';
    case 'interrupted':
      return 'red';
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
  const { teamRunView, childConversationByTaskId, refresh } = useTeamRunView(conversationId);
  const [expanded, setExpanded] = useState(false);
  const [isSubagentConversation, setIsSubagentConversation] = useState(false);

  useEffect(() => {
    let disposed = false;
    if (!ipcBridge.conversation.get?.invoke) {
      setIsSubagentConversation(false);
      return () => {
        disposed = true;
      };
    }
    void ipcBridge.conversation.get
      .invoke({ id: conversationId })
      .then((conversation) => {
        if (!conversation || disposed) {
          return;
        }
        setIsSubagentConversation(conversation.extra?.team?.role === 'subagent');
      })
      .catch(() => {
        if (!disposed) {
          setIsSubagentConversation(false);
        }
      });

    return () => {
      disposed = true;
    };
  }, [conversationId]);

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

  const handleTaskAction = useCallback(
    async (action: 'stop' | 'retry' | 'cancel', taskId: string): Promise<void> => {
      const handlers = {
        stop: () => ipcBridge.conversation.team.stopTask.invoke({ conversation_id: conversationId, task_id: taskId }),
        retry: () => ipcBridge.conversation.team.retryTask.invoke({ conversation_id: conversationId, task_id: taskId }),
        cancel: () =>
          ipcBridge.conversation.team.cancelTask.invoke({ conversation_id: conversationId, task_id: taskId }),
      };

      const result = await handlers[action]();
      if (!result.success) {
        Message.error(result.msg || t('conversation.team.openConversationFailed'));
        return;
      }
      await refresh();
    },
    [conversationId, refresh, t]
  );

  const openRenameDialog = useCallback(
    async (taskId: string, initialAlias?: string) => {
      const nextAlias = window.prompt(t('conversation.history.renamePlaceholder'), initialAlias || '');
      if (nextAlias === null) {
        return;
      }
      const result = await ipcBridge.conversation.team.renameTaskAlias.invoke({
        conversation_id: conversationId,
        task_id: taskId,
        display_alias: nextAlias.trim() || undefined,
      });
      if (!result.success) {
        Message.error(result.msg || t('conversation.team.openConversationFailed'));
        return;
      }
      await refresh();
    },
    [conversationId, refresh, t]
  );

  const canRename = useCallback((status: IConversationTeamTaskStatus): boolean => {
    if (status === 'completed' || status === 'cancelled') {
      return;
    }
    return true;
  }, []);

  if (isSubagentConversation || !teamRunView) {
    return null;
  }

  return (
    <div className='mb-12px rounded-12px border border-solid border-3 bg-2'>
      <div className='flex items-center justify-between gap-12px px-16px py-12px'>
        <div className='min-w-0 flex-1'>
          <div className='flex items-center gap-8px min-w-0 overflow-hidden'>
            <span className='truncate text-14px font-medium text-t-primary'>{t('conversation.team.title')}</span>
            <Tag color={getRunTone(teamRunView.run.status)}>
              {t(`conversation.team.runStatus.${teamRunView.run.status}`)}
            </Tag>
            <Tag color='arcoblue'>{t(`conversation.team.phase.${teamRunView.run.currentPhase}`)}</Tag>
          </div>
          {expanded && (
            <>
              <div className='mt-6px text-13px text-t-secondary'>
                {t('conversation.team.taskCount', { count: tasks.length })}
              </div>
              <div className='mt-6px text-12px text-t-secondary'>
                {teamRunView.run.awaitingUserInput
                  ? t('conversation.team.awaitingUserInput')
                  : t('conversation.team.activeTaskCount', { count: teamRunView.run.activeTaskCount })}
              </div>
            </>
          )}
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
                const rawSummaryText = task.lastError || task.summary || childConversation?.summary;
                const summaryText =
                  rawSummaryText && hasHiddenTeamCommandTags(rawSummaryText)
                    ? stripHiddenTeamCommandTags(rawSummaryText)
                    : rawSummaryText;

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
                      <div className='flex flex-wrap items-center gap-4px'>
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
                        {task.status === 'running' && (
                          <Button size='mini' type='secondary' onClick={() => void handleTaskAction('stop', task.id)}>
                            {t('common.stop')}
                          </Button>
                        )}
                        {(task.status === 'queued' ||
                          task.status === 'bootstrapping' ||
                          task.status === 'waiting_user') && (
                          <Button
                            size='mini'
                            status='warning'
                            type='secondary'
                            onClick={() => void handleTaskAction('cancel', task.id)}
                          >
                            {t('common.cancel')}
                          </Button>
                        )}
                        {(task.status === 'failed' || task.status === 'interrupted') && (
                          <Button size='mini' type='secondary' onClick={() => void handleTaskAction('retry', task.id)}>
                            {t('common.retry')}
                          </Button>
                        )}
                        {canRename(task.status) && (
                          <Button
                            size='mini'
                            type='secondary'
                            onClick={() => void openRenameDialog(task.id, task.displayAlias)}
                          >
                            {t('conversation.history.rename')}
                          </Button>
                        )}
                      </div>
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
