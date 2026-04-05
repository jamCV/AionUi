/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { TMessage } from '@/common/chat/chatLib';
import { uuid } from '@/common/utils';
import { buildDisplayMessage } from '@/renderer/utils/file/messageFiles';
import { emitter } from '@/renderer/utils/emitter';
import { useEffect } from 'react';

type UseAcpInitialMessageParams = {
  conversationId: string;
  workspacePath: string;
  backend: string;
  setAiProcessing: (value: boolean) => void;
  checkAndUpdateTitle: (conversationId: string, input: string) => void;
  addOrUpdateMessage: (message: TMessage, prepend?: boolean) => void;
};

/**
 * Side-effect-only hook that checks sessionStorage for an initial message
 * and sends it when the ACP conversation first mounts.
 */
export const useAcpInitialMessage = ({
  conversationId,
  workspacePath,
  backend,
  setAiProcessing,
  checkAndUpdateTitle,
  addOrUpdateMessage,
}: UseAcpInitialMessageParams): void => {
  useEffect(() => {
    const storageKey = `acp_initial_message_${conversationId}`;
    const storedMessage = sessionStorage.getItem(storageKey);

    if (!storedMessage) return;

    // Clear immediately to prevent duplicate sends (e.g., if component remounts while sendMessage is pending)
    sessionStorage.removeItem(storageKey);

    const sendInitialMessage = async () => {
      try {
        const initialMessage = JSON.parse(storedMessage);
        const { input, files } = initialMessage;
        const displayMessage = buildDisplayMessage(input, files, workspacePath);
        const msg_id = uuid();
        const userMessage: TMessage = {
          id: msg_id,
          msg_id,
          conversation_id: conversationId,
          type: 'text',
          position: 'right',
          content: { content: displayMessage },
          createdAt: Date.now(),
        };

        addOrUpdateMessage(userMessage, true);

        // Start AI processing loading state (user message is rendered optimistically)
        setAiProcessing(true);

        // Send the message
        void checkAndUpdateTitle(conversationId, input);
        const result = await ipcBridge.acpConversation.sendMessage.invoke({
          input: displayMessage,
          msg_id,
          conversation_id: conversationId,
          files,
        });

        if (result && result.success === true) {
          // Initial message sent successfully
          emitter.emit('chat.history.refresh');
        } else {
          // Handle send failure
          console.error('[ACP-FRONTEND] Failed to send initial message:', result);
          // Create error message in UI
          const errorMessage: TMessage = {
            id: uuid(),
            msg_id: uuid(),
            conversation_id: conversationId,
            type: 'tips',
            position: 'center',
            content: {
              content: 'Failed to send message. Please try again.',
              type: 'error',
            },
            createdAt: Date.now() + 2,
          };
          addOrUpdateMessage(errorMessage, true);
          setAiProcessing(false); // Stop loading state on failure
        }
      } catch (error) {
        console.error('Error sending initial message:', error);
        setAiProcessing(false); // Stop loading state on error
      }
    };

    sendInitialMessage().catch((error) => {
      console.error('Failed to send initial message:', error);
    });
  }, [addOrUpdateMessage, backend, checkAndUpdateTitle, conversationId, setAiProcessing, workspacePath]);
};
