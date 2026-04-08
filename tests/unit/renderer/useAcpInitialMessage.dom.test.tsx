import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAcpInitialMessage } from '@/renderer/pages/conversation/platforms/acp/useAcpInitialMessage';

const mockAcpSendInvoke = vi.fn();
const mockEmitterEmit = vi.fn();
const mockBuildDisplayMessage = vi.fn((input: string, files: string[], workspacePath: string) => {
  return `${input}|${files.join(',')}|${workspacePath}`;
});

let uuidCounter = 0;

vi.mock('@/common', () => ({
  ipcBridge: {
    acpConversation: {
      sendMessage: {
        invoke: (...args: unknown[]) => mockAcpSendInvoke(...args),
      },
    },
  },
}));

vi.mock('@/common/utils', () => ({
  uuid: vi.fn(() => `acp-init-${++uuidCounter}`),
}));

vi.mock('@/renderer/utils/file/messageFiles', () => ({
  buildDisplayMessage: (...args: [string, string[], string]) => mockBuildDisplayMessage(...args),
}));

vi.mock('@/renderer/utils/emitter', () => ({
  emitter: {
    emit: (...args: unknown[]) => mockEmitterEmit(...args),
  },
}));

describe('useAcpInitialMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    uuidCounter = 0;
    sessionStorage.clear();
    mockAcpSendInvoke.mockResolvedValue({ success: true });
  });

  it('waits for workspace hydration before sending the initial ACP message', async () => {
    const addOrUpdateMessage = vi.fn();
    const { rerender } = renderHook(
      ({ workspacePath }: { workspacePath: string | null }) =>
        useAcpInitialMessage({
          conversationId: 'conv-hydration',
          workspacePath,
          backend: 'claude',
          setAiProcessing: vi.fn(),
          checkAndUpdateTitle: vi.fn(),
          addOrUpdateMessage,
        }),
      {
        initialProps: {
          workspacePath: null,
        },
      }
    );

    sessionStorage.setItem(
      'acp_initial_message_conv-hydration',
      JSON.stringify({
        input: 'hydrate first',
        files: ['C:/workspace/file.txt'],
      })
    );

    rerender({ workspacePath: null });

    await waitFor(() => {
      expect(mockAcpSendInvoke).not.toHaveBeenCalled();
    });

    expect(addOrUpdateMessage).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('acp_initial_message_conv-hydration')).not.toBeNull();

    rerender({ workspacePath: 'C:/workspace' });

    await waitFor(() => {
      expect(mockAcpSendInvoke).toHaveBeenCalledTimes(1);
    });

    expect(mockAcpSendInvoke).toHaveBeenCalledWith({
      input: 'hydrate first',
      msg_id: 'acp-init-1',
      conversation_id: 'conv-hydration',
      files: ['C:/workspace/file.txt'],
    });
  });

  it('adds a visible initial ACP message while sending raw input to the backend', async () => {
    const addOrUpdateMessage = vi.fn();
    const setAiProcessing = vi.fn();
    const checkAndUpdateTitle = vi.fn();

    sessionStorage.setItem(
      'acp_initial_message_conv-ready',
      JSON.stringify({
        input: 'send immediately',
        files: ['C:/workspace/readme.md'],
      })
    );

    renderHook(() =>
      useAcpInitialMessage({
        conversationId: 'conv-ready',
        workspacePath: 'C:/workspace',
        backend: 'claude',
        setAiProcessing,
        checkAndUpdateTitle,
        addOrUpdateMessage,
      })
    );

    await waitFor(() => {
      expect(mockAcpSendInvoke).toHaveBeenCalledTimes(1);
    });

    expect(addOrUpdateMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        msg_id: 'acp-init-1',
        conversation_id: 'conv-ready',
        position: 'right',
        content: {
          content: 'send immediately|C:/workspace/readme.md|C:/workspace',
        },
      }),
      true
    );
    expect(setAiProcessing).toHaveBeenCalledWith(true);
    expect(checkAndUpdateTitle).toHaveBeenCalledWith('conv-ready', 'send immediately');
    expect(mockAcpSendInvoke).toHaveBeenCalledWith({
      input: 'send immediately',
      msg_id: 'acp-init-1',
      conversation_id: 'conv-ready',
      files: ['C:/workspace/readme.md'],
    });
    expect(mockEmitterEmit).toHaveBeenCalledWith('chat.history.refresh');
    expect(mockEmitterEmit).toHaveBeenCalledWith('acp.workspace.refresh');
    expect(sessionStorage.getItem('acp_initial_message_conv-ready')).toBeNull();
  });

  it('shows an error tip and stops loading when the ACP initial send fails', async () => {
    const addOrUpdateMessage = vi.fn();
    const setAiProcessing = vi.fn();

    mockAcpSendInvoke.mockResolvedValue({ success: false });
    sessionStorage.setItem(
      'acp_initial_message_conv-error',
      JSON.stringify({
        input: 'broken send',
        files: [],
      })
    );

    renderHook(() =>
      useAcpInitialMessage({
        conversationId: 'conv-error',
        workspacePath: 'C:/workspace',
        backend: 'claude',
        setAiProcessing,
        checkAndUpdateTitle: vi.fn(),
        addOrUpdateMessage,
      })
    );

    await waitFor(() => {
      expect(addOrUpdateMessage).toHaveBeenCalledTimes(2);
    });

    expect(addOrUpdateMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        msg_id: 'acp-init-1',
        type: 'text',
        position: 'right',
      }),
      true
    );
    expect(addOrUpdateMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        id: 'acp-init-2',
        msg_id: 'acp-init-3',
        type: 'tips',
        position: 'center',
        content: expect.objectContaining({
          type: 'error',
        }),
      }),
      true
    );
    expect(setAiProcessing).toHaveBeenNthCalledWith(1, true);
    expect(setAiProcessing).toHaveBeenNthCalledWith(2, false);
    expect(mockEmitterEmit).not.toHaveBeenCalled();
  });
});
