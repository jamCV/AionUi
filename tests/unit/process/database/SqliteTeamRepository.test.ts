/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TeamRunRecord, TeamTaskRecord } from '../../../../src/process/team/teamTypes';

vi.mock('electron', () => ({ app: { getPath: vi.fn(() => '/tmp/test') } }));

const mockDb = {
  createTeamRun: vi.fn(),
  getTeamRun: vi.fn(),
  findTeamRunByMainConversationId: vi.fn(),
  updateTeamRun: vi.fn(),
  createTeamTask: vi.fn(),
  getTeamTask: vi.fn(),
  updateTeamTask: vi.fn(),
  listTeamTasksByRun: vi.fn(),
  listTeamTasksByParentConversationId: vi.fn(),
  findTeamTaskBySubConversationId: vi.fn(),
};

vi.mock('@process/services/database', () => ({ getDatabase: vi.fn(() => Promise.resolve(mockDb)) }));

import { SqliteTeamRepository } from '../../../../src/process/services/database/SqliteTeamRepository';

const makeTeamRun = (): TeamRunRecord => ({
  id: 'run-1',
  mainConversationId: 'main-conv-1',
  rootConversationId: 'root-conv-1',
  status: 'running',
  currentPhase: 'delegating',
  awaitingUserInput: false,
  activeTaskCount: 0,
  createdAt: 10,
  updatedAt: 20,
});

const makeTeamTask = (): TeamTaskRecord => ({
  id: 'task-1',
  runId: 'run-1',
  parentConversationId: 'main-conv-1',
  subConversationId: 'sub-conv-1',
  assistantId: 'assistant-1',
  assistantName: 'Assistant One',
  status: 'queued',
  title: 'Review persistence layer',
  taskPrompt: 'Inspect team persistence flow',
  expectedOutput: 'Summary of findings',
  selectionMode: 'recommended',
  selectionReason: 'Best match for database work',
  ownedPaths: ['src/process/services/database'],
  lastError: undefined,
  createdAt: 10,
  updatedAt: 20,
});

