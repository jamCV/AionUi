/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IMessageAcpToolCall, IMessageCodexToolCall, TMessage } from '@/common/chat/chatLib';
import type { TChatConversation } from '@/common/config/storage';
import type { ToolCallContentItem } from '@/common/types/acpTypes';
import type { TurnFileAction, TurnReviewStatus } from '@/common/types/turnSnapshot';
import { uuid } from '@/common/utils';
import type { IConversationRepository } from '@process/services/database/IConversationRepository';
import { SqliteConversationRepository } from '@process/services/database/SqliteConversationRepository';
import type { CreateTurnSnapshotFileInput, CreateTurnSnapshotInput } from '@process/services/database/types';
import { drainConversationMessageWrites } from '@process/utils/message';
import { applyPatch, createTwoFilesPatch, formatPatch, parsePatch, reversePatch } from 'diff';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const DEV_NULL_PATH = '/dev/null';
const TURN_MESSAGE_SCAN_LIMIT = 2000;
type ParsedUnifiedDiff = ReturnType<typeof parsePatch>[number];

type ActiveTurn = {
  id: string;
  conversationId: string;
  backend: string;
  requestMessageId?: string;
  startedAt: number;
  completing: boolean;
};

type StartTurnInput = {
  conversationId: string;
  backend: string;
  requestMessageId?: string;
  startedAt?: number;
};

type CompleteTurnInput = {
  conversationId: string;
  completionSignal: string;
  completionSource?: string;
};

type WorkspaceFileState = {
  exists: boolean;
  content?: string;
  hash?: string;
};

type ExtractedTurnFile = Omit<CreateTurnSnapshotFileInput, 'id' | 'turnId' | 'conversationId' | 'fileName'> & {
  filePath: string;
};

type TurnSnapshotCoordinatorDeps = {
  now: () => number;
  createId: () => string;
  readWorkspaceFile: (filePath: string) => Promise<string>;
  drainWrites: (conversationId: string) => Promise<void>;
};

const defaultDeps: TurnSnapshotCoordinatorDeps = {
  now: () => Date.now(),
  createId: () => uuid(),
  readWorkspaceFile: (filePath) => fs.readFile(filePath, 'utf8'),
  drainWrites: (conversationId) => drainConversationMessageWrites(conversationId),
};

const isDevNullPath = (filePath?: string | null): boolean => !filePath || filePath === DEV_NULL_PATH;

const normalizePatchPath = (filePath?: string | null): string | undefined => {
  if (isDevNullPath(filePath)) {
    return undefined;
  }

  return filePath.replace(/^[ab]\//, '');
};

const resolveWorkspacePath = (workspace: string, filePath: string): string =>
  path.isAbsolute(filePath) ? filePath : path.join(workspace, filePath);

const hashContent = (content: string): string => createHash('sha1').update(content).digest('hex');

const extractSourceMessageId = (message: TMessage): string => message.id || message.msg_id || uuid();

const isAcpToolCallMessage = (message: TMessage): message is IMessageAcpToolCall => message.type === 'acp_tool_call';

const isCodexTurnDiffMessage = (message: TMessage): message is IMessageCodexToolCall =>
  message.type === 'codex_tool_call' && message.content.subtype === 'turn_diff';

const getConversationWorkspace = (conversation: TChatConversation): string | undefined => {
  if ('extra' in conversation && conversation.extra && 'workspace' in conversation.extra) {
    return conversation.extra.workspace;
  }
  return undefined;
};

const hasOwn = <Key extends string>(value: unknown, key: Key): value is Record<Key, unknown> =>
  !!value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, key);

const parseDiffSide = (item: ToolCallContentItem, key: 'oldText' | 'newText'): string | null | undefined => {
  if (!hasOwn(item, key)) {
    return undefined;
  }

  const value = item[key];
  return typeof value === 'string' || value === null ? value : undefined;
};

const parseCompletionSource = (data: unknown): string | undefined => {
  if (!data || typeof data !== 'object') {
    return undefined;
  }

  const completionSource = (data as { completionSource?: unknown }).completionSource;
  return typeof completionSource === 'string' ? completionSource : undefined;
};

const createUnifiedDiff = (
  filePath: string,
  beforeExists: boolean,
  afterExists: boolean,
  beforeContent: string,
  afterContent: string
): string =>
  createTwoFilesPatch(
    beforeExists ? filePath : DEV_NULL_PATH,
    afterExists ? filePath : DEV_NULL_PATH,
    beforeContent,
    afterContent,
    '',
    '',
    { context: 3 }
  );

export class TurnSnapshotCoordinator {
  private readonly activeTurns = new Map<string, ActiveTurn>();

  constructor(
    private readonly repo: IConversationRepository = new SqliteConversationRepository(),
    private readonly deps: TurnSnapshotCoordinatorDeps = defaultDeps
  ) {}

