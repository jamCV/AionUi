/**
 * Regression tests for useAcpMessage hook.
 * Covers late events arriving after finish and resetState ref sync.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

let capturedResponseListener: ((message: unknown) => void) | null = null;
const mockGetInvoke = vi.fn().mockResolvedValue(null);
const mockAddOrUpdateMessage = vi.fn();
const mockTransformMessage = vi.fn((msg: unknown) => msg);

vi.mock('@/common', () => ({
  ipcBridge: {
    acpConversation: {
      responseStream: {
        on: vi.fn((listener: (message: unknown) => void) => {
          capturedResponseListener = listener;
          return () => {
            capturedResponseListener = null;
          };
        }),
      },
    },
    conversation: {
      get: { invoke: (...args: unknown[]) => mockGetInvoke(...args) },
    },
  },
}));

vi.mock('@/common/chat/chatLib', () => ({
  transformMessage: (...args: unknown[]) => mockTransformMessage(...args),
}));

vi.mock('@/renderer/pages/conversation/Messages/hooks', () => ({
  useAddOrUpdateMessage: vi.fn(() => mockAddOrUpdateMessage),
}));

import { useAcpMessage } from '@/renderer/pages/conversation/platforms/acp/useAcpMessage';

const CONVERSATION_ID = 'test-acp-conv';

describe('useAcpMessage', () => {
  beforeEach(() => {
    capturedResponseListener = null;
    mockGetInvoke.mockResolvedValue(null);
    mockAddOrUpdateMessage.mockReset();
    mockTransformMessage.mockClear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('keeps busy state off when thought arrives after finish', async () => {
    const { result } = renderHook(() => useAcpMessage(CONVERSATION_ID));

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      capturedResponseListener?.({
        type: 'start',
        conversation_id: CONVERSATION_ID,
      });
    });

    expect(result.current.running).toBe(true);

    act(() => {
      capturedResponseListener?.({
        type: 'finish',
        conversation_id: CONVERSATION_ID,
      });
    });

    expect(result.current.running).toBe(false);
    expect(result.current.aiProcessing).toBe(false);

    act(() => {
      capturedResponseListener?.({
        type: 'thought',
        conversation_id: CONVERSATION_ID,
        data: { subject: 'late', description: 'should be ignored' },
      });
      vi.runAllTimers();
    });

    expect(result.current.running).toBe(false);
    expect(result.current.aiProcessing).toBe(false);
    expect(result.current.thought.subject).toBe('');
  });

  it('resetState clears busy flags immediately', async () => {
    const { result } = renderHook(() => useAcpMessage(CONVERSATION_ID));

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      capturedResponseListener?.({
        type: 'start',
        conversation_id: CONVERSATION_ID,
      });
      result.current.setAiProcessing(true);
    });

    expect(result.current.running).toBe(true);
    expect(result.current.aiProcessing).toBe(true);

    act(() => {
      result.current.resetState();
    });

    expect(result.current.running).toBe(false);
    expect(result.current.aiProcessing).toBe(false);
  });

  it('records content messages without reactivating busy state after finish', async () => {
    const { result } = renderHook(() => useAcpMessage(CONVERSATION_ID));

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      capturedResponseListener?.({
        type: 'start',
        conversation_id: CONVERSATION_ID,
      });
      capturedResponseListener?.({
        type: 'finish',
        conversation_id: CONVERSATION_ID,
      });
      capturedResponseListener?.({
        type: 'content',
        conversation_id: CONVERSATION_ID,
        data: { text: 'late content' },
      });
    });

    expect(result.current.running).toBe(false);
    expect(result.current.aiProcessing).toBe(false);
    expect(mockAddOrUpdateMessage).toHaveBeenCalledTimes(1);
  });
});
