/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// 复用现有的业务类型定义
import type { ConversationSource, TChatConversation, IConfigStorageRefer } from '@/common/config/storage';
import type { TMessage } from '@/common/chat/chatLib';

/**
 * ======================
 * 数据库专属类型 (新增功能)
 * ======================
 */

/**
 * User account (新增的账户系统)
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

// Image metadata removed - images are stored in filesystem and referenced via message.resultDisplay

/**
 * ======================
 * 数据库查询辅助类型
 * ======================
 */

/**
 * Database query result wrapper
 */
export interface IQueryResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Paginated query result
 */
export interface IPaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

/**
 * ======================
 * 数据库存储格式 (序列化后的格式)
 * ======================
 */

/**
 * Conversation stored in database (序列化后的格式)
 */
export interface IConversationRow {
  id: string;
  user_id: string;
  name: string;
  type: 'gemini' | 'acp' | 'codex' | 'openclaw-gateway' | 'nanobot' | 'remote';
  extra: string; // JSON string of extra data
  model?: string; // JSON string of TProviderWithModel (gemini type has this)
  status?: 'pending' | 'running' | 'finished';
  source?: ConversationSource; // 会话来源 / Conversation source
  channel_chat_id?: string; // Channel chat isolation ID (e.g. user:xxx or group:xxx)
  created_at: number;
  updated_at: number;
}

/**
 * Message stored in database (序列化后的格式)
 */
export interface IMessageRow {
  id: string;
  conversation_id: string;
  msg_id?: string; // 消息来源ID
  type: string; // TMessage['type']
  content: string; // JSON string of message content
  position?: 'left' | 'right' | 'center' | 'pop';
  status?: 'finish' | 'pending' | 'error' | 'work';
  created_at: number;
}

/**
 * Config stored in database (key-value, 用于数据库版本跟踪)
 */
export interface IConfigRow {
  key: string;
  value: string; // JSON string
  updated_at: number;
}

export type TurnReviewStatus = 'pending' | 'kept' | 'reverted' | 'conflict' | 'unsupported' | 'failed';

export type TurnFileAction = 'create' | 'update' | 'delete';

export type TurnLifecycleStatus = 'running' | 'completed' | 'interrupted';

