import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TurnSnapshot } from '@/common/types/turnSnapshot';

let liveHandler: ((event: { conversationId: string; summary: TurnSnapshot; reason: string }) => void) | undefined;

const mockListInvoke = vi.fn();
const mockGetInvoke = vi.fn();
const mockKeepInvoke = vi.fn();
const mockRevertInvoke = vi.fn();
const mockLaunchPreview = vi.fn();
const mockMessageSuccess = vi.fn();
const mockMessageError = vi.fn();

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      turnSnapshot: {
        list: { invoke: (...args: unknown[]) => mockListInvoke(...args) },
        get: { invoke: (...args: unknown[]) => mockGetInvoke(...args) },
        keep: { invoke: (...args: unknown[]) => mockKeepInvoke(...args) },
        revert: { invoke: (...args: unknown[]) => mockRevertInvoke(...args) },
        live: {
          on: (handler: typeof liveHandler) => {
            liveHandler = handler;
            return () => {
              if (liveHandler === handler) {
                liveHandler = undefined;
              }
            };
          },
        },
      },
    },
  },
}));

vi.mock('@/renderer/hooks/file/usePreviewLauncher', () => ({
  usePreviewLauncher: () => ({
    launchPreview: mockLaunchPreview,
  }),
}));

vi.mock('@arco-design/web-react', () => ({
  Button: ({ children, onClick, disabled }: { children?: React.ReactNode; onClick?: () => void; disabled?: boolean }) =>
    React.createElement('button', { disabled, onClick }, children),
  Space: ({ children }: { children: React.ReactNode }) => React.createElement('div', {}, children),
  Tag: ({ children }: { children: React.ReactNode }) => React.createElement('span', {}, children),
  Message: {
    success: (...args: unknown[]) => mockMessageSuccess(...args),
    error: (...args: unknown[]) => mockMessageError(...args),
  },
}));

vi.mock('@icon-park/react', () => ({
  Down: () => React.createElement('span', {}, 'Down'),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) => {
      if (key === 'messages.fileChangesCount') {
        return `${options?.count ?? 0} File Changes`;
      }

      const textMap: Record<string, string> = {
        'conversation.turnSummary.title': 'Turn Summary',
        'conversation.turnSummary.expand': 'Expand',
        'conversation.turnSummary.collapse': 'Collapse',
        'conversation.turnSummary.viewChanges': 'View changes',
        'conversation.turnSummary.waitingForChanges': 'Waiting for file changes in this turn.',
        'conversation.turnSummary.noFiles': 'No file changes yet',
        'conversation.turnSummary.lifecycle.running': 'Running',
        'conversation.turnSummary.lifecycle.completed': 'Completed',
        'conversation.turnSummary.lifecycle.interrupted': 'Interrupted',
        'conversation.turnSummary.description.running': 'This turn is still collecting file changes.',
        'conversation.turnSummary.description.pending': 'Review these changes before starting the next turn.',
        'conversation.turnSummary.description.interrupted':
          'This turn was interrupted, but the captured changes can still be reviewed.',
        'conversation.turnSummary.description.unsupported':
          'This turn can be kept, but revert is unavailable for some files.',
        'conversation.turnSummary.description.kept': 'These changes are kept.',
        'conversation.turnSummary.description.autoKept':
          'These changes were kept automatically before the next turn started.',
        'conversation.turnSummary.description.reverted': 'These changes were reverted.',
        'conversation.turnSummary.description.conflict':
          'Revert was blocked because the workspace changed after this turn.',
        'conversation.turnSummary.description.failed': 'Revert failed before all files could be restored.',
        'messages.turnSnapshot.keep': 'Keep This Turn',
        'messages.turnSnapshot.revert': 'Revert This Turn',
        'messages.turnSnapshot.keepSuccess': 'Turn kept',
        'messages.turnSnapshot.keepFailed': 'Failed to keep this turn',
        'messages.turnSnapshot.revertSuccess': 'Turn reverted',
        'messages.turnSnapshot.revertFailed': 'Failed to revert this turn',
        'messages.turnSnapshot.conflict': 'Conflict detected',
        'messages.turnSnapshot.unsupported': 'Revert unavailable',
        'messages.turnSnapshot.kept': 'Kept',
        'messages.turnSnapshot.reverted': 'Reverted',
      };

      return textMap[key] ?? key;
    },
  }),
}));

import TurnSummaryPanel from '@/renderer/pages/conversation/TurnSummaryPanel';

