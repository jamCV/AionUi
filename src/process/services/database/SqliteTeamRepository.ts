/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { getDatabase } from '@process/services/database';
import type { ITeamRepository } from './ITeamRepository';
import type { TeamRunRecord, TeamTaskRecord } from '@process/team/teamTypes';
import type { CreateTeamRunInput, CreateTeamTaskInput } from './ITeamRepository';

/**
 * SQLite-backed implementation of ITeamRepository.
 * Delegates to the AionUIDatabase singleton via getDatabase().
 * Methods are async because getDatabase() returns a Promise.
 */
export class SqliteTeamRepository implements ITeamRepository {
  private getDb() {
    return getDatabase();
  }

  async createTeamRun(input: CreateTeamRunInput): Promise<TeamRunRecord> {
    const db = await this.getDb();
    const result = db.createTeamRun({
      id: input.id,
      mainConversationId: input.mainConversationId,
      rootConversationId: input.rootConversationId,
      status: input.status ?? 'running',
      currentPhase: input.currentPhase ?? 'delegating',
      awaitingUserInput: input.awaitingUserInput ?? false,
      activeTaskCount: input.activeTaskCount ?? 0,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
    });

    if (!result.success || !result.data) {
      throw new Error(result.error ?? 'Failed to create team run');
    }

    return result.data;
  }

  async getTeamRun(id: string): Promise<TeamRunRecord | null> {
    const db = await this.getDb();
    const result = db.getTeamRun(id);
    return result.success ? (result.data ?? null) : null;
  }

  async findTeamRunByMainConversationId(mainConversationId: string): Promise<TeamRunRecord | null> {
    const db = await this.getDb();
    const result = db.findTeamRunByMainConversationId(mainConversationId);
    return result.success ? (result.data ?? null) : null;
  }

  async updateTeamRun(id: string, patch: Partial<TeamRunRecord>): Promise<void> {
    const db = await this.getDb();
    db.updateTeamRun({
      id,
      mainConversationId: patch.mainConversationId,
      rootConversationId: patch.rootConversationId,
      status: patch.status,
      currentPhase: patch.currentPhase,
      awaitingUserInput: patch.awaitingUserInput,
      activeTaskCount: patch.activeTaskCount,
      updatedAt: patch.updatedAt,
    });
  }

  async createTeamTask(input: CreateTeamTaskInput): Promise<TeamTaskRecord> {
    const db = await this.getDb();
    const result = db.createTeamTask({
      id: input.id,
      runId: input.runId,
      parentConversationId: input.parentConversationId,
      subConversationId: input.subConversationId,
      assistantId: input.assistantId,
      assistantName: input.assistantName,
      status: input.status ?? 'queued',
      title: input.title,
      taskPrompt: input.taskPrompt,
      expectedOutput: input.expectedOutput,
      selectionMode: input.selectionMode,
      selectionReason: input.selectionReason,
      ownedPaths: input.ownedPaths ?? [],
      lastError: input.lastError,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
    });

    if (!result.success || !result.data) {
      throw new Error(result.error ?? 'Failed to create team task');
    }

    return result.data;
  }

  async getTeamTask(id: string): Promise<TeamTaskRecord | null> {
    const db = await this.getDb();
    const result = db.getTeamTask(id);
    return result.success ? (result.data ?? null) : null;
  }

  async updateTeamTask(id: string, patch: Partial<TeamTaskRecord>): Promise<void> {
    const db = await this.getDb();
    db.updateTeamTask({
      id,
      runId: patch.runId,
      parentConversationId: patch.parentConversationId,
      subConversationId: patch.subConversationId,
      assistantId: patch.assistantId,
      assistantName: patch.assistantName,
      status: patch.status,
      title: patch.title,
      taskPrompt: patch.taskPrompt,
      expectedOutput: patch.expectedOutput,
      selectionMode: patch.selectionMode,
      selectionReason: patch.selectionReason,
      ownedPaths: patch.ownedPaths,
      lastError: patch.lastError,
      updatedAt: patch.updatedAt,
    });
  }

  async listTeamTasksByRun(runId: string): Promise<TeamTaskRecord[]> {
    const db = await this.getDb();
    const result = db.listTeamTasksByRun(runId);
    return result.data ?? [];
  }

  async listTeamTasksByParentConversationId(parentConversationId: string): Promise<TeamTaskRecord[]> {
    const db = await this.getDb();
    const result = db.listTeamTasksByParentConversationId(parentConversationId);
    return result.data ?? [];
  }

  async findTeamTaskBySubConversationId(subConversationId: string): Promise<TeamTaskRecord | null> {
    const db = await this.getDb();
    const result = db.findTeamTaskBySubConversationId(subConversationId);
    return result.success ? (result.data ?? null) : null;
  }
}
