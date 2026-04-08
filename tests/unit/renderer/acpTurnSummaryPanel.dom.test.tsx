import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockListInvoke = vi.fn();
const mockGetInvoke = vi.fn();
const mockKeepInvoke = vi.fn();
const mockRevertInvoke = vi.fn();
const mockLaunchPreview = vi.fn();
const mockArcoSuccess = vi.fn();
const mockArcoError = vi.fn();

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      turnSnapshot: {
        list: { invoke: (...args: unknown[]) => mockListInvoke(...args) },
        get: { invoke: (...args: unknown[]) => mockGetInvoke(...args) },
        keep: { invoke: (...args: unknown[]) => mockKeepInvoke(...args) },
        revert: { invoke: (...args: unknown[]) => mockRevertInvoke(...args) },
      },
    },
  },
}));

vi.mock('@/renderer/hooks/file/usePreviewLauncher', () => ({
  usePreviewLauncher: () => ({
    launchPreview: mockLaunchPreview,
    loading: false,
  }),
}));

vi.mock('@arco-design/web-react', () => ({
  Button: ({ children, icon, onClick }: { children?: React.ReactNode; icon?: React.ReactNode; onClick?: () => void }) =>
    React.createElement(
      'button',
      {
        type: 'button',
        onClick,
      },
      icon,
      children
    ),
  Tag: ({ children }: { children?: React.ReactNode }) => React.createElement('span', {}, children),
  Message: {
    success: (...args: unknown[]) => mockArcoSuccess(...args),
    error: (...args: unknown[]) => mockArcoError(...args),
  },
}));

vi.mock('@icon-park/react', () => ({
  Down: () => React.createElement('span'),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) => {
      if (typeof options?.count === 'number') {
        return `${key}:${options.count}`;
      }
      return key;
    },
  }),
}));

import TurnSummaryPanel from '@/renderer/pages/conversation/platforms/acp/TurnSummaryPanel';

const buildSnapshot = (reviewStatus: 'pending' | 'kept' | 'conflict' = 'pending') => ({
  id: 'turn-1',
  conversationId: 'conv-1',
  backend: 'claude',
  requestMessageId: 'msg-1',
  startedAt: 1,
  completedAt: 2,
  completionSignal: 'end_turn',
  reviewStatus,
  fileCount: 1,
  sourceMessageIds: ['msg-1'],
  createdAt: 1,
  updatedAt: 2,
  files: [
    {
      id: 'file-1',
      turnId: 'turn-1',
      conversationId: 'conv-1',
      filePath: 'src/foo.ts',
      fileName: 'foo.ts',
      action: 'update',
      beforeExists: true,
      afterExists: true,
      beforeHash: 'hash-before',
      afterHash: 'hash-after',
      beforeContent: 'const value = 1;\n',
      afterContent: 'const value = 2;\n',
      unifiedDiff: [
        'diff --git a/src/foo.ts b/src/foo.ts',
        '--- a/src/foo.ts',
        '+++ b/src/foo.ts',
        '@@ -1 +1 @@',
        '-const value = 1;',
        '+const value = 2;',
      ].join('\n'),
      sourceMessageIds: ['msg-1'],
      revertSupported: true,
      createdAt: 1,
      updatedAt: 2,
    },
  ],
});

describe('Acp TurnSummaryPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListInvoke.mockResolvedValue([{ id: 'turn-1' }]);
    mockKeepInvoke.mockResolvedValue({
      success: true,
      turnId: 'turn-1',
      reviewStatus: 'kept',
      snapshot: buildSnapshot('kept'),
    });
    mockRevertInvoke.mockResolvedValue({
      success: true,
      turnId: 'turn-1',
      status: 'reverted',
      reviewStatus: 'reverted',
      snapshot: buildSnapshot('kept'),
    });
  });

  it('renders the latest pending snapshot and opens diff preview', async () => {
    mockGetInvoke.mockResolvedValue(buildSnapshot('pending'));

    render(<TurnSummaryPanel conversationId='conv-1' busy={false} />);

    await waitFor(() => {
      expect(mockListInvoke).toHaveBeenCalledWith({ conversation_id: 'conv-1', limit: 1 });
    });

    expect(await screen.findByText('conversation.turnSummary.title')).toBeInTheDocument();
    expect(screen.getByText('messages.turnSnapshot.pending')).toBeInTheDocument();
    expect(await screen.findByText('messages.fileChangesCount:1')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'conversation.turnSummary.viewChanges' }));

    expect(mockLaunchPreview).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'src/foo.ts',
        fileName: 'foo.ts',
        contentType: 'diff',
        editable: false,
        diffContent: expect.stringContaining('diff --git a/src/foo.ts b/src/foo.ts'),
      })
    );
  });

  it('keeps the current snapshot and refreshes the review badge', async () => {
    mockGetInvoke.mockResolvedValueOnce(buildSnapshot('pending')).mockResolvedValue(buildSnapshot('kept'));

    render(<TurnSummaryPanel conversationId='conv-1' busy={false} />);

    expect(await screen.findByText('messages.turnSnapshot.pending')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'messages.turnSnapshot.keep' }));

    await waitFor(() => {
      expect(mockKeepInvoke).toHaveBeenCalledWith({ turnId: 'turn-1' });
    });

    await waitFor(() => {
      expect(mockArcoSuccess).toHaveBeenCalledWith('messages.turnSnapshot.keepSuccess');
    });

    expect(await screen.findByText('messages.turnSnapshot.kept')).toBeInTheDocument();
  });

  it('shows a conflict error when revert is blocked by workspace drift', async () => {
    mockGetInvoke.mockResolvedValueOnce(buildSnapshot('pending')).mockResolvedValue(buildSnapshot('conflict'));
    mockRevertInvoke.mockResolvedValue({
      success: false,
      turnId: 'turn-1',
      status: 'conflict',
      reviewStatus: 'conflict',
      snapshot: buildSnapshot('conflict'),
      msg: 'Workspace has changed since this turn completed.',
    });

    render(<TurnSummaryPanel conversationId='conv-1' busy={false} />);

    expect(await screen.findByText('messages.turnSnapshot.pending')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'messages.turnSnapshot.revert' }));

    await waitFor(() => {
      expect(mockRevertInvoke).toHaveBeenCalledWith({ turnId: 'turn-1' });
    });

    await waitFor(() => {
      expect(mockArcoError).toHaveBeenCalledWith('Workspace has changed since this turn completed.');
    });

    expect(await screen.findByText('messages.turnSnapshot.conflict')).toBeInTheDocument();
  });
});