const makeSnapshot = (overrides?: Partial<TurnSnapshot>): TurnSnapshot => ({
  id: 'turn-1',
  conversationId: 'conv-1',
  backend: 'codex',
  requestMessageId: 'msg-1',
  startedAt: 1,
  completedAt: 2,
  completionSignal: 'finish',
  completionSource: 'end_turn',
  lifecycleStatus: 'completed',
  reviewStatus: 'pending',
  fileCount: 1,
  sourceMessageIds: ['msg-1'],
  lastActivityAt: 2,
  createdAt: 1,
  updatedAt: 2,
  files: [
    {
      id: 'file-1',
      turnId: 'turn-1',
      conversationId: 'conv-1',
      filePath: 'src/example.ts',
      fileName: 'example.ts',
      action: 'update',
      beforeExists: true,
      afterExists: true,
      beforeHash: 'before',
      afterHash: 'after',
      beforeContent: 'before',
      afterContent: 'after',
      unifiedDiff: 'diff --git a/src/example.ts b/src/example.ts\n@@ -1 +1 @@\n-before\n+after',
      sourceMessageIds: ['msg-1'],
      revertSupported: true,
      createdAt: 1,
      updatedAt: 2,
    },
  ],
  ...overrides,
});

describe('TurnSummaryPanel', () => {
  let currentSnapshot: TurnSnapshot;

  beforeEach(() => {
    vi.clearAllMocks();
    liveHandler = undefined;

    currentSnapshot = makeSnapshot();
    mockListInvoke.mockImplementation(async () => [{ id: currentSnapshot.id }]);
    mockGetInvoke.mockImplementation(async () => currentSnapshot);
    mockKeepInvoke.mockImplementation(async () => {
      currentSnapshot = {
        ...currentSnapshot,
        reviewStatus: 'kept',
      };
      return { success: true, turnId: currentSnapshot.id, reviewStatus: 'kept' };
    });
    mockRevertInvoke.mockResolvedValue({
      success: true,
      turnId: 'turn-1',
      status: 'reverted',
      reviewStatus: 'reverted',
    });
  });

  it('renders completed pending turns with keep and revert actions', async () => {
    render(<TurnSummaryPanel conversationId='conv-1' />);

    await waitFor(() => {
      expect(screen.getByText('Turn Summary')).toBeTruthy();
      expect(screen.getByText('Keep This Turn')).toBeTruthy();
      expect(screen.getByText('Revert This Turn')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Keep This Turn'));

    await waitFor(() => {
      expect(mockKeepInvoke).toHaveBeenCalledWith({ turnId: 'turn-1' });
      expect(mockMessageSuccess).toHaveBeenCalledWith('Turn kept');
      expect(screen.getByText('Kept')).toBeTruthy();
    });
  });

  it('renders unsupported turns as keep-only', async () => {
    currentSnapshot = makeSnapshot({
      reviewStatus: 'unsupported',
    });

    render(<TurnSummaryPanel conversationId='conv-1' />);

    await waitFor(() => {
      expect(screen.getByText('Revert unavailable')).toBeTruthy();
      expect(screen.getByText('Keep This Turn')).toBeTruthy();
    });

    expect(screen.queryByText('Revert This Turn')).toBeNull();
  });

  it('expands running turns and auto-collapses after a completed live update', async () => {
    currentSnapshot = makeSnapshot({
      completedAt: undefined,
      completionSignal: undefined,
      lifecycleStatus: 'running',
      fileCount: 0,
      files: [],
    });

    render(<TurnSummaryPanel conversationId='conv-1' />);

    await waitFor(() => {
      expect(screen.getByText('Running')).toBeTruthy();
      expect(screen.getByText('Waiting for file changes in this turn.')).toBeTruthy();
    });

    expect(screen.queryByText('Keep This Turn')).toBeNull();

    act(() => {
      liveHandler?.({
        conversationId: 'conv-1',
        summary: makeSnapshot(),
        reason: 'completed',
      });
    });

    await waitFor(() => {
      expect(screen.getByText('Keep This Turn')).toBeTruthy();
      expect(screen.getByText('Revert This Turn')).toBeTruthy();
      expect(screen.queryByText('example.ts')).toBeNull();
    });

    fireEvent.click(screen.getByText('Expand'));
    fireEvent.click(screen.getByText('View changes'));

    expect(mockLaunchPreview).toHaveBeenCalledWith(
      expect.objectContaining({
        fileName: 'example.ts',
        contentType: 'diff',
        editable: false,
      })
    );
  });
});