  async startTurn(input: StartTurnInput): Promise<string> {
    const activeTurn: ActiveTurn = {
      id: this.deps.createId(),
      conversationId: input.conversationId,
      backend: input.backend,
      requestMessageId: input.requestMessageId,
      startedAt: input.startedAt ?? this.deps.now(),
      completing: false,
    };

    this.activeTurns.set(input.conversationId, activeTurn);
    return activeTurn.id;
  }

  discardTurn(conversationId: string): void {
    this.activeTurns.delete(conversationId);
  }

  async completeTurn(input: CompleteTurnInput): Promise<void> {
    const activeTurn = this.activeTurns.get(input.conversationId);
    if (!activeTurn || activeTurn.completing) {
      return;
    }

    activeTurn.completing = true;

    try {
      await this.deps.drainWrites(input.conversationId);

      const snapshotInput = await this.buildTurnSnapshot(activeTurn, input);
      if (snapshotInput) {
        await this.repo.createTurnSnapshot(snapshotInput);
      }
    } catch (error) {
      console.error('[TurnSnapshotCoordinator] Failed to complete turn snapshot:', error);
    } finally {
      const currentTurn = this.activeTurns.get(input.conversationId);
      if (currentTurn?.id === activeTurn.id) {
        this.activeTurns.delete(input.conversationId);
      }
    }
  }

  private async buildTurnSnapshot(
    activeTurn: ActiveTurn,
    completion: CompleteTurnInput
  ): Promise<CreateTurnSnapshotInput | undefined> {
    const conversation = await this.repo.getConversation(activeTurn.conversationId);
    if (!conversation) {
      return undefined;
    }

    const workspace = getConversationWorkspace(conversation);
    if (!workspace) {
      return undefined;
    }

    const messagesResult = await this.repo.getMessages(activeTurn.conversationId, 0, TURN_MESSAGE_SCAN_LIMIT, 'ASC');
    const turnMessages = messagesResult.data.filter(
      (message) => Number(message.createdAt || 0) >= activeTurn.startedAt
    );

    const extractedFiles = await this.extractTurnFiles(turnMessages, workspace);
    if (extractedFiles.length === 0) {
      return undefined;
    }

    const createdAt = this.deps.now();
    const reviewStatus: TurnReviewStatus = extractedFiles.every((file) => file.revertSupported)
      ? 'pending'
      : 'unsupported';
    const sourceMessageIds = [...new Set(extractedFiles.flatMap((file) => file.sourceMessageIds))];

    return {
      id: activeTurn.id,
      conversationId: activeTurn.conversationId,
      backend: activeTurn.backend,
      requestMessageId: activeTurn.requestMessageId,
      startedAt: activeTurn.startedAt,
      completedAt: createdAt,
      completionSignal: completion.completionSignal,
      completionSource: completion.completionSource,
      reviewStatus,
      sourceMessageIds,
      createdAt,
      updatedAt: createdAt,
      files: extractedFiles.map((file) => ({
        id: this.deps.createId(),
        turnId: activeTurn.id,
        conversationId: activeTurn.conversationId,
        filePath: file.filePath,
        fileName: path.basename(file.filePath),
        action: file.action,
        beforeExists: file.beforeExists,
        afterExists: file.afterExists,
        beforeHash: file.beforeHash,
        afterHash: file.afterHash,
        beforeContent: file.beforeContent,
        afterContent: file.afterContent,
        unifiedDiff: file.unifiedDiff,
        sourceMessageIds: file.sourceMessageIds,
        revertSupported: file.revertSupported,
        revertError: file.revertError,
        createdAt,
        updatedAt: createdAt,
      })),
    };
  }

  private async extractTurnFiles(messages: TMessage[], workspace: string): Promise<ExtractedTurnFile[]> {
    const extractedFiles: ExtractedTurnFile[] = [];

    for (const message of messages) {
      if (isAcpToolCallMessage(message)) {
        extractedFiles.push(...(await this.extractAcpTurnFiles(message, workspace)));
      }

      if (isCodexTurnDiffMessage(message)) {
        extractedFiles.push(...(await this.extractCodexTurnFiles(message, workspace)));
      }
    }

    return extractedFiles;
  }

