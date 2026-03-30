/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, render } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockUsePwaMode = vi.fn();

vi.mock('@/renderer/hooks/system/usePwaMode', () => ({
  __esModule: true,
  default: () => mockUsePwaMode(),
}));

import PwaPullToRefresh, { PWA_REFRESH_EVENT } from '@/renderer/components/layout/PwaPullToRefresh';

describe('PwaPullToRefresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUsePwaMode.mockReturnValue(true);
    document.body.innerHTML = '';
  });

  it('dispatches an in-app refresh event after pulling down past the threshold', () => {
    const container = document.createElement('div');
    container.className = 'layout-content';
    document.body.appendChild(container);

    const listener = vi.fn();
    window.addEventListener(PWA_REFRESH_EVENT, listener);

    render(<PwaPullToRefresh />);

    act(() => {
      container.dispatchEvent(
        new TouchEvent('touchstart', {
          bubbles: true,
          cancelable: true,
          touches: [{ clientY: 0 } as Touch],
        })
      );
      container.dispatchEvent(
        new TouchEvent('touchmove', {
          bubbles: true,
          cancelable: true,
          touches: [{ clientY: 90 } as Touch],
        })
      );
      container.dispatchEvent(
        new TouchEvent('touchend', {
          bubbles: true,
          cancelable: true,
        })
      );
    });

    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener(PWA_REFRESH_EVENT, listener);
  });

  it('does not dispatch refresh when PWA mode is disabled', () => {
    mockUsePwaMode.mockReturnValue(false);
    const container = document.createElement('div');
    container.className = 'layout-content';
    document.body.appendChild(container);

    const listener = vi.fn();
    window.addEventListener(PWA_REFRESH_EVENT, listener);

    render(<PwaPullToRefresh />);

    act(() => {
      container.dispatchEvent(
        new TouchEvent('touchstart', {
          bubbles: true,
          cancelable: true,
          touches: [{ clientY: 0 } as Touch],
        })
      );
      container.dispatchEvent(
        new TouchEvent('touchmove', {
          bubbles: true,
          cancelable: true,
          touches: [{ clientY: 90 } as Touch],
        })
      );
      container.dispatchEvent(
        new TouchEvent('touchend', {
          bubbles: true,
          cancelable: true,
        })
      );
    });

    expect(listener).not.toHaveBeenCalled();
    window.removeEventListener(PWA_REFRESH_EVENT, listener);
  });
});
