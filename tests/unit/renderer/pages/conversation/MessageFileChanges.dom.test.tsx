import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockLaunchPreview = vi.fn();

vi.mock('@/renderer/hooks/file/usePreviewLauncher', () => ({
  usePreviewLauncher: () => ({
    launchPreview: mockLaunchPreview,
  }),
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
        'preview.preview': 'Preview',
      };

      return textMap[key] ?? key;
    },
  }),
}));

import MessageFileChanges from '@/renderer/pages/conversation/Messages/codex/MessageFileChanges';

describe('MessageFileChanges', () => {
  const diffsChanges = [
    {
      fileName: 'test.ts',
      fullPath: 'src/test.ts',
      insertions: 3,
      deletions: 1,
      diff: 'diff --git a/src/test.ts b/src/test.ts',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders file changes without turn-level actions', () => {
    render(<MessageFileChanges diffsChanges={diffsChanges} />);

    expect(screen.getByText('1 File Changes')).toBeTruthy();
    expect(screen.queryByText('Keep This Turn')).toBeNull();
    expect(screen.queryByText('Revert This Turn')).toBeNull();
  });

  it('opens file preview and diff preview from the change list', () => {
    render(<MessageFileChanges diffsChanges={diffsChanges} />);

    fireEvent.click(screen.getByText('Preview'));
    fireEvent.click(screen.getByText('+3'));

    expect(mockLaunchPreview).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        relativePath: 'src/test.ts',
        fileName: 'test.ts',
      })
    );
    expect(mockLaunchPreview).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        fileName: 'test.ts',
        contentType: 'diff',
        editable: false,
      })
    );
  });
});
