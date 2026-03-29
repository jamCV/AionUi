/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// src/process/database/IConversationRepository.ts
// All methods are synchronous (better-sqlite3 driver).
// The service layer is async to allow future migration.

import type { TChatConversation } from '@/common/config/storage';
import type { TMessage } from '@/common/chat/chatLib';
import type { IMessageSearchResponse } from '@/common/types/database';
import type {
  CreateTurnSnapshotInput,
  CreateTurnSnapshotFileInput,
  TurnReviewStatus,
  TurnSnapshot,
  TurnSnapshotFile,
  TurnSnapshotSummary,
  UpdateTurnSnapshotInput,
} from './types';

export type PaginatedResult<T> = {
  data: T[];
  total: number;
  hasMore: boolean;
};

export interface IConversationRepository {
  getConversation(id: string): Promise<TChatConversation | undefined>;
  createConversation(conversation: TChatConversation): Promise<void>;
  updateConversation(id: string, updates: Partial<TChatConversation>): Promise<void>;
  deleteConversation(id: string): Promise<void>;
  getMessages(id: string, page: number, pageSize: number, order?: 'ASC' | 'DESC'): Promise<PaginatedResult<TMessage>>;
  insertMessage(message: TMessage): Promise<void>;
  /**
   * If cursor is provided, offset is ignored.
   * If neither is provided, returns from the beginning.
   */
  getUserConversations(cursor?: string, offset?: number, limit?: number): Promise<PaginatedResult<TChatConversation>>;
  /** Returns all conversations without pagination. */
  listAllConversations(): Promise<TChatConversation[]>;
  /** Full-text search across conversation messages. */
  searchMessages(keyword: string, page: number, pageSize: number): Promise<IMessageSearchResponse>;
  createTurnSnapshot(input: CreateTurnSnapshotInput): Promise<void>;
  upsertTurnSnapshotFile(input: CreateTurnSnapshotFileInput): Promise<void>;
  getTurnSnapshot(turnId: string): Promise<TurnSnapshot | undefined>;
  getTurnSnapshotsByConversation(conversationId: string, limit?: number): Promise<TurnSnapshotSummary[]>;
  updateTurnSnapshot(input: UpdateTurnSnapshotInput): Promise<void>;
  updateTurnReviewStatus(turnId: string, status: TurnReviewStatus): Promise<void>;
  getTurnSnapshotFiles(turnId: string): Promise<TurnSnapshotFile[]>;
  deleteTurnSnapshot(turnId: string): Promise<void>;
}