  private async extractAcpTurnFiles(message: IMessageAcpToolCall, workspace: string): Promise<ExtractedTurnFile[]> {
    const diffItemsByPath = new Map<
      string,
      {
        firstRawDiff?: ToolCallContentItem & { type: 'diff'; path: string };
        lastRawDiff?: ToolCallContentItem & { type: 'diff'; path: string };
        sourceMessageIds: Set<string>;
      }
    >();
    const rawDiffItems = (message.content.update.content ?? []).filter(
      (item): item is ToolCallContentItem & { type: 'diff'; path: string } => item.type === 'diff' && !!item.path
    );
    const sourceMessageId = extractSourceMessageId(message);

    for (const rawDiffItem of rawDiffItems) {
      const currentEntry = diffItemsByPath.get(rawDiffItem.path) ?? { sourceMessageIds: new Set<string>() };
      diffItemsByPath.set(rawDiffItem.path, {
        ...currentEntry,
        firstRawDiff: currentEntry.firstRawDiff ?? rawDiffItem,
        lastRawDiff: rawDiffItem,
        sourceMessageIds: currentEntry.sourceMessageIds.add(sourceMessageId),
      });
    }

    const extractedFiles: ExtractedTurnFile[] = [];

    for (const [filePath, entry] of diffItemsByPath.entries()) {
      const firstOldText = entry.firstRawDiff ? parseDiffSide(entry.firstRawDiff, 'oldText') : undefined;
      const lastNewText = entry.lastRawDiff ? parseDiffSide(entry.lastRawDiff, 'newText') : undefined;
      const beforeExists = entry.firstRawDiff !== undefined && firstOldText !== null && firstOldText !== undefined;
      const afterExists = entry.lastRawDiff !== undefined && lastNewText !== null && lastNewText !== undefined;
      const beforeContent = beforeExists ? (firstOldText ?? undefined) : undefined;
      const workspaceState = await this.readWorkspaceState(workspace, filePath);
      const afterContent = afterExists
        ? workspaceState.exists
          ? workspaceState.content
          : (lastNewText ?? undefined)
        : undefined;
      const action: TurnFileAction = beforeExists ? (afterExists ? 'update' : 'delete') : 'create';
      const revertSupported =
        (!beforeExists || beforeContent !== undefined) && (!afterExists || afterContent !== undefined);

      extractedFiles.push({
        filePath,
        action,
        beforeExists,
        afterExists,
        beforeHash: beforeContent !== undefined ? hashContent(beforeContent) : undefined,
        afterHash: afterContent !== undefined ? hashContent(afterContent) : undefined,
        beforeContent,
        afterContent,
        unifiedDiff: createUnifiedDiff(filePath, beforeExists, afterExists, beforeContent ?? '', afterContent ?? ''),
        sourceMessageIds: [...entry.sourceMessageIds],
        revertSupported,
        revertError: revertSupported ? undefined : 'ACP diff payload is incomplete for snapshot reconstruction.',
      });
    }

    return extractedFiles;
  }

  private async extractCodexTurnFiles(message: IMessageCodexToolCall, workspace: string): Promise<ExtractedTurnFile[]> {
    const unifiedDiff = message.content.data?.unified_diff;
    if (typeof unifiedDiff !== 'string' || !unifiedDiff.trim()) {
      return [];
    }

    const sourceMessageId = extractSourceMessageId(message);
    const patches = parsePatch(unifiedDiff);

    return Promise.all(
      patches.map(async (patch: ParsedUnifiedDiff) => {
        const filePath = normalizePatchPath(patch.newFileName) ?? normalizePatchPath(patch.oldFileName);
        if (!filePath) {
          return undefined;
        }

        const beforeExists = !isDevNullPath(patch.oldFileName);
        const afterExists = !isDevNullPath(patch.newFileName);
        const workspaceState = await this.readWorkspaceState(workspace, filePath);
        const afterContent = afterExists ? workspaceState.content : undefined;
        const reversedPatch = reversePatch(patch);
        const revertedContent = applyPatch(afterContent ?? '', reversedPatch);
        const beforeContent =
          typeof revertedContent === 'string' ? revertedContent : beforeExists ? undefined : undefined;
        const revertSupported = !beforeExists || typeof revertedContent === 'string';
        const action: TurnFileAction = beforeExists ? (afterExists ? 'update' : 'delete') : 'create';

        return {
          filePath,
          action,
          beforeExists,
          afterExists,
          beforeHash: beforeContent !== undefined ? hashContent(beforeContent) : undefined,
          afterHash: afterContent !== undefined ? hashContent(afterContent) : undefined,
          beforeContent,
          afterContent,
          unifiedDiff: formatPatch(patch),
          sourceMessageIds: [sourceMessageId],
          revertSupported,
          revertError: revertSupported ? undefined : 'Failed to reverse codex turn diff patch.',
        } satisfies ExtractedTurnFile;
      })
    ).then((files) => files.filter((file): file is ExtractedTurnFile => !!file));
  }

  private async readWorkspaceState(workspace: string, filePath: string): Promise<WorkspaceFileState> {
    const resolvedFilePath = resolveWorkspacePath(workspace, filePath);

    try {
      const content = await this.deps.readWorkspaceFile(resolvedFilePath);
      return {
        exists: true,
        content,
        hash: hashContent(content),
      };
    } catch (error) {
      const errorCode = (error as NodeJS.ErrnoException).code;
      if (errorCode === 'ENOENT') {
        return {
          exists: false,
        };
      }

      throw error;
    }
  }
}

export const turnSnapshotCoordinator = new TurnSnapshotCoordinator();
export { parseCompletionSource };
