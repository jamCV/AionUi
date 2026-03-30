/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TChatConversation } from '../../src/common/config/storage';
import type { TMessage } from '../../src/common/chat/chatLib';
import type { CreateTurnSnapshotInput } from '../../src/process/services/database/types';

vi.mock('electron', () => ({ app: { getPath: vi.fn(() => '/tmp/test') } }));

const mockDb = {
  getConversation: vi.fn(),
  createConversation: vi.fn(),
  updateConversation: vi.fn(),
  deleteConversation: vi.fn(),
  getConversationMessages: vi.fn(),
  getConversationMessageLocation: vi.fn(),
  insertMessage: vi.fn(),
  getUserConversations: vi.fn(),
  searchConversationMessages: vi.fn(),
  createTurnSnapshot: vi.fn(),
  getTurnSnapshot: vi.fn(),
  getTurnSnapshotsByConversation: vi.fn(),
  updateTurnReviewStatus: vi.fn(),
  getTurnSnapshotFiles: vi.fn(),
};
vi.mock('@process/services/database', () => ({ getDatabase: vi.fn(() => Promise.resolve(mockDb)) }));

import { SqliteConversationRepository } from '../../src/process/services/database/SqliteConversationRepository';

const makeConversation = (): TChatConversation => ({
  id: 'c1',
  name: 'Conversation',
  type: 'acp',
  extra: {
    backend: 'codex',
    workspace: '/workspace',
  },
  createTime: 1,
  modifyTime: 2,
});

const makeMessage = (): TMessage => ({
  id: 'm1',
  conversation_id: 'c1',
  type: 'text',
  position: 'left',
  content: { content: 'hello' },
  createdAt: 3,
});

const makeTurnSnapshotInput = (): CreateTurnSnapshotInput => ({
  id: 'turn-1',
  conversationId: 'c1',
  backend: 'codex',
  requestMessageId: 'request-1',
  startedAt: 10,
  completedAt: 20,
  completionSignal: 'finish',
  completionSource: 'end_turn',
  reviewStatus: 'pending',
  sourceMessageIds: ['message-1'],
  files: [
    {
      id: 'file-1',
      turnId: 'turn-1',
      conversationId: 'c1',
      filePath: 'src/example.ts',
      fileName: 'example.ts',
      action: 'update',
      beforeExists: true,
      afterExists: true,
      beforeHash: 'before-hash',
      afterHash: 'after-hash',
      beforeContent: 'before',
      afterContent: 'after',
      unifiedDiff: '@@ -1 +1 @@',
      sourceMessageIds: ['message-1'],
      revertSupported: true,
      createdAt: 10,
      updatedAt: 20,
    },
  ],
  createdAt: 10,
  updatedAt: 20,
});

