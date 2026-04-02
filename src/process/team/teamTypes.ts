/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@/common/config/storage';

export type SupportedTeamRuntime = 'codex' | 'gemini' | 'acp';
export type TriggerSource = 'user_explicit' | 'agent_auto';

export type TeamRunStatus = 'running' | 'waiting_user' | 'completed' | 'failed' | 'cancelled';

export type TeamTaskStatus =
  | 'queued'
  | 'bootstrapping'
  | 'running'
  | 'waiting_user'
  | 'completed'
  | 'failed'
  | 'interrupted'
  | 'cancelled';

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
  assistantBinding?: PersistedAssistantBinding;
  assistantBindingJson?: string;
  displayAlias?: string;
  triggerSource?: TriggerSource;
  requestedByMessageId?: string;
  resumeCount: number;
  ownedPaths: string[];
  lastError?: string;
  createdAt: number;
  updatedAt: number;
};

export type AssistanceDescriptor = {
  id: string;
  name: string;
  alias?: string;
  runtime: SupportedTeamRuntime;
  backend?: string;
  presetAssistantId?: string;
  customAgentId?: string;
  enabledSkills?: string[];
  presetRules?: string;
  source: 'preset' | 'custom' | 'extension' | 'fallback';
};

export type PersistedAssistantBinding = {
  descriptorId: string;
  assistantName: string;
  runtime: SupportedTeamRuntime;
  createConversationParams: {
    type: TChatConversation['type'];
    name?: string;
    model?: Record<string, unknown>;
    extra?: Record<string, unknown>;
  };
};

export type SubagentCompletionReport = {
  status: 'completed' | 'failed' | 'waiting_user' | 'interrupted';
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

export const SUPPORTED_TEAM_RUNTIMES: SupportedTeamRuntime[] = ['codex', 'gemini', 'acp'];

export const isSupportedTeamConversation = (conversation: TChatConversation): boolean => {
  if (conversation.extra?.team?.role === 'subagent') {
    return false;
  }

  return conversation.type === 'codex' || conversation.type === 'gemini' || conversation.type === 'acp';
};

export const isSupportedTeamAssistant = (descriptor: AssistanceDescriptor): boolean => {
  return SUPPORTED_TEAM_RUNTIMES.includes(descriptor.runtime);
};

export const isActiveTeamTaskStatus = (status: TeamTaskStatus): boolean => {
  return status === 'queued' || status === 'bootstrapping' || status === 'running' || status === 'waiting_user';
};
