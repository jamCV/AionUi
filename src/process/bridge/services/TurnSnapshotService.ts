/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { TChatConversation } from '@/common/config/storage';
import type {
  TurnSnapshot,
  TurnSnapshotConflict,
  TurnSnapshotKeepResult,
  TurnSnapshotRevertResult,
  TurnSnapshotSummary,
} from '@/common/types/turnSnapshot';
import type { IConversationRepository } from '@process/services/database/IConversationRepository';
import { SqliteConversationRepository } from '@process/services/database/SqliteConversationRepository';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

type WorkspaceFileState = {
  absolutePath: string;
  relativePath: string;
  exists: boolean;
  content?: string;
  hash?: string;
};

type RollbackFileState = {
  absolutePath: string;
  relativePath: string;
  exists: boolean;
  content?: string;
};

type TurnSnapshotServiceDeps = {
  readFile: (filePath: string) => Promise<string>;
  writeFile: (filePath: string, content: string) => Promise<void>;
  removeFile: (filePath: string) => Promise<void>;
  ensureDir: (dirPath: string) => Promise<void>;
};

const defaultDeps: TurnSnapshotServiceDeps = {
  readFile: (filePath) => fs.readFile(filePath, 'utf8'),
  writeFile: (filePath, content) => fs.writeFile(filePath, content, 'utf8'),
  removeFile: (filePath) => fs.rm(filePath, { force: true }),
  ensureDir: async (dirPath) => {
    await fs.mkdir(dirPath, { recursive: true });
  },
};

const hashContent = (content: string): string => createHash('sha1').update(content).digest('hex');

const getConversationWorkspace = (conversation: TChatConversation): string | undefined => {
  if ('extra' in conversation && conversation.extra && 'workspace' in conversation.extra) {
    return conversation.extra.workspace;
  }
  return undefined;
};

const resolveWorkspacePath = (workspace: string, filePath: string): string =>
  path.isAbsolute(filePath) ? filePath : path.join(workspace, filePath);

const toRelativePath = (workspace: string, filePath: string): string => {
  if (!path.isAbsolute(filePath)) {
    return filePath;
  }

  const relativePath = path.relative(workspace, filePath);
  return relativePath && !relativePath.startsWith('..') ? relativePath : filePath;
};

export class TurnSnapshotService {
  constructor(
    private readonly repo: IConversationRepository = new SqliteConversationRepository(),
    private readonly deps: TurnSnapshotServiceDeps = defaultDeps
  ) {}

  async listTurnSnapshots(conversationId: string, limit = 50): Promise<TurnSnapshotSummary[]> {
    return this.repo.getTurnSnapshotsByConversation(conversationId, limit);
  }

  async getTurnSnapshot(turnId: string): Promise<TurnSnapshot | undefined> {
    return this.repo.getTurnSnapshot(turnId);
  }

  async keepTurn(turnId: string): Promise<TurnSnapshotKeepResult> {
    const snapshot = await this.repo.getTurnSnapshot(turnId);
    if (!snapshot) {
      return {
        success: false,
        turnId,
        msg: 'Turn snapshot not found.',
      };
    }

    if (snapshot.reviewStatus === 'reverted') {
      return {
        success: false,
        turnId,
        reviewStatus: snapshot.reviewStatus,
        snapshot,
        msg: 'Turn snapshot has already been reverted.',
      };
    }

    if (snapshot.reviewStatus !== 'kept') {
      await this.repo.updateTurnReviewStatus(turnId, 'kept');
    }

    const updatedSnapshot = (await this.repo.getTurnSnapshot(turnId)) ?? snapshot;
    return {
      success: true,
      turnId,
      reviewStatus: updatedSnapshot.reviewStatus,
      snapshot: updatedSnapshot,
    };
  }

