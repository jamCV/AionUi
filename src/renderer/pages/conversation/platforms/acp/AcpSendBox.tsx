import { ipcBridge } from '@/common';
import type { AcpBackend } from '@/common/types/acpTypes';
import { isSideQuestionSupported } from '@/common/chat/sideQuestion';
import { uuid } from '@/common/utils';
import SlashCommandMenu, { type SlashCommandMenuItem } from '@/renderer/components/chat/SlashCommandMenu';
import SendBox from '@/renderer/components/chat/sendbox';
import TeamDelegationBadge from '@/renderer/components/chat/TeamDelegationBadge';
import ThoughtDisplay from '@/renderer/components/chat/ThoughtDisplay';
import CommandQueuePanel from '@/renderer/components/chat/CommandQueuePanel';
import { getSendBoxDraftHook, type FileOrFolderItem } from '@/renderer/hooks/chat/useSendBoxDraft';
import { createSetUploadFile, useSendBoxFiles } from '@/renderer/hooks/chat/useSendBoxFiles';
import { useAddOrUpdateMessage } from '@/renderer/pages/conversation/Messages/hooks';
import {
  shouldEnqueueConversationCommand,
  useConversationCommandQueue,
  type ConversationCommandQueueItem,
} from '@/renderer/pages/conversation/platforms/useConversationCommandQueue';
import { assertBridgeSuccess } from '@/renderer/pages/conversation/platforms/assertBridgeSuccess';
import { allSupportedExts } from '@/renderer/services/FileService';
import { emitter, useAddEventListener } from '@/renderer/utils/emitter';
import { mergeFileSelectionItems } from '@/renderer/utils/file/fileSelection';
import { Tag } from '@arco-design/web-react';
import { Shield } from '@icon-park/react';
import { iconColors } from '@/renderer/styles/colors';
import FileAttachButton from '@/renderer/components/media/FileAttachButton';
import AcpConfigSelector from '@/renderer/components/agent/AcpConfigSelector';
import React, { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import FilePreview from '@/renderer/components/media/FilePreview';
import HorizontalFileList from '@/renderer/components/media/HorizontalFileList';
import { usePreviewContext } from '@/renderer/pages/conversation/Preview';
import { useTeamDelegationMention } from '@/renderer/pages/conversation/hooks/useTeamDelegationMention';
import { useLatestRef } from '@/renderer/hooks/ui/useLatestRef';
import { useOpenFileSelector } from '@/renderer/hooks/file/useOpenFileSelector';
import ContextUsageIndicator from '@/renderer/components/agent/ContextUsageIndicator';
import { useAutoTitle } from '@/renderer/hooks/chat/useAutoTitle';
import AgentModeSelector from '@/renderer/components/agent/AgentModeSelector';
import { useSlashCommands } from '@/renderer/hooks/chat/useSlashCommands';
import TurnSummaryPanel from '@/renderer/pages/conversation/TurnSummaryPanel';
import { useAcpMessage } from './useAcpMessage';
import { useAcpInitialMessage } from './useAcpInitialMessage';

const useAcpSendBoxDraft = getSendBoxDraftHook('acp', {
  _type: 'acp',
  atPath: [],
  content: '',
  uploadFile: [],
});

const EMPTY_AT_PATH: Array<string | FileOrFolderItem> = [];
const EMPTY_UPLOAD_FILES: string[] = [];

const useSendBoxDraft = (conversation_id: string) => {
  const { data, mutate } = useAcpSendBoxDraft(conversation_id);
  const atPath = data?.atPath ?? EMPTY_AT_PATH;
  const uploadFile = data?.uploadFile ?? EMPTY_UPLOAD_FILES;
  const content = data?.content ?? '';

  const setAtPath = useCallback(
    (nextAtPath: Array<string | FileOrFolderItem>) => {
      mutate((prev) => ({ ...prev, atPath: nextAtPath }));
    },
    [data, mutate]
  );

  const setUploadFile = createSetUploadFile(mutate, data);

  const setContent = useCallback(
    (nextContent: string) => {
      mutate((prev) => ({ ...prev, content: nextContent }));
    },
    [data, mutate]
  );

  return {
    atPath,
    uploadFile,
    setAtPath,
    setUploadFile,
    content,
    setContent,
  };
};

const AcpSendBox: React.FC<{
  conversation_id: string;
  backend: AcpBackend;
  sessionMode?: string;
  agentName?: string;
}> = ({ conversation_id, backend, sessionMode, agentName }) => {
  const {
    thought,
    running,
    hasHydratedRunningState,
    acpStatus,
    aiProcessing,
    setAiProcessing,
    resetState,
    tokenUsage,
    contextLimit,
    hasThinkingMessage,
  } = useAcpMessage(conversation_id);
  const { t } = useTranslation();
  const { checkAndUpdateTitle } = useAutoTitle();
  const slashCommands = useSlashCommands(conversation_id, { agentStatus: acpStatus });
  const { atPath, uploadFile, setAtPath, setUploadFile, content, setContent } = useSendBoxDraft(conversation_id);
  const teamDelegation = useTeamDelegationMention({
    conversationId: conversation_id,
    input: content,
    setInput: setContent,
  });
  const mentionMenuItems = React.useMemo<SlashCommandMenuItem[]>(
    () =>
      teamDelegation.filteredAssistants.map((assistant) => ({
        key: assistant.id,
        label: `@${assistant.alias || assistant.name}`,
        description: assistant.alias ? assistant.name : assistant.id,
        badge: assistant.runtime,
      })),
    [teamDelegation.filteredAssistants]
  );
  const { setSendBoxHandler } = usePreviewContext();

  // Use useLatestRef to keep latest setters to avoid re-registering handler
  const setContentRef = useLatestRef(setContent);
  const atPathRef = useLatestRef(atPath);

  const addOrUpdateMessage = useAddOrUpdateMessage(); // Move this here so it's available in useEffect
  const addOrUpdateMessageRef = useLatestRef(addOrUpdateMessage);

  // Shared file handling logic
  const { handleFilesAdded, clearFiles } = useSendBoxFiles({
    atPath,
    uploadFile,
    setAtPath,
    setUploadFile,
  });
  const isBusy = running || aiProcessing;

  // Register handler for adding text from preview panel to sendbox
  useEffect(() => {
    const handler = (text: string) => {
      // If there's existing content, add newline and new text; otherwise just set the text
      const newContent = content ? `${content}\n${text}` : text;
      setContentRef.current(newContent);
    };
    setSendBoxHandler(handler);
  }, [setSendBoxHandler, content]);

  // Listen for sendbox.fill event to populate input from external sources
  useAddEventListener(
    'sendbox.fill',
    (text: string) => {
      setContentRef.current(text);
    },
    []
  );

  // Check for and send initial message from guid page
  useAcpInitialMessage({
    conversationId: conversation_id,
    backend,
    setAiProcessing,
    checkAndUpdateTitle,
    addOrUpdateMessage: addOrUpdateMessageRef.current,
  });

  const executeCommand = useCallback(
    async ({ input, files }: Pick<ConversationCommandQueueItem, 'input' | 'files'>) => {
      const msg_id = uuid();

      setAiProcessing(true);

      try {
        void checkAndUpdateTitle(conversation_id, input);
        const result = await ipcBridge.acpConversation.sendMessage.invoke({
          input,
          msg_id,
          conversation_id,
          files,
        });
        assertBridgeSuccess(result, `Failed to send message to ${backend}`);
        emitter.emit('chat.history.refresh');
      } catch (error: unknown) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        const isAuthError =
          errorMsg.includes('[ACP-AUTH-') ||
          errorMsg.includes('authentication failed') ||
          errorMsg.includes('认证失败');
        if (isAuthError) {
          const errorMessage = {
            id: uuid(),
            msg_id: uuid(),
            conversation_id,
            type: 'error',
            data: t('acp.auth.failed', {
              backend,
              error: errorMsg,
              defaultValue: `${backend} authentication failed:

{{error}}

Please check your local CLI tool authentication status`,
            }),
          };

          ipcBridge.acpConversation.responseStream.emit(errorMessage);
        }

        setAiProcessing(false);
        throw error;
      }

      if (files.length > 0) {
        emitter.emit('acp.workspace.refresh');
      }
    },
    [backend, checkAndUpdateTitle, conversation_id, setAiProcessing, t]
  );

  const {
    items: queuedCommands,
    isPaused: isQueuePaused,
    isInteractionLocked: isQueueInteractionLocked,
    hasPendingCommands,
    enqueue,
    update,
    remove,
    clear,
    reorder,
    pause,
    resume,
    lockInteraction,
    unlockInteraction,
    resetActiveExecution,
  } = useConversationCommandQueue({
    conversationId: conversation_id,
    isBusy,
    isHydrated: hasHydratedRunningState,
    onExecute: executeCommand,
  });

  const onSendHandler = async (message: string) => {
    const msg_id = uuid();
    const atPathFiles = atPath.map((item) => (typeof item === 'string' ? item : item.path));
    const allFiles = [...uploadFile, ...atPathFiles];

    clearFiles();

    if (teamDelegation.selectedAssistant) {
      const result = await ipcBridge.conversation.team.delegateFromUser.invoke({
        conversation_id,
        msg_id,
        input: message,
        files: allFiles,
        delegation: {
          assistantId: teamDelegation.selectedAssistant.id,
          displayAlias: teamDelegation.selectedAssistant.alias || teamDelegation.selectedAssistant.name,
        },
      });
      if (!result.success) {
        throw new Error(result.msg || 'Failed to delegate task');
      }
      teamDelegation.clearSelectedAssistant();
      emitter.emit('chat.history.refresh');
      emitter.emit('acp.selected.file.clear');
      if (allFiles.length) {
        emitter.emit('acp.workspace.refresh');
      }
      return;
    }

    emitter.emit('acp.selected.file.clear');

    if (shouldEnqueueConversationCommand({ isBusy, hasPendingCommands })) {
      enqueue({ input: message, files: allFiles });
      return;
    }

    await executeCommand({ input: message, files: allFiles });
  };

  const appendSelectedFiles = useCallback(
    (files: string[]) => {
      setUploadFile((prev) => [...prev, ...files]);
    },
    [setUploadFile]
  );
  const { openFileSelector, onSlashBuiltinCommand } = useOpenFileSelector({
    onFilesSelected: appendSelectedFiles,
  });

  useAddEventListener('acp.selected.file', setAtPath);
  useAddEventListener('acp.selected.file.append', (selectedItems: Array<string | FileOrFolderItem>) => {
    const merged = mergeFileSelectionItems(atPathRef.current, selectedItems);
    if (merged !== atPathRef.current) {
      setAtPath(merged as Array<string | FileOrFolderItem>);
    }
  });

  // Stop conversation handler
  const handleStop = async (): Promise<void> => {
    // Use finally to ensure UI state is reset even if backend stop fails
    try {
      await ipcBridge.conversation.stop.invoke({ conversation_id });
    } finally {
      resetState();
      resetActiveExecution('stop');
    }
  };

  return (
    <div className='max-w-800px w-full mx-auto flex flex-col mt-auto mb-16px'>
      <ThoughtDisplay thought={thought} running={(running || aiProcessing) && !hasThinkingMessage} onStop={handleStop} />
      <TurnSummaryPanel conversationId={conversation_id} />
      <CommandQueuePanel
        items={queuedCommands}
        paused={isQueuePaused}
        interactionLocked={isQueueInteractionLocked}
        onPause={pause}
        onResume={resume}
        onInteractionLock={lockInteraction}
        onInteractionUnlock={unlockInteraction}
        onUpdate={(commandId, input) => update(commandId, { input })}
        onReorder={reorder}
        onRemove={remove}
        onClear={clear}
      />

      <SendBox
        value={content}
        onChange={teamDelegation.handleInputChange}
        onInputKeyDownIntercept={teamDelegation.handleKeyDown}
        floatingPanel={
          teamDelegation.enabled && teamDelegation.menuOpen ? (
            <SlashCommandMenu
              title={t('conversation.team.mention.title')}
              hint={t('conversation.team.mention.hint')}
              items={mentionMenuItems}
              activeIndex={teamDelegation.activeIndex}
              loading={teamDelegation.loading}
              onHoverItem={teamDelegation.setActiveIndex}
              onSelectItem={(item) => {
                teamDelegation.selectAssistantById(item.key);
              }}
              emptyText={t('conversation.team.mention.empty')}
            />
          ) : null
        }
        loading={isBusy}
        disabled={false}
        placeholder={t('acp.sendbox.placeholder', {
          backend: agentName || backend,
          defaultValue: `Send message to {{backend}}...`,
        })}
        onStop={handleStop}
        className='z-10'
        onFilesAdded={handleFilesAdded}
        hasPendingAttachments={uploadFile.length > 0 || atPath.length > 0}
        enableBtw={isSideQuestionSupported({ type: 'acp', backend })}
        supportedExts={allSupportedExts}
        defaultMultiLine={true}
        lockMultiLine={true}
        tools={
          <div className='flex items-center gap-4px'>
            <FileAttachButton openFileSelector={openFileSelector} onLocalFilesAdded={handleFilesAdded} />
            <AgentModeSelector
              backend={backend}
              conversationId={conversation_id}
              compact
              initialMode={sessionMode}
              compactLeadingIcon={<Shield theme='outline' size='14' fill={iconColors.secondary} />}
              modeLabelFormatter={(mode) => t(`agentMode.${mode.value}`, { defaultValue: mode.label })}
              compactLabelPrefix={t('agentMode.permission')}
              hideCompactLabelPrefixOnMobile
            />
            <AcpConfigSelector conversationId={conversation_id} backend={backend} />
          </div>
        }
        prefix={
          <>
            {teamDelegation.selectedAssistant && (
              <TeamDelegationBadge
                assistantName={teamDelegation.selectedAssistant.alias || teamDelegation.selectedAssistant.name}
                onClose={teamDelegation.clearSelectedAssistant}
              />
            )}
            {/* Files on top */}
            {(uploadFile.length > 0 || atPath.some((item) => (typeof item === 'string' ? true : item.isFile))) && (
              <HorizontalFileList>
                {uploadFile.map((path) => (
                  <FilePreview
                    key={path}
                    path={path}
                    onRemove={() => setUploadFile(uploadFile.filter((v) => v !== path))}
                  />
                ))}
                {atPath.map((item) => {
                  const isFile = typeof item === 'string' ? true : item.isFile;
                  const path = typeof item === 'string' ? item : item.path;
                  if (isFile) {
                    return (
                      <FilePreview
                        key={path}
                        path={path}
                        onRemove={() => {
                          const newAtPath = atPath.filter((v) =>
                            typeof v === 'string' ? v !== path : v.path !== path
                          );
                          emitter.emit('acp.selected.file', newAtPath);
                          setAtPath(newAtPath);
                        }}
                      />
                    );
                  }
                  return null;
                })}
              </HorizontalFileList>
            )}
            {/* Folder tags below */}
            {atPath.some((item) => (typeof item === 'string' ? false : !item.isFile)) && (
              <div className='flex flex-wrap items-center gap-8px mb-8px'>
                {atPath.map((item) => {
                  if (typeof item === 'string') return null;
                  if (!item.isFile) {
                    return (
                      <Tag
                        key={item.path}
                        color='blue'
                        closable
                        onClose={() => {
                          const newAtPath = atPath.filter((v) => (typeof v === 'string' ? true : v.path !== item.path));
                          emitter.emit('acp.selected.file', newAtPath);
                          setAtPath(newAtPath);
                        }}
                      >
                        {item.name}
                      </Tag>
                    );
                  }
                  return null;
                })}
              </div>
            )}
          </>
        }
        onSend={onSendHandler}
        slashCommands={slashCommands}
        onSlashBuiltinCommand={onSlashBuiltinCommand}
        allowSendWhileLoading
        sendButtonPrefix={
          tokenUsage ? (
            <ContextUsageIndicator
              tokenUsage={tokenUsage}
              contextLimit={contextLimit > 0 ? contextLimit : undefined}
              size={24}
            />
          ) : undefined
        }
      ></SendBox>
    </div>
  );
};

export default AcpSendBox;
