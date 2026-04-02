/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TeamCommand } from './teamTypes';

export type TeamTurnCompletionEvent = {
  conversationId: string;
  assistantMessageId?: string;
  completionSignal: 'finish' | 'error' | 'stop';
  completionSource?: string;
  teamCommand?: TeamCommand;
};

type TeamTurnCompletionHandler = (event: TeamTurnCompletionEvent) => Promise<void>;

let completionHandler: TeamTurnCompletionHandler | null = null;

export function registerTeamTurnCompletionHandler(handler: TeamTurnCompletionHandler): void {
  completionHandler = handler;
}

export function notifyTeamTurnCompleted(event: TeamTurnCompletionEvent): void {
  if (!completionHandler) {
    return;
  }

  void completionHandler(event).catch((error) => {
    console.error('[SubagentTeam] Failed to handle team turn completion:', error);
  });
}