  async revertTurn(turnId: string): Promise<TurnSnapshotRevertResult> {
    const snapshot = await this.repo.getTurnSnapshot(turnId);
    if (!snapshot) {
      return {
        success: false,
        turnId,
        status: 'failed',
        msg: 'Turn snapshot not found.',
      };
    }

    if (snapshot.reviewStatus === 'reverted') {
      return {
        success: true,
        turnId,
        status: 'reverted',
        reviewStatus: snapshot.reviewStatus,
        snapshot,
      };
    }

    if (snapshot.files.some((file) => !file.revertSupported)) {
      if (snapshot.reviewStatus !== 'unsupported') {
        await this.repo.updateTurnReviewStatus(turnId, 'unsupported');
      }
      const updatedSnapshot = (await this.repo.getTurnSnapshot(turnId)) ?? snapshot;
      return {
        success: false,
        turnId,
        status: 'unsupported',
        reviewStatus: updatedSnapshot.reviewStatus,
        snapshot: updatedSnapshot,
        msg: 'Turn snapshot contains files that cannot be reverted safely.',
      };
    }

    const conversation = await this.repo.getConversation(snapshot.conversationId);
    if (!conversation) {
      return {
        success: false,
        turnId,
        status: 'failed',
        reviewStatus: snapshot.reviewStatus,
        snapshot,
        msg: 'Conversation not found for turn snapshot.',
      };
    }

    const workspace = getConversationWorkspace(conversation);
    if (!workspace) {
      return {
        success: false,
        turnId,
        status: 'failed',
        reviewStatus: snapshot.reviewStatus,
        snapshot,
        msg: 'Conversation workspace is not available for revert.',
      };
    }

    const currentStates = await Promise.all(
      snapshot.files.map((file) => this.readWorkspaceState(workspace, file.filePath))
    );
    const conflicts = snapshot.files.flatMap((file, index) => {
      const currentState = currentStates[index];
      if (!currentState) {
        return [];
      }

      if (currentState.exists !== file.afterExists) {
        return [
          {
            filePath: file.filePath,
            expectedExists: file.afterExists,
            actualExists: currentState.exists,
            expectedHash: file.afterHash,
            actualHash: currentState.hash,
          } satisfies TurnSnapshotConflict,
        ];
      }

      if (file.afterExists && currentState.hash !== file.afterHash) {
        return [
          {
            filePath: file.filePath,
            expectedExists: file.afterExists,
            actualExists: currentState.exists,
            expectedHash: file.afterHash,
            actualHash: currentState.hash,
          } satisfies TurnSnapshotConflict,
        ];
      }

      return [];
    });

    if (conflicts.length > 0) {
      await this.repo.updateTurnReviewStatus(turnId, 'conflict');
      const updatedSnapshot = (await this.repo.getTurnSnapshot(turnId)) ?? snapshot;
      return {
        success: false,
        turnId,
        status: 'conflict',
        reviewStatus: updatedSnapshot.reviewStatus,
        snapshot: updatedSnapshot,
        conflicts,
        msg: 'Workspace has changed since this turn completed.',
      };
    }

    const rollbackStates: RollbackFileState[] = currentStates.map((state) => ({
      absolutePath: state.absolutePath,
      relativePath: state.relativePath,
      exists: state.exists,
      content: state.content,
    }));

    try {
      await snapshot.files.reduce<Promise<void>>(
        (previous, file) =>
          previous.then(() =>
            this.restoreSnapshotFile(workspace, file.filePath, file.beforeExists, file.beforeContent)
          ),
        Promise.resolve()
      );

      await this.repo.updateTurnReviewStatus(turnId, 'reverted');
      const updatedSnapshot = (await this.repo.getTurnSnapshot(turnId)) ?? snapshot;

      return {
        success: true,
        turnId,
        status: 'reverted',
        reviewStatus: updatedSnapshot.reviewStatus,
        snapshot: updatedSnapshot,
      };
    } catch (error) {
      const rollbackError = await this.rollbackFiles(workspace, rollbackStates);
      await this.repo.updateTurnReviewStatus(turnId, 'failed');
      const updatedSnapshot = (await this.repo.getTurnSnapshot(turnId)) ?? snapshot;
      const msg = error instanceof Error ? error.message : String(error);

      return {
        success: false,
        turnId,
        status: 'failed',
        reviewStatus: updatedSnapshot.reviewStatus,
        snapshot: updatedSnapshot,
        msg: rollbackError ? `${msg} Rollback failed: ${rollbackError}` : msg,
      };
    }
  }

  private async rollbackFiles(workspace: string, rollbackStates: RollbackFileState[]): Promise<string | undefined> {
    try {
      await rollbackStates.reduce<Promise<void>>((previous, state) => {
        return previous.then(async () => {
          if (!state.exists) {
            await this.deps.removeFile(state.absolutePath);
            this.emitFileStreamUpdate(workspace, state.absolutePath, state.relativePath, '', 'delete');
            return;
          }

          await this.deps.ensureDir(path.dirname(state.absolutePath));
          await this.deps.writeFile(state.absolutePath, state.content ?? '');
          this.emitFileStreamUpdate(workspace, state.absolutePath, state.relativePath, state.content ?? '', 'write');
        });
      }, Promise.resolve());
      return undefined;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }

  private async restoreSnapshotFile(
    workspace: string,
    filePath: string,
    beforeExists: boolean,
    beforeContent?: string
  ): Promise<void> {
    const absolutePath = resolveWorkspacePath(workspace, filePath);
    const relativePath = toRelativePath(workspace, filePath);

    if (!beforeExists) {
      await this.deps.removeFile(absolutePath);
      this.emitFileStreamUpdate(workspace, absolutePath, relativePath, '', 'delete');
      return;
    }

    await this.deps.ensureDir(path.dirname(absolutePath));
    await this.deps.writeFile(absolutePath, beforeContent ?? '');
    this.emitFileStreamUpdate(workspace, absolutePath, relativePath, beforeContent ?? '', 'write');
  }

  private emitFileStreamUpdate(
    workspace: string,
    filePath: string,
    relativePath: string,
    content: string,
    operation: 'write' | 'delete'
  ): void {
    ipcBridge.fileStream.contentUpdate.emit({
      filePath,
      content,
      workspace,
      relativePath,
      operation,
    });
  }

  private async readWorkspaceState(workspace: string, filePath: string): Promise<WorkspaceFileState> {
    const absolutePath = resolveWorkspacePath(workspace, filePath);
    const relativePath = toRelativePath(workspace, filePath);

    try {
      const content = await this.deps.readFile(absolutePath);
      return {
        absolutePath,
        relativePath,
        exists: true,
        content,
        hash: hashContent(content),
      };
    } catch (error) {
      const errorCode = (error as NodeJS.ErrnoException).code;
      if (errorCode === 'ENOENT') {
        return {
          absolutePath,
          relativePath,
          exists: false,
        };
      }
      throw error;
    }
  }
}

export const turnSnapshotService = new TurnSnapshotService();