describe('SqliteConversationRepository', () => {
  beforeEach(() => vi.clearAllMocks());

  it('getConversation returns data when DB succeeds', async () => {
    const fakeConv = { id: 'c1', type: 'gemini' };
    mockDb.getConversation.mockReturnValue({ success: true, data: fakeConv });
    const repo = new SqliteConversationRepository();
    expect(await repo.getConversation('c1')).toEqual(fakeConv);
    expect(mockDb.getConversation).toHaveBeenCalledWith('c1');
  });

  it('getConversation returns undefined when DB fails', async () => {
    mockDb.getConversation.mockReturnValue({ success: false, data: null });
    const repo = new SqliteConversationRepository();
    expect(await repo.getConversation('missing')).toBeUndefined();
  });

  it('createConversation calls db.createConversation', async () => {
    mockDb.createConversation.mockReturnValue({ success: true });
    const repo = new SqliteConversationRepository();
    const conv = makeConversation();
    await repo.createConversation(conv);
    expect(mockDb.createConversation).toHaveBeenCalledWith(conv);
  });

  it('updateConversation calls db.updateConversation', async () => {
    mockDb.updateConversation.mockReturnValue({ success: true });
    const repo = new SqliteConversationRepository();
    await repo.updateConversation('c1', { name: 'new name' });
    expect(mockDb.updateConversation).toHaveBeenCalledWith('c1', { name: 'new name' });
  });

  it('deleteConversation calls db.deleteConversation', async () => {
    mockDb.deleteConversation.mockReturnValue({ success: true });
    const repo = new SqliteConversationRepository();
    await repo.deleteConversation('c1');
    expect(mockDb.deleteConversation).toHaveBeenCalledWith('c1');
  });

  it('getMessages maps to PaginatedResult shape', async () => {
    mockDb.getConversationMessages.mockReturnValue({ data: [{ id: 'm1' }], total: 1, hasMore: false });
    const repo = new SqliteConversationRepository();
    const result = await repo.getMessages('c1', 0, 100);
    expect(result.total).toBe(1);
    expect(result.data).toHaveLength(1);
    expect(result.hasMore).toBe(false);
    expect(mockDb.getConversationMessages).toHaveBeenCalledWith('c1', 0, 100, undefined);
  });

  it('getMessageLocation delegates to db.getConversationMessageLocation', async () => {
    const location = {
      conversationId: 'c1',
      messageId: 'm42',
      page: 3,
      pageSize: 50,
      total: 160,
      indexWithinPage: 9,
      absoluteIndex: 159,
      found: true,
    };
    mockDb.getConversationMessageLocation.mockReturnValue(location);
    const repo = new SqliteConversationRepository();

    await expect(repo.getMessageLocation('c1', 'm42', 50)).resolves.toEqual(location);
    expect(mockDb.getConversationMessageLocation).toHaveBeenCalledWith('c1', 'm42', 50);
  });

  it('insertMessage calls db.insertMessage', async () => {
    mockDb.insertMessage.mockReturnValue({ success: true });
    const repo = new SqliteConversationRepository();
    const msg = makeMessage();
    await repo.insertMessage(msg);
    expect(mockDb.insertMessage).toHaveBeenCalledWith(msg);
  });

  it('getUserConversations maps to PaginatedResult shape', async () => {
    mockDb.getUserConversations.mockReturnValue({ data: [{ id: 'c1' }], total: 1, hasMore: false });
    const repo = new SqliteConversationRepository();
    const result = await repo.getUserConversations();
    expect(result.total).toBe(1);
    expect(result.data).toHaveLength(1);
    expect(result.hasMore).toBe(false);
  });

  it('getUserConversations passes page and pageSize when offset/limit provided', async () => {
    mockDb.getUserConversations.mockReturnValue({ data: [], total: 0, hasMore: false });
    const repo = new SqliteConversationRepository();
    await repo.getUserConversations(undefined, 2, 20);
    // offset=2, limit=20 → page = Math.floor(2/20) = 0, pageSize = 20
    expect(mockDb.getUserConversations).toHaveBeenCalledWith(undefined, 0, 20);
  });

  it('createTurnSnapshot calls db.createTurnSnapshot', async () => {
    mockDb.createTurnSnapshot.mockReturnValue({ success: true });
    const repo = new SqliteConversationRepository();
    const input = makeTurnSnapshotInput();
    await repo.createTurnSnapshot(input);
    expect(mockDb.createTurnSnapshot).toHaveBeenCalledWith(input);
  });

  it('getTurnSnapshot returns data when DB succeeds', async () => {
    const snapshot = {
      ...makeTurnSnapshotInput(),
      fileCount: 1,
    };
    mockDb.getTurnSnapshot.mockReturnValue({ success: true, data: snapshot });
    const repo = new SqliteConversationRepository();
    expect(await repo.getTurnSnapshot('turn-1')).toEqual(snapshot);
    expect(mockDb.getTurnSnapshot).toHaveBeenCalledWith('turn-1');
  });

  it('getTurnSnapshotsByConversation returns summary list', async () => {
    const summaries = [
      {
        id: 'turn-1',
        conversationId: 'c1',
        backend: 'codex',
        requestMessageId: 'request-1',
        startedAt: 10,
        completedAt: 20,
        completionSignal: 'finish',
        completionSource: 'end_turn',
        reviewStatus: 'pending',
        fileCount: 1,
        sourceMessageIds: ['message-1'],
        createdAt: 10,
        updatedAt: 20,
      },
    ];
    mockDb.getTurnSnapshotsByConversation.mockReturnValue({ success: true, data: summaries });
    const repo = new SqliteConversationRepository();
    expect(await repo.getTurnSnapshotsByConversation('c1', 10)).toEqual(summaries);
    expect(mockDb.getTurnSnapshotsByConversation).toHaveBeenCalledWith('c1', 10);
  });

  it('updateTurnReviewStatus calls db.updateTurnReviewStatus', async () => {
    mockDb.updateTurnReviewStatus.mockReturnValue({ success: true });
    const repo = new SqliteConversationRepository();
    await repo.updateTurnReviewStatus('turn-1', 'kept');
    expect(mockDb.updateTurnReviewStatus).toHaveBeenCalledWith('turn-1', 'kept');
  });

  it('getTurnSnapshotFiles returns file list', async () => {
    const files = makeTurnSnapshotInput().files;
    mockDb.getTurnSnapshotFiles.mockReturnValue({ success: true, data: files });
    const repo = new SqliteConversationRepository();
    expect(await repo.getTurnSnapshotFiles('turn-1')).toEqual(files);
    expect(mockDb.getTurnSnapshotFiles).toHaveBeenCalledWith('turn-1');
  });
});
