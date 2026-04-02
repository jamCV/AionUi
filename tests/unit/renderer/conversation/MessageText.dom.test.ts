/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

import MessageText from '@/renderer/pages/conversation/Messages/components/MessagetText';
import type { IMessageText } from '@/common/chat/chatLib';

vi.mock('@renderer/components/Markdown', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => React.createElement('div', {}, children),
}));

vi.mock('@renderer/components/chat/CollapsibleContent', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => React.createElement('div', {}, children),
}));

vi.mock('@renderer/components/media/FilePreview', () => ({
  __esModule: true,
  default: () => React.createElement('div', {}, 'FilePreview'),
}));

vi.mock('@renderer/components/media/HorizontalFileList', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => React.createElement('div', {}, children),
}));

vi.mock('@renderer/utils/ui/clipboard', () => ({
  copyText: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@arco-design/web-react', () => ({
  Alert: ({ content }: { content: React.ReactNode }) => React.createElement('div', {}, content),
  Message: {
    error: vi.fn(),
  },
  Tooltip: ({ children }: { children: React.ReactNode }) => React.createElement('div', {}, children),
}));

vi.mock('@icon-park/react', () => ({
  Copy: () => React.createElement('span', {}, 'Copy'),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const createMessage = (content: string): IMessageText =>
  ({
    id: 'message-1',
    msg_id: 'message-1',
    type: 'text',
    position: 'left',
    content: { content },
    createdAt: 1,
    conversation_id: 'conversation-1',
  }) as IMessageText;

describe('MessageText hidden team command sanitization', () => {
  it('hides hidden team command blocks from visible output', () => {
    render(
      React.createElement(MessageText, {
        message: createMessage(
          'Visible result\n<aionui-team-command hidden>{"action":"delegate","title":"x","taskPrompt":"y"}</aionui-team-command>\nDone'
        ),
      })
    );

    expect(screen.getByText(/Visible result\s+Done/)).toBeTruthy();
    expect(screen.queryByText(/aionui-team-command/i)).toBeNull();
    expect(screen.queryByText(/taskPrompt/i)).toBeNull();
  });

  it('renders literal hidden tag mentions as normal text', () => {
    render(
      React.createElement(MessageText, {
        message: createMessage('sanitize hidden `<aionui-team-command hidden>` blocks before rendering'),
      })
    );

    expect(screen.getByText(/aionui-team-command hidden/)).toBeTruthy();
  });

  it('still renders ordinary text normally', () => {
    render(
      React.createElement(MessageText, {
        message: createMessage('Plain visible summary'),
      })
    );

    expect(screen.getByText('Plain visible summary')).toBeTruthy();
  });
});
