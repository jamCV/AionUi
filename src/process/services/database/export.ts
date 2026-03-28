/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Main database exports
 * Use this file to import database functionality throughout the app
 */

export { AionUIDatabase, getDatabase, closeDatabase } from './index';
export {
  runMigrations,
  rollbackMigrations,
  getMigrationHistory,
  isMigrationApplied,
  type IMigration,
} from './migrations';

export type {
  // Database-specific types
  IUser,
  IQueryResult,
  IPaginatedResult,
  // Business types (re-exported for convenience)
  TChatConversation,
  TMessage,
  IConfigStorageRefer,
  // Database row types (for advanced usage)
  IConversationRow,
  IMessageRow,
  IConfigRow,
  TurnReviewStatus,
  TurnFileAction,
  TurnSnapshotRow,
  TurnSnapshotFileRow,
  TurnSnapshotSummary,
  TurnSnapshotFile,
  TurnSnapshot,
  CreateTurnSnapshotFileInput,
  CreateTurnSnapshotInput,
} from './types';

// Re-export conversion functions
export {
  conversationToRow,
  rowToConversation,
  messageToRow,
  rowToMessage,
  turnSnapshotToRow,
  turnSnapshotFileToRow,
  rowToTurnSnapshotSummary,
  rowToTurnSnapshotFile,
} from './types';
