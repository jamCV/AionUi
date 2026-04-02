/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type {
  IConversationTeamAssistantDescriptor,
  IConversationTeamDelegateFromUserParams,
} from '@/common/adapter/ipcBridge';
import type { TMessage } from '@/common/chat/chatLib';
import type { TChatConversation } from '@/common/config/storage';
import { uuid } from '@/common/utils';
import { turnSnapshotCoordinator } from '@process/bridge/services/TurnSnapshotCoordinator';
import { turnSnapshotService } from '@process/bridge/services/TurnSnapshotService';
import type { CreateConversationParams, IConversationService } from '@process/services/IConversationService';
import type { IConversationRepository } from '@process/services/database/IConversationRepository';
import type { CreateTeamTaskInput, ITeamRepository } from '@process/services/database/ITeamRepository';
import { extractTextFromMessage } from '@process/task/MessageMiddleware';
import type { IWorkerTaskManager } from '@process/task/IWorkerTaskManager';
import { AssistantCatalogService, type TeamAssistantSelection } from './AssistantCatalogService';
import { TeamCommandDetector } from './TeamCommandDetector';
import type { TeamTurnCompletionEvent } from './teamRuntimeHooks';
import type {
  InternalContinuationInput,
  SubagentCompletionReport,
  TeamCommand,
  TeamRunRecord,
  TeamTaskRecord,
  TeamTaskStatus,
} from './teamTypes';
import { isActiveTeamTaskStatus, isSupportedTeamConversation } from './teamTypes';

type DelegateTeamCommand = Extract<TeamCommand, { action: 'delegate' }>;

type CreateDelegatedTaskInput = {
  run: TeamRunRecord;
  mainConversation: TChatConversation;
  command: DelegateTeamCommand;
  selection: TeamAssistantSelection;
  triggerSource: 'user_explicit' | 'agent_auto';
  requestedByMessageId?: string;
  displayAlias?: string;
};

const isFailedSendResult = (result: unknown): result is { success: false; msg?: string } =>
  !!result && typeof result === 'object' && 'success' in result && result.success === false;

export class TeamOrchestratorService {
  private readonly handledMainTurnKeys = new Set<string>();
  private readonly handledSubTurnKeys = new Set<string>();
  private readonly recoveredRunIds = new Set<string>();

  constructor(
    private readonly teamRepo: ITeamRepository,
    private readonly conversationRepo: IConversationRepository,
    private readonly conversationService: IConversationService,
    private readonly workerTaskManager: IWorkerTaskManager,
    private readonly commandDetector: TeamCommandDetector = new TeamCommandDetector(),
    private readonly assistantCatalogService: AssistantCatalogService = new AssistantCatalogService()
  ) {}

  async listAvailableAssistants(conversationId: string): Promise<IConversationTeamAssistantDescriptor[]> {
    const mainConversationId = await this.resolveMainConversationId(conversationId);
    if (!mainConversationId) {
      return [];
    }

    const mainConversation = await this.conversationService.getConversation(mainConversationId);
    if (!mainConversation || !isSupportedTeamConversation(mainConversation)) {
      return [];
    }

    const descriptors = await this.assistantCatalogService.listAvailableAssistants(mainConversation);
    return descriptors.map((descriptor) => ({
      id: descriptor.id,
      name: descriptor.name,
      alias: descriptor.alias,
      runtime: descriptor.runtime,
      backend: descriptor.backend,
      source: descriptor.source,
    }));
  }

