/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
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
import type {
  TeamRunRecord,
  TeamTaskRecord,
  TeamTaskStatus,
  TeamCommand,
  SubagentCompletionReport,
  InternalContinuationInput,
} from './teamTypes';
import { TeamCommandDetector } from './TeamCommandDetector';
import type { TeamAssistantSelection } from './AssistantCatalogService';
import { AssistantCatalogService } from './AssistantCatalogService';
import type { TeamTurnCompletionEvent } from './teamRuntimeHooks';

type DelegateTeamCommand = Extract<TeamCommand, { action: 'delegate' }>;

type CreateDelegatedTaskInput = {
  run: TeamRunRecord;
  mainConversation: TChatConversation;
  command: DelegateTeamCommand;
  selection: TeamAssistantSelection;
};

const MAIN_ACTIVE_TASK_STATUSES: TeamTaskStatus[] = ['queued', 'running', 'waiting_user'];

const isFailedSendResult = (result: unknown): result is { success: false; msg?: string } =>
  !!result && typeof result === 'object' && 'success' in result && result.success === false;

export class TeamOrchestratorService {
  private readonly handledMainTurnKeys = new Set<string>();
  private readonly handledSubTurnKeys = new Set<string>();
  private readonly pendingSelections = new Map<string, TeamAssistantSelection>();

  constructor(
    private readonly teamRepo: ITeamRepository,
    private readonly conversationRepo: IConversationRepository,
    private readonly conversationService: IConversationService,
    private readonly workerTaskManager: IWorkerTaskManager,
    private readonly commandDetector: TeamCommandDetector = new TeamCommandDetector(),
    private readonly assistantCatalogService: AssistantCatalogService = new AssistantCatalogService()
  ) {}

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
    const command = this.commandDetector.parse(latestAssistantText);
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
      console.warn('[SubagentTeam] Ignoring delegate command because an active subtask already exists.', {
        mainConversationId,
        runId: run.id,
      });
      return;
    }

    const selection = await this.assistantCatalogService.selectAssistant(mainConversation, command);
    const task = await this.createDelegatedTask({
      run,
      mainConversation,
      command,
      selection,
    });

    try {
      await this.spawnSubConversation(task.id);
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
      ownedPaths: input.command.ownedPaths ?? [],
    } satisfies CreateTeamTaskInput);

    this.pendingSelections.set(task.id, input.selection);
    await this.updateRunState(input.run.id, {
      status: 'running',
      currentPhase: 'delegating',
      awaitingUserInput: false,
    });
    return task;
  }

  async spawnSubConversation(taskId: string): Promise<string> {
    const task = await this.teamRepo.getTeamTask(taskId);
    if (!task) {
      throw new Error(`Team task not found: ${taskId}`);
    }

    const run = await this.teamRepo.getTeamRun(task.runId);
    if (!run) {
      throw new Error(`Team run not found: ${task.runId}`);
    }

    const mainConversation = await this.conversationService.getConversation(task.parentConversationId);
    if (!mainConversation) {
      throw new Error(`Parent conversation not found: ${task.parentConversationId}`);
    }

    const selection = this.pendingSelections.get(taskId);
    if (!selection) {
      throw new Error(`Assistant selection missing for task: ${taskId}`);
    }

    const createConversationParams = this.withConversationWorkspace(
      selection.createConversationParams,
      this.getWorkspace(mainConversation)
    );
    const subConversation = await this.conversationService.createConversation({
      ...createConversationParams,
      name: `${task.title} - ${selection.assistantName}`,
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
            assistantId: selection.assistantId,
            assistantName: selection.assistantName,
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
      updatedAt: Date.now(),
    });
    this.pendingSelections.delete(task.id);

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

    const tasks = await this.teamRepo.listTeamTasksByParentConversationId(mainConversationId);
    const childViews = await Promise.all(
      tasks
        .filter((task) => !!task.subConversationId)
        .map(async (task) => {
          const subConversation = await this.conversationService.getConversation(task.subConversationId!);
          if (!subConversation) {
            return null;
          }

          return {
            taskId: task.id,
            parentConversationId: task.parentConversationId,
            rootConversationId: subConversation.extra.team?.rootConversationId || task.parentConversationId,
            subConversationId: task.subConversationId!,
            title: task.title,
            assistantId: task.assistantId,
            assistantName: task.assistantName,
            status: task.status,
            conversationName: subConversation.name,
            conversationStatus: subConversation.status,
            updatedAt: task.updatedAt,
            summary: await this.extractLatestSummary(task.subConversationId!),
          };
        })
    );

    return childViews.filter((item): item is NonNullable<typeof item> => !!item);
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
        : event?.completionSignal === 'error' || event?.completionSignal === 'stop'
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

    if (conversation.type === 'openclaw-gateway') {
      return 'openclaw-gateway';
    }

    if (conversation.type === 'nanobot') {
      return 'nanobot';
    }

    if (conversation.type === 'remote') {
      return 'remote';
    }

    return undefined;
  }

  private async getActiveTasks(runId: string): Promise<TeamTaskRecord[]> {
    const tasks = await this.teamRepo.listTeamTasksByRun(runId);
    return tasks.filter((task) => MAIN_ACTIVE_TASK_STATUSES.includes(task.status));
  }

  private async updateRunState(
    runId: string,
    patch: Partial<Pick<TeamRunRecord, 'status' | 'currentPhase' | 'awaitingUserInput'>>
  ): Promise<void> {
    const tasks = await this.teamRepo.listTeamTasksByRun(runId);
    const activeTaskCount = tasks.filter((task) => MAIN_ACTIVE_TASK_STATUSES.includes(task.status)).length;
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
}
