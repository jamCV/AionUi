/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: vi.fn(() => '/tmp/test') } }));

const mockDb = {
  getConversation: vi.fn(),
  createConversation: vi.fn(),
  updateConversation: vi.fn(),
  deleteConversation: vi.fn(),
  getConversationMessages: vi.fn(),
  insertMessage: vi.fn(),
  getUserConversations: vi.fn(),
  createTurnSnapshot: vi.fn(),
  getTurnSnapshot: vi.fn(),
  getTurnSnapshotsByConversation: vi.fn(),
  updateTurnReviewStatus: vi.fn(),
  getTurnSnapshotFiles: vi.fn(),
};

vi.mock('@process/services/database', () => ({
  getDatabase: vi.fn(() => Promise.resolve(mockDb)),
}));

import { SqliteConversationRepository } from '../../src/process/services/database/SqliteConversationRepository';

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
    const conversation = { id: 'c1', type: 'gemini' } as any;

    await repo.createConversation(conversation);

    expect(mockDb.createConversation).toHaveBeenCalledWith(conversation);
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

  it('insertMessage calls db.insertMessage', async () => {
    mockDb.insertMessage.mockReturnValue({ success: true });
    const repo = new SqliteConversationRepository();
    const message = { id: 'm1', conversation_id: 'c1' } as any;

    await repo.insertMessage(message);

    expect(mockDb.insertMessage).toHaveBeenCalledWith(message);
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

    expect(mockDb.getUserConversations).toHaveBeenCalledWith(undefined, 0, 20);
  });

  it('createTurnSnapshot delegates to the database', async () => {
    const repo = new SqliteConversationRepository();
    const snapshot = { id: 'turn-1', conversationId: 'c1', files: [] } as any;

    await repo.createTurnSnapshot(snapshot);

    expect(mockDb.createTurnSnapshot).toHaveBeenCalledWith(snapshot);
  });

  it('getTurnSnapshot returns data when DB succeeds', async () => {
    const snapshot = { id: 'turn-1', reviewStatus: 'pending' };
    mockDb.getTurnSnapshot.mockReturnValue({ success: true, data: snapshot });
    const repo = new SqliteConversationRepository();

    expect(await repo.getTurnSnapshot('turn-1')).toEqual(snapshot);
    expect(mockDb.getTurnSnapshot).toHaveBeenCalledWith('turn-1');
  });

  it('getTurnSnapshotsByConversation returns stored summaries', async () => {
    mockDb.getTurnSnapshotsByConversation.mockReturnValue({
      success: true,
      data: [{ id: 'turn-1' }],
    });
    const repo = new SqliteConversationRepository();

    expect(await repo.getTurnSnapshotsByConversation('c1', 10)).toEqual([{ id: 'turn-1' }]);
    expect(mockDb.getTurnSnapshotsByConversation).toHaveBeenCalledWith('c1', 10);
  });

  it('updateTurnReviewStatus delegates to the database', async () => {
    const repo = new SqliteConversationRepository();

    await repo.updateTurnReviewStatus('turn-1', 'kept' as any);

    expect(mockDb.updateTurnReviewStatus).toHaveBeenCalledWith('turn-1', 'kept');
  });

  it('getTurnSnapshotFiles returns file rows from the database', async () => {
    mockDb.getTurnSnapshotFiles.mockReturnValue({
      success: true,
      data: [{ id: 'file-1' }],
    });
    const repo = new SqliteConversationRepository();

    expect(await repo.getTurnSnapshotFiles('turn-1')).toEqual([{ id: 'file-1' }]);
    expect(mockDb.getTurnSnapshotFiles).toHaveBeenCalledWith('turn-1');
  });
});
