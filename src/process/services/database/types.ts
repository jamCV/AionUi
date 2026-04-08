/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TMessage } from '@/common/chat/chatLib';
import type { ConversationSource, IConfigStorageRefer, TChatConversation } from '@/common/config/storage';
import type {
  TurnFileAction,
  TurnReviewStatus,
  TurnSnapshot,
  TurnSnapshotFile,
  TurnSnapshotSummary,
} from '@/common/types/turnSnapshot';

/**
 * ======================
 * Database-only types
 * ======================
 */

export interface IUser {
  id: string;
  username: string;
  email?: string;
  password_hash: string;
  avatar_path?: string;
  jwt_secret?: string | null;
  created_at: number;
  updated_at: number;
  last_login?: number | null;
}

/**
 * ======================
 * Query helpers
 * ======================
 */

export interface IQueryResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface IPaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

/**
 * ======================
 * Database row types
 * ======================
 */

export interface IConversationRow {
  id: string;
  user_id: string;
  name: string;
  type: string;
  extra: string;
  model?: string;
  status?: 'pending' | 'running' | 'finished';
  source?: ConversationSource;
  channel_chat_id?: string;
  created_at: number;
  updated_at: number;
}

export interface IMessageRow {
  id: string;
  conversation_id: string;
  msg_id?: string;
  type: string;
  content: string;
  position?: 'left' | 'right' | 'center' | 'pop';
  status?: 'finish' | 'pending' | 'error' | 'work';
  hidden?: number;
  created_at: number;
}

export interface IConfigRow {
  key: string;
  value: string;
  updated_at: number;
}

export type TurnSnapshotRow = {
  id: string;
  conversation_id: string;
  backend: string;
  request_msg_id: string | null;
  started_at: number;
  completed_at: number;
  completion_signal: string;
  completion_source: string | null;
  review_status: TurnReviewStatus;
  file_count: number;
  source_message_ids: string;
  created_at: number;
  updated_at: number;
};

export type TurnSnapshotFileRow = {
  id: string;
  turn_id: string;
  conversation_id: string;
  file_path: string;
  file_name: string;
  action: TurnFileAction;
  before_exists: number;
  after_exists: number;
  before_hash: string | null;
  after_hash: string | null;
  before_content: string | null;
  after_content: string | null;
  unified_diff: string;
  source_message_ids: string;
  revert_supported: number;
  revert_error: string | null;
  created_at: number;
  updated_at: number;
};

/**
 * ======================
 * Conversion helpers
 * ======================
 */

export function conversationToRow(conversation: TChatConversation, userId: string): IConversationRow {
  return {
    id: conversation.id,
    user_id: userId,
    name: conversation.name,
    type: conversation.type,
    extra: JSON.stringify(conversation.extra),
    model: 'model' in conversation ? JSON.stringify(conversation.model) : undefined,
    status: conversation.status,
    source: conversation.source,
    channel_chat_id: conversation.channelChatId,
    created_at: conversation.createTime,
    updated_at: conversation.modifyTime,
  };
}

export function rowToConversation(row: IConversationRow): TChatConversation {
  const base = {
    id: row.id,
    name: row.name,
    desc: undefined as string | undefined,
    createTime: row.created_at,
    modifyTime: row.updated_at,
    status: row.status,
    source: row.source,
    channelChatId: row.channel_chat_id,
  };

  if (row.type === 'gemini' && row.model) {
    return {
      ...base,
      type: 'gemini' as const,
      extra: JSON.parse(row.extra),
      model: JSON.parse(row.model),
    } as TChatConversation;
  }

  if (row.type === 'acp') {
    return {
      ...base,
      type: 'acp' as const,
      extra: JSON.parse(row.extra),
    } as TChatConversation;
  }

  if (row.type === 'codex') {
    return {
      ...base,
      type: 'codex' as const,
      extra: JSON.parse(row.extra),
    } as TChatConversation;
  }

  if (row.type === 'openclaw-gateway') {
    return {
      ...base,
      type: 'openclaw-gateway' as const,
      extra: JSON.parse(row.extra),
    } as TChatConversation;
  }

  if (row.type === 'nanobot') {
    return {
      ...base,
      type: 'nanobot' as const,
      extra: JSON.parse(row.extra),
    } as TChatConversation;
  }

  if (row.type === 'aionrs' && row.model) {
    return {
      ...base,
      type: 'aionrs' as const,
      extra: JSON.parse(row.extra),
      model: JSON.parse(row.model),
    } as TChatConversation;
  }

  if (row.type === 'remote') {
    return {
      ...base,
      type: 'remote' as const,
      extra: JSON.parse(row.extra),
    } as TChatConversation;
  }

  throw new Error(`Unknown conversation type: ${row.type}`);
}

