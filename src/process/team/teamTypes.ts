/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

export type TeamRunStatus = 'running' | 'waiting_user' | 'completed' | 'failed' | 'cancelled';

export type TeamTaskStatus = 'queued' | 'running' | 'waiting_user' | 'completed' | 'failed' | 'cancelled';

export type TeamSelectionMode = 'recommended' | 'manual' | 'fallback';

export type TeamRunPhase = 'delegating' | 'subtask_running' | 'continuing_main' | 'completed' | 'failed';

export type TeamRunRecord = {
  id: string;
  mainConversationId: string;
  rootConversationId: string;
  status: TeamRunStatus;
  currentPhase: TeamRunPhase;
  awaitingUserInput: boolean;
  activeTaskCount: number;
  createdAt: number;
  updatedAt: number;
};

export type TeamTaskRecord = {
  id: string;
  runId: string;
  parentConversationId: string;
  subConversationId?: string;
  assistantId?: string;
  assistantName?: string;
  status: TeamTaskStatus;
  title: string;
  taskPrompt: string;
  expectedOutput?: string;
  selectionMode: TeamSelectionMode;
  selectionReason?: string;
  ownedPaths: string[];
  lastError?: string;
  createdAt: number;
  updatedAt: number;
};

export type SubagentCompletionReport = {
  status: 'completed' | 'failed' | 'waiting_user';
  summary: string;
  touchedFiles: string[];
  needsUserDecision: boolean;
  openQuestions: string[];
};

export type InternalContinuationInput = {
  kind: 'team-subtask-report';
  runId: string;
  taskId: string;
  report: SubagentCompletionReport;
};

export type TeamCommand =
  | {
      action: 'delegate';
      title: string;
      taskPrompt: string;
      expectedOutput?: string;
      recommendedAssistantId?: string;
      candidateAssistantIds?: string[];
      ownedPaths?: string[];
      blocking?: boolean;
    }
  | {
      action: 'complete';
      summary: string;
    };
