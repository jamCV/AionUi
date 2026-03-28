import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockLaunchPreview = vi.fn();

vi.mock('@/renderer/hooks/file/usePreviewLauncher', () => ({
  usePreviewLauncher: () => ({
    launchPreview: mockLaunchPreview,
  }),
}));

vi.mock('@arco-design/web-react', () => ({
  Button: ({ children, onClick, disabled }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean }) =>
    React.createElement('button', { disabled, onClick }, children),
  Space: ({ children }: { children: React.ReactNode }) => React.createElement('div', {}, children),
  Tag: ({ children }: { children: React.ReactNode }) => React.createElement('span', {}, children),
}));

vi.mock('@icon-park/react', () => ({
  Down: () => React.createElement('span', {}, 'Down'),
  PreviewOpen: () => React.createElement('span', {}, 'PreviewOpen'),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) => {
      if (key === 'messages.fileChangesCount') {
        return `${options?.count ?? 0} File Changes`;
      }

      const textMap: Record<string, string> = {
        'messages.turnSnapshot.keep': 'Keep This Turn',
        'messages.turnSnapshot.revert': 'Revert This Turn',
        'messages.turnSnapshot.kept': 'Kept',
        'messages.turnSnapshot.unsupported': 'Revert unavailable',
        'preview.preview': 'Preview',
      };

      return textMap[key] ?? key;
    },
  }),
}));

import MessageFileChanges from '@/renderer/pages/conversation/Messages/codex/MessageFileChanges';

describe('MessageFileChanges', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const diffsChanges = [
    {
      fileName: 'test.ts',
      fullPath: 'src/test.ts',
      insertions: 3,
      deletions: 1,
      diff: 'diff --git a/src/test.ts b/src/test.ts',
    },
  ];

  it('renders keep and revert actions for pending turn snapshots', () => {
    const handleKeepTurn = vi.fn();
    const handleRevertTurn = vi.fn();

    render(
      <MessageFileChanges
        diffsChanges={diffsChanges}
        turnId='turn-1'
        turnReviewStatus='pending'
        canKeep
        canRevert
        onKeepTurn={handleKeepTurn}
        onRevertTurn={handleRevertTurn}
      />
    );

    expect(screen.getByText('1 File Changes')).toBeTruthy();
    expect(screen.getByText('Keep This Turn')).toBeTruthy();
    expect(screen.getByText('Revert This Turn')).toBeTruthy();

    fireEvent.click(screen.getByText('Keep This Turn'));
    fireEvent.click(screen.getByText('Revert This Turn'));

    expect(handleKeepTurn).toHaveBeenCalledTimes(1);
    expect(handleRevertTurn).toHaveBeenCalledTimes(1);
  });

  it('renders unsupported turns as keep-only', () => {
    const handleKeepTurn = vi.fn();

    render(
      <MessageFileChanges
        diffsChanges={diffsChanges}
        turnId='turn-unsupported'
        turnReviewStatus='unsupported'
        canKeep
        canRevert={false}
        onKeepTurn={handleKeepTurn}
      />
    );

    expect(screen.getByText('Revert unavailable')).toBeTruthy();
    expect(screen.getByText('Keep This Turn')).toBeTruthy();
    expect(screen.queryByText('Revert This Turn')).toBeNull();
  });

  it('renders kept status without action buttons', () => {
    render(
      <MessageFileChanges diffsChanges={diffsChanges} turnId='turn-kept' turnReviewStatus='kept' canKeep={false} />
    );

    expect(screen.getByText('Kept')).toBeTruthy();
    expect(screen.queryByText('Keep This Turn')).toBeNull();
    expect(screen.queryByText('Revert This Turn')).toBeNull();
  });
});