export type TurnSnapshotRow = {
  id: string;
  conversation_id: string;
  backend: string;
  request_msg_id: string | null;
  started_at: number;
  completed_at: number | null;
  completion_signal: string | null;
  completion_source: string | null;
  lifecycle_status: TurnLifecycleStatus;
  review_status: TurnReviewStatus;
  file_count: number;
  source_message_ids: string;
  last_activity_at: number;
  auto_kept_at: number | null;
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

export type TurnSnapshotSummary = {
  id: string;
  conversationId: string;
  backend: string;
  requestMessageId?: string;
  startedAt: number;
  completedAt?: number;
  completionSignal?: string;
  completionSource?: string;
  lifecycleStatus: TurnLifecycleStatus;
  reviewStatus: TurnReviewStatus;
  fileCount: number;
  sourceMessageIds: string[];
  lastActivityAt: number;
  autoKeptAt?: number;
  createdAt: number;
  updatedAt: number;
};

export type TurnSnapshotFile = {
  id: string;
  turnId: string;
  conversationId: string;
  filePath: string;
  fileName: string;
  action: TurnFileAction;
  beforeExists: boolean;
  afterExists: boolean;
  beforeHash?: string;
  afterHash?: string;
  beforeContent?: string;
  afterContent?: string;
  unifiedDiff: string;
  sourceMessageIds: string[];
  revertSupported: boolean;
  revertError?: string;
  createdAt: number;
  updatedAt: number;
};

export type TurnSnapshot = TurnSnapshotSummary & {
  files: TurnSnapshotFile[];
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

export type UpdateTurnSnapshotInput = {
  turnId: string;
  completedAt?: number;
  completionSignal?: string;
  completionSource?: string;
  lifecycleStatus?: TurnLifecycleStatus;
  reviewStatus?: TurnReviewStatus;
  fileCount?: number;
  sourceMessageIds?: string[];
  lastActivityAt?: number;
  autoKeptAt?: number;
  updatedAt?: number;
};

/**
 * ======================
 * 类型转换函数
 * ======================
 */

/**
 * Convert TChatConversation to database row
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

/**
 * Convert database row to TChatConversation
 */
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

  // Gemini type has model field
  if (row.type === 'gemini' && row.model) {
    return {
      ...base,
      type: 'gemini' as const,
      extra: JSON.parse(row.extra),
      model: JSON.parse(row.model),
    } as TChatConversation;
  }

  // ACP type
  if (row.type === 'acp') {
    return {
      ...base,
      type: 'acp' as const,
      extra: JSON.parse(row.extra),
    } as TChatConversation;
  }

  // Codex type
  if (row.type === 'codex') {
    return {
      ...base,
      type: 'codex' as const,
      extra: JSON.parse(row.extra),
    } as TChatConversation;
  }

  // OpenClaw Gateway type
  if (row.type === 'openclaw-gateway') {
    return {
      ...base,
      type: 'openclaw-gateway' as const,
      extra: JSON.parse(row.extra),
    } as TChatConversation;
  }

  // Nanobot type
  if (row.type === 'nanobot') {
    return {
      ...base,
      type: 'nanobot' as const,
      extra: JSON.parse(row.extra),
    } as TChatConversation;
  }

  // Remote type
  if (row.type === 'remote') {
    return {
      ...base,
      type: 'remote' as const,
      extra: JSON.parse(row.extra),
    } as TChatConversation;
  }

  // Unknown type - should never happen with valid data
  throw new Error(`Unknown conversation type: ${row.type}`);
}

/**
 * Convert TMessage to database row
 */
export function messageToRow(message: TMessage): IMessageRow {
  return {
    id: message.id,
    conversation_id: message.conversation_id,
    msg_id: message.msg_id,
    type: message.type,
    content: JSON.stringify(message.content),
    position: message.position,
    status: message.status,
    created_at: message.createdAt || Date.now(),
  };
}

/**
 * Convert database row to TMessage
 */
export function rowToMessage(row: IMessageRow): TMessage {
  return {
    id: row.id,
    conversation_id: row.conversation_id,
    msg_id: row.msg_id,
    type: row.type as TMessage['type'],
    content: JSON.parse(row.content),
    position: row.position,
    status: row.status,
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

export function turnSnapshotToRow(snapshot: CreateTurnSnapshotInput): TurnSnapshotRow {
  const createdAt = snapshot.createdAt ?? Date.now();
  const updatedAt = snapshot.updatedAt ?? createdAt;

  return {
    id: snapshot.id,
    conversation_id: snapshot.conversationId,
    backend: snapshot.backend,
    request_msg_id: snapshot.requestMessageId ?? null,
    started_at: snapshot.startedAt,
    completed_at: snapshot.completedAt ?? null,
    completion_signal: snapshot.completionSignal ?? null,
    completion_source: snapshot.completionSource ?? null,
    lifecycle_status: snapshot.lifecycleStatus,
    review_status: snapshot.reviewStatus,
    file_count: snapshot.files.length,
    source_message_ids: JSON.stringify(snapshot.sourceMessageIds),
    last_activity_at: snapshot.lastActivityAt,
    auto_kept_at: snapshot.autoKeptAt ?? null,
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
    completedAt: row.completed_at ?? undefined,
    completionSignal: row.completion_signal ?? undefined,
    completionSource: row.completion_source ?? undefined,
    lifecycleStatus: row.lifecycle_status,
    reviewStatus: row.review_status,
    fileCount: row.file_count,
    sourceMessageIds: parseStringArray(row.source_message_ids),
    lastActivityAt: row.last_activity_at,
    autoKeptAt: row.auto_kept_at ?? undefined,
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

/**
 * ======================
 * 导出类型别名，方便使用
 * ======================
 */

export type {
  // 复用的业务类型
  TChatConversation,
  TMessage,
  IConfigStorageRefer,
};