  async delegateFromUser(params: IConversationTeamDelegateFromUserParams): Promise<{ taskId: string; runId: string }> {
    const mainConversation = await this.conversationService.getConversation(params.conversation_id);
    if (!mainConversation) {
      throw new Error(`Conversation not found: ${params.conversation_id}`);
    }
    if (!isSupportedTeamConversation(mainConversation)) {
      throw new Error('Conversation runtime is not supported for team delegation');
    }

    const run = await this.ensureRun(mainConversation.id);
    const activeTasks = await this.getActiveTasks(run.id);
    if (activeTasks.length > 0) {
      throw new Error('An active delegated task already exists');
    }

    const cleanedInput = this.stripMentionToken(params.input);
    await this.persistUserDelegationMessage(mainConversation.id, params.msg_id, cleanedInput);

    const selection = await this.assistantCatalogService.selectionFromExplicitAssistant(
      mainConversation,
      params.delegation.assistantId
    );
    const command: DelegateTeamCommand = {
      action: 'delegate',
      title: cleanedInput.slice(0, 60) || `Delegated task ${new Date().toISOString()}`,
      taskPrompt: cleanedInput,
    };

    const task = await this.createDelegatedTask({
      run,
      mainConversation,
      command,
      selection,
      triggerSource: 'user_explicit',
      requestedByMessageId: params.msg_id,
      displayAlias: params.delegation.displayAlias,
    });

    try {
      await this.spawnSubConversationFromBinding(task.id);
      await this.dispatchTask(task.id);
      return { taskId: task.id, runId: run.id };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.markTaskFailed(task.id, run.id, message);
      throw error;
    }
  }

  async stopTask(conversationId: string, taskId: string): Promise<void> {
    const task = await this.assertTaskOwnedByConversation(conversationId, taskId);
    if (!task.subConversationId) {
      throw new Error('Task has no sub-conversation');
    }

    const subTask = this.workerTaskManager.getTask(task.subConversationId);
    if (subTask) {
      await subTask.stop();
    }

    await this.teamRepo.updateTeamTask(task.id, {
      status: 'interrupted',
      updatedAt: Date.now(),
    });
    await this.updateRunState(task.runId, {
      status: 'running',
      currentPhase: 'delegating',
      awaitingUserInput: false,
    });
  }

  async cancelTask(conversationId: string, taskId: string): Promise<void> {
    const task = await this.assertTaskOwnedByConversation(conversationId, taskId);
    if (task.subConversationId) {
      const subTask = this.workerTaskManager.getTask(task.subConversationId);
      if (subTask) {
        await subTask.stop();
      }
    }

    await this.teamRepo.updateTeamTask(task.id, {
      status: 'cancelled',
      updatedAt: Date.now(),
    });
    await this.updateRunState(task.runId, {
      status: 'running',
      currentPhase: 'delegating',
      awaitingUserInput: false,
    });
  }

  async retryTask(conversationId: string, taskId: string): Promise<void> {
    const task = await this.assertTaskOwnedByConversation(conversationId, taskId);
    if (!['failed', 'interrupted', 'cancelled'].includes(task.status)) {
      throw new Error(`Task is not retryable: ${task.status}`);
    }

    await this.teamRepo.updateTeamTask(task.id, {
      status: 'queued',
      lastError: undefined,
      resumeCount: (task.resumeCount || 0) + 1,
      updatedAt: Date.now(),
    });

    await this.spawnSubConversationFromBinding(task.id);
    await this.dispatchTask(task.id);
  }

  async renameTaskAlias(conversationId: string, taskId: string, displayAlias?: string): Promise<void> {
    const task = await this.assertTaskOwnedByConversation(conversationId, taskId);
    const normalizedAlias = displayAlias?.trim() || undefined;
    await this.teamRepo.updateTeamTask(task.id, {
      displayAlias: normalizedAlias,
      updatedAt: Date.now(),
    });

    if (!task.subConversationId) {
      return;
    }
    const conversation = await this.conversationService.getConversation(task.subConversationId);
    if (!conversation) {
      return;
    }

    await this.conversationService.updateConversation(
      task.subConversationId,
      {
        extra: {
          team: {
            ...(conversation.extra.team || {
              runId: task.runId,
              role: 'subagent',
              rootConversationId: task.parentConversationId,
            }),
            displayAlias: normalizedAlias,
          },
        },
      },
      true
    );
    this.emitConversationListChanged(task.subConversationId, 'updated');
  }

  async handleConversationTurnCompleted(event: TeamTurnCompletionEvent): Promise<void> {
    const conversation = await this.conversationService.getConversation(event.conversationId);
    if (!conversation) {
      return;
    }

    const teamMeta = conversation.extra?.team;
    if (teamMeta?.role === 'subagent') {
      await this.handleSubConversationCompleted(event.conversationId, event);
      return;
    }

    await this.handleMainTurnCompleted(event.conversationId, event);
  }