describe('SqliteTeamRepository', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the created team run when persistence succeeds', async () => {
    const createdRun = makeTeamRun();
    mockDb.createTeamRun.mockReturnValue({ success: true, data: createdRun });
    const repo = new SqliteTeamRepository();

    await expect(
      repo.createTeamRun({ id: 'run-1', mainConversationId: 'main-conv-1', rootConversationId: 'root-conv-1' })
    ).resolves.toEqual(createdRun);
    expect(mockDb.createTeamRun).toHaveBeenCalledWith({
      id: 'run-1',
      mainConversationId: 'main-conv-1',
      rootConversationId: 'root-conv-1',
      status: 'running',
      currentPhase: 'delegating',
      awaitingUserInput: false,
      activeTaskCount: 0,
      createdAt: undefined,
      updatedAt: undefined,
    });
  });

  it('throws when creating a team run fails', async () => {
    mockDb.createTeamRun.mockReturnValue({ success: false, error: 'insert failed' });
    const repo = new SqliteTeamRepository();

    await expect(
      repo.createTeamRun({ id: 'run-1', mainConversationId: 'main-conv-1', rootConversationId: 'root-conv-1' })
    ).rejects.toThrow('insert failed');
  });

  it('returns null when a team run lookup fails', async () => {
    mockDb.getTeamRun.mockReturnValue({ success: false, error: 'missing' });
    const repo = new SqliteTeamRepository();

    await expect(repo.getTeamRun('missing-run')).resolves.toBeNull();
  });

  it('delegates team run updates with the provided patch fields', async () => {
    mockDb.updateTeamRun.mockReturnValue({ success: true, data: true });
    const repo = new SqliteTeamRepository();

    await repo.updateTeamRun('run-1', {
      status: 'waiting_user',
      awaitingUserInput: true,
      activeTaskCount: 1,
      updatedAt: 30,
    });

    expect(mockDb.updateTeamRun).toHaveBeenCalledWith({
      id: 'run-1',
      mainConversationId: undefined,
      rootConversationId: undefined,
      status: 'waiting_user',
      currentPhase: undefined,
      awaitingUserInput: true,
      activeTaskCount: 1,
      updatedAt: 30,
    });
  });

  it('returns the latest run for a main conversation when present', async () => {
    const run = makeTeamRun();
    mockDb.findTeamRunByMainConversationId.mockReturnValue({ success: true, data: run });
    const repo = new SqliteTeamRepository();

    await expect(repo.findTeamRunByMainConversationId('main-conv-1')).resolves.toEqual(run);
    expect(mockDb.findTeamRunByMainConversationId).toHaveBeenCalledWith('main-conv-1');
  });

  it('returns the created team task when persistence succeeds', async () => {
    const createdTask = makeTeamTask();
    mockDb.createTeamTask.mockReturnValue({ success: true, data: createdTask });
    const repo = new SqliteTeamRepository();

    await expect(
      repo.createTeamTask({
        id: 'task-1',
        runId: 'run-1',
        parentConversationId: 'main-conv-1',
        title: 'Review persistence layer',
        taskPrompt: 'Inspect team persistence flow',
        selectionMode: 'recommended',
      })
    ).resolves.toEqual(createdTask);
    expect(mockDb.createTeamTask).toHaveBeenCalledWith({
      id: 'task-1',
      runId: 'run-1',
      parentConversationId: 'main-conv-1',
      subConversationId: undefined,
      assistantId: undefined,
      assistantName: undefined,
      status: 'queued',
      title: 'Review persistence layer',
      taskPrompt: 'Inspect team persistence flow',
      expectedOutput: undefined,
      selectionMode: 'recommended',
      selectionReason: undefined,
      ownedPaths: [],
      lastError: undefined,
      createdAt: undefined,
      updatedAt: undefined,
    });
  });

  it('throws when creating a team task fails', async () => {
    mockDb.createTeamTask.mockReturnValue({ success: false, error: 'task insert failed' });
    const repo = new SqliteTeamRepository();

    await expect(
      repo.createTeamTask({
        id: 'task-1',
        runId: 'run-1',
        parentConversationId: 'main-conv-1',
        title: 'Review persistence layer',
        taskPrompt: 'Inspect team persistence flow',
        selectionMode: 'recommended',
      })
    ).rejects.toThrow('task insert failed');
  });

  it('returns null when a team task lookup fails', async () => {
    mockDb.getTeamTask.mockReturnValue({ success: false, error: 'missing' });
    const repo = new SqliteTeamRepository();

    await expect(repo.getTeamTask('missing-task')).resolves.toBeNull();
  });

  it('delegates team task updates with the provided patch fields', async () => {
    mockDb.updateTeamTask.mockReturnValue({ success: true, data: true });
    const repo = new SqliteTeamRepository();

    await repo.updateTeamTask('task-1', {
      status: 'running',
      subConversationId: 'sub-conv-2',
      ownedPaths: ['src/process/team'],
      updatedAt: 40,
    });

    expect(mockDb.updateTeamTask).toHaveBeenCalledWith({
      id: 'task-1',
      runId: undefined,
      parentConversationId: undefined,
      subConversationId: 'sub-conv-2',
      assistantId: undefined,
      assistantName: undefined,
      status: 'running',
      title: undefined,
      taskPrompt: undefined,
      expectedOutput: undefined,
      selectionMode: undefined,
      selectionReason: undefined,
      ownedPaths: ['src/process/team'],
      lastError: undefined,
      updatedAt: 40,
    });
  });

  it('returns empty lists when team task queries have no data', async () => {
    mockDb.listTeamTasksByRun.mockReturnValue({ success: false, data: undefined });
    mockDb.listTeamTasksByParentConversationId.mockReturnValue({ success: false, data: undefined });
    const repo = new SqliteTeamRepository();

    await expect(repo.listTeamTasksByRun('run-1')).resolves.toEqual([]);
    await expect(repo.listTeamTasksByParentConversationId('main-conv-1')).resolves.toEqual([]);
  });

  it('returns null when no sub-conversation task is found', async () => {
    mockDb.findTeamTaskBySubConversationId.mockReturnValue({ success: true, data: null });
    const repo = new SqliteTeamRepository();

    await expect(repo.findTeamTaskBySubConversationId('sub-conv-missing')).resolves.toBeNull();
  });
});