export function messageToRow(message: TMessage): IMessageRow {
  return {
    id: message.id,
    conversation_id: message.conversation_id,
    msg_id: message.msg_id,
    type: message.type,
    content: JSON.stringify(message.content),
    position: message.position,
    status: message.status,
    hidden: message.hidden ? 1 : 0,
    created_at: message.createdAt || Date.now(),
  };
}

export function rowToMessage(row: IMessageRow): TMessage {
  return {
    id: row.id,
    conversation_id: row.conversation_id,
    msg_id: row.msg_id,
    type: row.type as TMessage['type'],
    content: JSON.parse(row.content),
    position: row.position,
    status: row.status,
    hidden: row.hidden === 1 ? true : undefined,
    createdAt: row.created_at,
  } as TMessage;
}

const parseStringArray = (rawValue: string): string[] => {
  try {
    const parsedValue: unknown = JSON.parse(rawValue);
    if (!Array.isArray(parsedValue)) {
      return [];
    }
    return parsedValue.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
};

export type CreateTurnSnapshotFileInput = Omit<TurnSnapshotFile, 'createdAt' | 'updatedAt'> & {
  createdAt?: number;
  updatedAt?: number;
};

export type CreateTurnSnapshotInput = Omit<TurnSnapshot, 'fileCount' | 'createdAt' | 'updatedAt' | 'files'> & {
  createdAt?: number;
  updatedAt?: number;
  files: CreateTurnSnapshotFileInput[];
};

export function turnSnapshotToRow(snapshot: CreateTurnSnapshotInput): TurnSnapshotRow {
  const createdAt = snapshot.createdAt ?? Date.now();
  const updatedAt = snapshot.updatedAt ?? createdAt;

  return {
    id: snapshot.id,
    conversation_id: snapshot.conversationId,
    backend: snapshot.backend,
    request_msg_id: snapshot.requestMessageId ?? null,
    started_at: snapshot.startedAt,
    completed_at: snapshot.completedAt,
    completion_signal: snapshot.completionSignal,
    completion_source: snapshot.completionSource ?? null,
    review_status: snapshot.reviewStatus,
    file_count: snapshot.files.length,
    source_message_ids: JSON.stringify(snapshot.sourceMessageIds),
    created_at: createdAt,
    updated_at: updatedAt,
  };
}

export function turnSnapshotFileToRow(file: CreateTurnSnapshotFileInput): TurnSnapshotFileRow {
  const createdAt = file.createdAt ?? Date.now();
  const updatedAt = file.updatedAt ?? createdAt;

  return {
    id: file.id,
    turn_id: file.turnId,
    conversation_id: file.conversationId,
    file_path: file.filePath,
    file_name: file.fileName,
    action: file.action,
    before_exists: file.beforeExists ? 1 : 0,
    after_exists: file.afterExists ? 1 : 0,
    before_hash: file.beforeHash ?? null,
    after_hash: file.afterHash ?? null,
    before_content: file.beforeContent ?? null,
    after_content: file.afterContent ?? null,
    unified_diff: file.unifiedDiff,
    source_message_ids: JSON.stringify(file.sourceMessageIds),
    revert_supported: file.revertSupported ? 1 : 0,
    revert_error: file.revertError ?? null,
    created_at: createdAt,
    updated_at: updatedAt,
  };
}

export function rowToTurnSnapshotSummary(row: TurnSnapshotRow): TurnSnapshotSummary {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    backend: row.backend,
    requestMessageId: row.request_msg_id ?? undefined,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    completionSignal: row.completion_signal,
    completionSource: row.completion_source ?? undefined,
    reviewStatus: row.review_status,
    fileCount: row.file_count,
    sourceMessageIds: parseStringArray(row.source_message_ids),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function rowToTurnSnapshotFile(row: TurnSnapshotFileRow): TurnSnapshotFile {
  return {
    id: row.id,
    turnId: row.turn_id,
    conversationId: row.conversation_id,
    filePath: row.file_path,
    fileName: row.file_name,
    action: row.action,
    beforeExists: row.before_exists === 1,
    afterExists: row.after_exists === 1,
    beforeHash: row.before_hash ?? undefined,
    afterHash: row.after_hash ?? undefined,
    beforeContent: row.before_content ?? undefined,
    afterContent: row.after_content ?? undefined,
    unifiedDiff: row.unified_diff,
    sourceMessageIds: parseStringArray(row.source_message_ids),
    revertSupported: row.revert_supported === 1,
    revertError: row.revert_error ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type {
  TChatConversation,
  TMessage,
  IConfigStorageRefer,
  TurnFileAction,
  TurnReviewStatus,
  TurnSnapshot,
  TurnSnapshotFile,
  TurnSnapshotSummary,
};