  async ensureRun(mainConversationId: string): Promise<TeamRunRecord> {
    const existingRun = await this.teamRepo.findTeamRunByMainConversationId(mainConversationId);
    if (existingRun) {
      return existingRun;
    }

    const mainConversation = await this.conversationService.getConversation(mainConversationId);
    if (!mainConversation) {
      throw new Error(`Main conversation not found: ${mainConversationId}`);
    }

    const run = await this.teamRepo.createTeamRun({
      id: uuid(),
      mainConversationId,
      rootConversationId: mainConversation.extra.team?.rootConversationId || mainConversation.id,
      status: 'running',
      currentPhase: 'delegating',
      awaitingUserInput: false,
      activeTaskCount: 0,
    });

    await this.updateConversationTeamMeta(mainConversationId, {
      runId: run.id,
      role: 'main',
      rootConversationId: run.rootConversationId,
    });

    return run;
  }

  async handleMainTurnCompleted(mainConversationId: string, event?: TeamTurnCompletionEvent): Promise<void> {
    const mainConversation = await this.conversationService.getConversation(mainConversationId);
    if (!mainConversation || mainConversation.extra?.team?.role === 'subagent') {
      return;
    }

    const latestAssistantMessage = await this.findLatestAssistantMessage(mainConversationId, event?.assistantMessageId);
    const dedupeKey = this.buildTurnDedupeKey(mainConversationId, latestAssistantMessage, event);
    if (this.handledMainTurnKeys.has(dedupeKey)) {
      return;
    }
    this.handledMainTurnKeys.add(dedupeKey);

    const latestAssistantText = latestAssistantMessage ? extractTextFromMessage(latestAssistantMessage) : '';
    const command = event?.teamCommand || this.commandDetector.parse(latestAssistantText);
    if (!command) {
      return;
    }

    if (command.action === 'complete') {
      const run = await this.teamRepo.findTeamRunByMainConversationId(mainConversationId);
      if (!run) {
        return;
      }

      await this.updateRunState(run.id, {
        status: 'completed',
        currentPhase: 'completed',
        awaitingUserInput: false,
      });
      return;
    }

    const run = await this.ensureRun(mainConversationId);
    const activeTasks = await this.getActiveTasks(run.id);
    if (activeTasks.length > 0) {
      return;
    }

    const selection = await this.assistantCatalogService.selectAssistant(mainConversation, command);
    const task = await this.createDelegatedTask({
      run,
      mainConversation,
      command,
      selection,
      triggerSource: 'agent_auto',
      requestedByMessageId: event?.assistantMessageId,
    });

    try {
      await this.spawnSubConversationFromBinding(task.id);
      await this.dispatchTask(task.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.markTaskFailed(task.id, run.id, message);
      throw error;
    }
  }

  async createDelegatedTask(input: CreateDelegatedTaskInput): Promise<TeamTaskRecord> {
    const task = await this.teamRepo.createTeamTask({
      id: uuid(),
      runId: input.run.id,
      parentConversationId: input.mainConversation.id,
      assistantId: input.selection.assistantId,
      assistantName: input.selection.assistantName,
      status: 'queued',
      title: input.command.title,
      taskPrompt: input.command.taskPrompt,
      expectedOutput: input.command.expectedOutput,
      selectionMode: input.selection.selectionMode,
      selectionReason: input.selection.selectionReason,
      assistantBinding: input.selection.binding,
      displayAlias: input.displayAlias,
      triggerSource: input.triggerSource,
      requestedByMessageId: input.requestedByMessageId,
      resumeCount: 0,
      ownedPaths: input.command.ownedPaths ?? [],
    } satisfies CreateTeamTaskInput);

    await this.updateRunState(input.run.id, {
      status: 'running',
      currentPhase: 'delegating',
      awaitingUserInput: false,
    });
    return task;
  }

  async spawnSubConversationFromBinding(taskId: string): Promise<string> {
    const task = await this.teamRepo.getTeamTask(taskId);
    if (!task) {
      throw new Error(`Team task not found: ${taskId}`);
    }

    if (task.subConversationId) {
      const existingConversation = await this.conversationService.getConversation(task.subConversationId);
      if (existingConversation) {
        return existingConversation.id;
      }
    }

    const run = await this.teamRepo.getTeamRun(task.runId);
    if (!run) {
      throw new Error(`Team run not found: ${task.runId}`);
    }

    const mainConversation = await this.conversationService.getConversation(task.parentConversationId);
    if (!mainConversation) {
      throw new Error(`Parent conversation not found: ${task.parentConversationId}`);
    }

    if (!task.assistantBinding) {
      throw new Error(`Task missing assistant binding: ${task.id}`);
    }

    await this.teamRepo.updateTeamTask(task.id, {
      status: 'bootstrapping',
      updatedAt: Date.now(),
    });

    const createConversationParams = this.withConversationWorkspace(
      {
        ...(task.assistantBinding.createConversationParams as unknown as CreateConversationParams),
        model: (task.assistantBinding.createConversationParams.model || {}) as CreateConversationParams['model'],
        extra: (task.assistantBinding.createConversationParams.extra || {}) as CreateConversationParams['extra'],
      },
      this.getWorkspace(mainConversation)
    );
    const subConversationName = task.displayAlias || `${task.title} - ${task.assistantName || 'Assistant'}`;
    const subConversation = await this.conversationService.createConversation({
      ...createConversationParams,
      name: subConversationName,
    });

    await this.conversationService.updateConversation(
      subConversation.id,
      {
        status: 'pending',
        extra: {
          team: {
            runId: run.id,
            role: 'subagent',
            rootConversationId: run.rootConversationId,
            parentConversationId: mainConversation.id,
            taskId: task.id,
            assistantId: task.assistantId,
            assistantName: task.assistantName,
            displayAlias: task.displayAlias,
            selectionMode: task.selectionMode,
          },
        },
      },
      true
    );
    this.emitConversationListChanged(subConversation.id, 'created');
    this.emitConversationListChanged(subConversation.id, 'updated');

    await this.teamRepo.updateTeamTask(task.id, {
      subConversationId: subConversation.id,
      status: 'queued',
      updatedAt: Date.now(),
    });

    return subConversation.id;
  }

  async dispatchTask(taskId: string): Promise<void> {
    const task = await this.teamRepo.getTeamTask(taskId);
    if (!task || !task.subConversationId) {
      throw new Error(`Sub conversation has not been created for task: ${taskId}`);
    }

    const run = await this.teamRepo.getTeamRun(task.runId);
    if (!run) {
      throw new Error(`Team run not found: ${task.runId}`);
    }

    const parentConversation = await this.conversationService.getConversation(task.parentConversationId);
    const subConversation = await this.conversationService.getConversation(task.subConversationId);
    if (!parentConversation || !subConversation) {
      throw new Error(`Conversation chain is incomplete for task: ${taskId}`);
    }

    const sendPayload = this.createSendPayload(this.buildStandardizedTaskMessage(task, parentConversation));
    const turnBackend = this.resolveTurnBackend(subConversation);
    if (turnBackend) {
      await turnSnapshotCoordinator.startTurn({
        conversationId: subConversation.id,
        backend: turnBackend,
        requestMessageId: sendPayload.msg_id,
      });
    }

    try {
      const workerTask = await this.workerTaskManager.getOrBuildTask(subConversation.id);
      const result = (await workerTask.sendMessage(sendPayload as unknown)) as unknown;
      if (isFailedSendResult(result)) {
        throw new Error(result.msg || 'Failed to dispatch delegated task');
      }

      await this.teamRepo.updateTeamTask(task.id, {
        status: 'running',
        updatedAt: Date.now(),
      });
      await this.updateRunState(run.id, {
        status: 'running',
        currentPhase: 'subtask_running',
        awaitingUserInput: false,
      });
      await this.conversationService.updateConversation(subConversation.id, { status: 'running' });
      this.emitConversationListChanged(subConversation.id, 'updated');
    } catch (error) {
      if (turnBackend) {
        await turnSnapshotCoordinator.discardTurn(subConversation.id);
      }
      throw error;
    }
  }

  async handleSubConversationCompleted(subConversationId: string, event?: TeamTurnCompletionEvent): Promise<void> {
    const task = await this.teamRepo.findTeamTaskBySubConversationId(subConversationId);
    if (!task) {
      return;
    }

    const subConversation = await this.conversationService.getConversation(subConversationId);
    if (!subConversation?.extra?.team || subConversation.extra.team.role !== 'subagent') {
      return;
    }

    const latestAssistantMessage = await this.findLatestAssistantMessage(subConversationId, event?.assistantMessageId);
    const dedupeKey = this.buildTurnDedupeKey(subConversationId, latestAssistantMessage, event);
    if (this.handledSubTurnKeys.has(dedupeKey)) {
      return;
    }
    this.handledSubTurnKeys.add(dedupeKey);

    const report = await this.buildSubagentCompletionReport(subConversationId, task, event, latestAssistantMessage);
    const run = await this.teamRepo.getTeamRun(task.runId);
    if (!run) {
      return;
    }

    await this.teamRepo.updateTeamTask(task.id, {
      status: report.status,
      lastError: report.status === 'failed' ? report.summary : undefined,
      updatedAt: Date.now(),
    });
    await this.conversationService.updateConversation(subConversationId, { status: 'finished' });
    this.emitConversationListChanged(subConversationId, 'updated');

    if (report.needsUserDecision) {
      await this.updateRunState(run.id, {
        status: 'waiting_user',
        currentPhase: 'subtask_running',
        awaitingUserInput: true,
      });
      return;
    }

    await this.updateRunState(run.id, {
      status: 'running',
      currentPhase: 'continuing_main',
      awaitingUserInput: false,
    });
    await this.continueMainConversation(run.id, task.id, report);
  }

  async continueMainConversation(runId: string, taskId: string, report: SubagentCompletionReport): Promise<void> {
    const run = await this.teamRepo.getTeamRun(runId);
    if (!run) {
      throw new Error(`Team run not found: ${runId}`);
    }

    const mainConversation = await this.conversationService.getConversation(run.mainConversationId);
    if (!mainConversation) {
      throw new Error(`Main conversation not found: ${run.mainConversationId}`);
    }

    const continuationInput: InternalContinuationInput = {
      kind: 'team-subtask-report',
      runId,
      taskId,
      report,
    };
    const sendPayload = this.createSendPayload(
      this.buildInternalContinuationMessage(continuationInput),
      continuationInput
    );
    const turnBackend = this.resolveTurnBackend(mainConversation);
    if (turnBackend) {
      await turnSnapshotCoordinator.startTurn({
        conversationId: mainConversation.id,
        backend: turnBackend,
        requestMessageId: sendPayload.msg_id,
      });
    }

    try {
      const workerTask = await this.workerTaskManager.getOrBuildTask(mainConversation.id);
      const result = (await workerTask.sendMessage(sendPayload as unknown)) as unknown;
      if (isFailedSendResult(result)) {
        throw new Error(result.msg || 'Failed to send internal continuation');
      }
    } catch (error) {
      if (turnBackend) {
        await turnSnapshotCoordinator.discardTurn(mainConversation.id);
      }

      const message = error instanceof Error ? error.message : String(error);
      await this.teamRepo.updateTeamTask(taskId, {
        lastError: message,
        updatedAt: Date.now(),
      });
      await this.updateRunState(runId, {
        status: 'failed',
        currentPhase: 'failed',
        awaitingUserInput: false,
      });
      throw error;
    }
  }

  async getTeamRunView(conversationId: string): Promise<{
    run: TeamRunRecord;
    tasks: Array<TeamTaskRecord & { summary?: string; touchedFiles: string[] }>;
  } | null> {
    const mainConversationId = await this.resolveMainConversationId(conversationId);
    if (!mainConversationId) {
      return null;
    }

    await this.recoverRunState(mainConversationId);
    const run = await this.teamRepo.findTeamRunByMainConversationId(mainConversationId);
    if (!run) {
      return null;
    }

    const tasks = await this.teamRepo.listTeamTasksByRun(run.id);
    const taskViews = await Promise.all(
      tasks.map(async (task) => ({
        ...task,
        summary: task.subConversationId ? await this.extractLatestSummary(task.subConversationId) : undefined,
        touchedFiles: task.subConversationId ? await this.getTouchedFiles(task.subConversationId) : [],
      }))
    );

    return {
      run,
      tasks: taskViews,
    };
  }

  async listChildConversations(conversationId: string): Promise<
    Array<{
      taskId: string;
      parentConversationId: string;
      rootConversationId: string;
      subConversationId: string;
      title: string;
      assistantId?: string;
      assistantName?: string;
      displayAlias?: string;
      status: TeamTaskStatus;
      conversationName: string;
      conversationStatus?: TChatConversation['status'];
      updatedAt: number;
      summary?: string;
    }>
  > {
    const mainConversationId = await this.resolveMainConversationId(conversationId);
    if (!mainConversationId) {
      return [];
    }

    await this.recoverRunState(mainConversationId);
    const tasks = await this.teamRepo.listTeamTasksByParentConversationId(mainConversationId);
    const childViews = await Promise.all(
      tasks
        .filter((task) => !!task.subConversationId)
        .map(async (task) => {
          const subConversation = await this.conversationService.getConversation(task.subConversationId!);
          if (!subConversation) {
            return null;
          }

          const displayAlias = task.displayAlias || subConversation.extra.team?.displayAlias;
          return {
            taskId: task.id,
            parentConversationId: task.parentConversationId,
            rootConversationId: subConversation.extra.team?.rootConversationId || task.parentConversationId,
            subConversationId: task.subConversationId!,
            title: task.title,
            assistantId: task.assistantId,
            assistantName: task.assistantName,
            displayAlias,
            status: task.status,
            conversationName: displayAlias || subConversation.name,
            conversationStatus: subConversation.status,
            updatedAt: task.updatedAt,
            summary: await this.extractLatestSummary(task.subConversationId!),
          };
        })
    );

    return childViews.filter((item): item is NonNullable<typeof item> => !!item);
  }

  private async recoverRunState(mainConversationId: string): Promise<void> {
    const run = await this.teamRepo.findTeamRunByMainConversationId(mainConversationId);
    if (!run || this.recoveredRunIds.has(run.id)) {
      return;
    }
    this.recoveredRunIds.add(run.id);
    const updateTask = this.teamRepo.updateTeamTask?.bind(this.teamRepo);

    const tasks = await this.teamRepo.listTeamTasksByRun(run.id);
    for (const task of tasks) {
      if (task.status === 'bootstrapping') {
        if (updateTask) {
          await updateTask(task.id, {
            status: 'interrupted',
            lastError: task.lastError || 'Task bootstrapping was interrupted.',
            updatedAt: Date.now(),
          });
        }
        continue;
      }

      if (task.status === 'queued' && !task.subConversationId) {
        try {
          await this.spawnSubConversationFromBinding(task.id);
        } catch (error) {
          if (updateTask) {
            await updateTask(task.id, {
              status: 'interrupted',
              lastError: error instanceof Error ? error.message : String(error),
              updatedAt: Date.now(),
            });
          }
        }
        continue;
      }

      if (task.status === 'running') {
        const isRuntimeAlive = task.subConversationId
          ? !!this.workerTaskManager.getTask(task.subConversationId)
          : false;
        if (!isRuntimeAlive && updateTask) {
          await updateTask(task.id, {
            status: 'interrupted',
            lastError: task.lastError || 'Runtime state was lost after restart.',
            updatedAt: Date.now(),
          });
        }
      }
    }

    await this.updateRunState(run.id, {
      status: run.status,
      currentPhase: run.currentPhase,
      awaitingUserInput: run.awaitingUserInput,
    });
  }

  private async buildSubagentCompletionReport(
    subConversationId: string,
    task: TeamTaskRecord,
    event: TeamTurnCompletionEvent | undefined,
    latestAssistantMessage: TMessage | undefined
  ): Promise<SubagentCompletionReport> {
    const summary = (latestAssistantMessage ? extractTextFromMessage(latestAssistantMessage) : '').trim();
    const normalizedSummary =
      summary || (event?.completionSignal === 'error' ? 'Subtask ended with an error.' : 'Subtask completed.');
    const openQuestions = this.extractOpenQuestions(normalizedSummary);
    const pendingConfirmations = this.workerTaskManager.getTask(subConversationId)?.getConfirmations().length || 0;
    const needsUserDecision = pendingConfirmations > 0 || openQuestions.length > 0;
    const touchedFiles = await this.getTouchedFiles(subConversationId);

    return {
      status: needsUserDecision
        ? 'waiting_user'
        : event?.completionSignal === 'stop'
          ? 'interrupted'
          : event?.completionSignal === 'error'
            ? 'failed'
            : 'completed',
      summary: normalizedSummary,
      touchedFiles: touchedFiles.length > 0 ? touchedFiles : task.ownedPaths,
      needsUserDecision,
      openQuestions,
    };
  }

  private async getTouchedFiles(conversationId: string): Promise<string[]> {
    const snapshots = await turnSnapshotService.listTurnSnapshots(conversationId, 1);
    const latestSnapshot = snapshots[0];
    if (!latestSnapshot) {
      return [];
    }

    const snapshot = await turnSnapshotService.getTurnSnapshot(latestSnapshot.id);
    if (!snapshot) {
      return [];
    }

    return [...new Set(snapshot.files.map((file) => file.filePath))];
  }

  private async extractLatestSummary(conversationId: string): Promise<string | undefined> {
    const latestAssistantMessage = await this.findLatestAssistantMessage(conversationId);
    if (latestAssistantMessage) {
      const summary = extractTextFromMessage(latestAssistantMessage).trim();
      if (summary) {
        return summary;
      }
    }

    const messages = await this.conversationRepo.getMessages(conversationId, 0, 50, 'DESC');
    const latestErrorMessage = messages.data.find((message) => message.type === 'tips');
    if (latestErrorMessage?.type === 'tips') {
      return latestErrorMessage.content.content;
    }

    return undefined;
  }

  private async findLatestAssistantMessage(
    conversationId: string,
    preferredMessageId?: string
  ): Promise<TMessage | undefined> {
    const messages = await this.conversationRepo.getMessages(conversationId, 0, 100, 'DESC');
    const assistantMessages = messages.data.filter((message) => message.type === 'text' && message.position === 'left');

    if (preferredMessageId) {
      const preferred = assistantMessages.find(
        (message) => message.id === preferredMessageId || message.msg_id === preferredMessageId
      );
      if (preferred) {
        return preferred;
      }
    }

    return assistantMessages[0];
  }

  private buildTurnDedupeKey(
    conversationId: string,
    latestAssistantMessage: TMessage | undefined,
    event: TeamTurnCompletionEvent | undefined
  ): string {
    const messageId =
      event?.assistantMessageId ||
      latestAssistantMessage?.msg_id ||
      latestAssistantMessage?.id ||
      `${event?.completionSignal || 'finish'}:${event?.completionSource || 'unknown'}`;
    return `${conversationId}:${messageId}`;
  }

  private buildStandardizedTaskMessage(task: TeamTaskRecord, parentConversation: TChatConversation): string {
    const workspace = this.getWorkspace(parentConversation) || '<unknown workspace>';
    const allowedPaths =
      task.ownedPaths.length > 0
        ? task.ownedPaths.map((ownedPath) => `- ${ownedPath}`).join('\n')
        : '- (not specified)';
    const expectedOutput = task.expectedOutput || 'Code changes + summary + risks';

    return [
      '[Task Title]',
      task.title,
      '',
      '[Task Goal]',
      task.taskPrompt,
      '',
      '[Expected Output]',
      expectedOutput,
      '',
      '[Workspace]',
      workspace,
      '',
      '[Allowed Paths]',
      allowedPaths,
      '',
      '[Source Conversation]',
      parentConversation.name || parentConversation.id,
      '',
      '[Escalate To Parent When]',
      '- User decision is required',
      '- You cannot continue safely',
      '- The task goal is unclear',
    ].join('\n');
  }

  private buildInternalContinuationMessage(input: InternalContinuationInput): string {
    return [
      '[Internal Continuation]',
      'This input was generated by the process orchestrator. Treat it as hidden runtime context, not a user message.',
      '',
      '```json',
      JSON.stringify(input, null, 2),
      '```',
      '',
      'Continue the main task using this subtask report.',
    ].join('\n');
  }

  private createSendPayload(text: string, internalInput?: InternalContinuationInput) {
    return {
      input: text,
      content: text,
      agentContent: text,
      msg_id: uuid(),
      internal: !!internalInput,
      skipPersistUserMessage: !!internalInput,
      skipEmitUserMessage: !!internalInput,
      internalInput,
    };
  }

  private withConversationWorkspace(
    params: CreateConversationParams,
    workspace: string | undefined
  ): CreateConversationParams {
    return {
      ...params,
      extra: {
        ...params.extra,
        workspace,
        customWorkspace: true,
      },
    };
  }

  private resolveTurnBackend(conversation: TChatConversation): string | undefined {
    if (conversation.type === 'acp') {
      return `acp:${String(conversation.extra.backend || 'acp')}`;
    }

    if (conversation.type === 'codex') {
      return 'codex';
    }

    if (conversation.type === 'gemini') {
      return 'gemini';
    }

    return undefined;
  }

  private async getActiveTasks(runId: string): Promise<TeamTaskRecord[]> {
    const tasks = await this.teamRepo.listTeamTasksByRun(runId);
    return tasks.filter((task) => isActiveTeamTaskStatus(task.status));
  }

  private async updateRunState(
    runId: string,
    patch: Partial<Pick<TeamRunRecord, 'status' | 'currentPhase' | 'awaitingUserInput'>>
  ): Promise<void> {
    if (!this.teamRepo.updateTeamRun) {
      return;
    }
    const tasks = await this.teamRepo.listTeamTasksByRun(runId);
    const activeTaskCount = tasks.filter((task) => isActiveTeamTaskStatus(task.status)).length;
    await this.teamRepo.updateTeamRun(runId, {
      ...patch,
      activeTaskCount,
      updatedAt: Date.now(),
    });
    const run = await this.teamRepo.getTeamRun(runId);
    if (run) {
      this.emitConversationListChanged(run.mainConversationId, 'updated');
    }
  }

  private async markTaskFailed(taskId: string, runId: string, errorMessage: string): Promise<void> {
    await this.teamRepo.updateTeamTask(taskId, {
      status: 'failed',
      lastError: errorMessage,
      updatedAt: Date.now(),
    });
    await this.updateRunState(runId, {
      status: 'failed',
      currentPhase: 'failed',
      awaitingUserInput: false,
    });
  }

  private async updateConversationTeamMeta(
    conversationId: string,
    teamMeta: NonNullable<TChatConversation['extra']['team']>
  ): Promise<void> {
    await this.conversationService.updateConversation(
      conversationId,
      {
        extra: {
          team: teamMeta,
        },
      },
      true
    );
    this.emitConversationListChanged(conversationId, 'updated');
  }

  private emitConversationListChanged(conversationId: string, action: 'created' | 'updated' | 'deleted'): void {
    ipcBridge.conversation.listChanged.emit({
      conversationId,
      action,
      source: 'aionui',
    });
  }

  private getWorkspace(conversation: TChatConversation): string | undefined {
    const extra = conversation.extra as { workspace?: string };
    return extra.workspace;
  }

  private async resolveMainConversationId(conversationId: string): Promise<string | null> {
    const conversation = await this.conversationService.getConversation(conversationId);
    if (!conversation) {
      return null;
    }

    if (conversation.extra?.team?.role === 'subagent') {
      return conversation.extra.team.parentConversationId || null;
    }

    return conversation.id;
  }

  private extractOpenQuestions(summary: string): string[] {
    const lines = summary
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const questions = lines.filter((line) => line.endsWith('?') || line.includes('need user'));
    return [...new Set(questions)].slice(0, 5);
  }

  private stripMentionToken(input: string): string {
    return input.replace(/^\s*@[^\s@]+\s*/, '').trim();
  }

  private async persistUserDelegationMessage(conversationId: string, msgId: string, input: string): Promise<void> {
    const message: TMessage = {
      id: msgId,
      msg_id: msgId,
      conversation_id: conversationId,
      type: 'text',
      position: 'right',
      content: { content: input },
      createdAt: Date.now(),
      status: 'finish',
    };
    await this.conversationRepo.insertMessage(message);
  }

  private async assertTaskOwnedByConversation(conversationId: string, taskId: string): Promise<TeamTaskRecord> {
    const mainConversationId = await this.resolveMainConversationId(conversationId);
    if (!mainConversationId) {
      throw new Error('Conversation not found');
    }

    const task = await this.teamRepo.getTeamTask(taskId);
    if (!task || task.parentConversationId !== mainConversationId) {
      throw new Error('Task not found in current conversation');
    }
    return task;
  }
}
