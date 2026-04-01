/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  TeamRunPhase,
  TeamRunRecord,
  TeamRunStatus,
  TeamSelectionMode,
  TeamTaskRecord,
  TeamTaskStatus,
} from '@process/team/teamTypes';

export type CreateTeamRunInput = {
  id: string;
  mainConversationId: string;
  rootConversationId: string;
  status?: TeamRunStatus;
  currentPhase?: TeamRunPhase;
  awaitingUserInput?: boolean;
  activeTaskCount?: number;
  createdAt?: number;
  updatedAt?: number;
};

export type CreateTeamTaskInput = {
  id: string;
  runId: string;
  parentConversationId: string;
  subConversationId?: string;
  assistantId?: string;
  assistantName?: string;
  status?: TeamTaskStatus;
  title: string;
  taskPrompt: string;
  expectedOutput?: string;
  selectionMode: TeamSelectionMode;
  selectionReason?: string;
  ownedPaths?: string[];
  lastError?: string;
  createdAt?: number;
  updatedAt?: number;
};

export interface ITeamRepository {
  createTeamRun(input: CreateTeamRunInput): Promise<TeamRunRecord>;
  getTeamRun(id: string): Promise<TeamRunRecord | null>;
  findTeamRunByMainConversationId(mainConversationId: string): Promise<TeamRunRecord | null>;
  updateTeamRun(id: string, patch: Partial<TeamRunRecord>): Promise<void>;
  createTeamTask(input: CreateTeamTaskInput): Promise<TeamTaskRecord>;
  getTeamTask(id: string): Promise<TeamTaskRecord | null>;
  updateTeamTask(id: string, patch: Partial<TeamTaskRecord>): Promise<void>;
  listTeamTasksByRun(runId: string): Promise<TeamTaskRecord[]>;
  listTeamTasksByParentConversationId(parentConversationId: string): Promise<TeamTaskRecord[]>;
  findTeamTaskBySubConversationId(subConversationId: string): Promise<TeamTaskRecord | null>;
}
