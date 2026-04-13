import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAcpInitialMessage } from '@/renderer/pages/conversation/platforms/acp/useAcpInitialMessage';

const mockAcpSendInvoke = vi.fn();
const mockAddOrUpdateMessage = vi.fn();
const mockEmitterEmit = vi.fn();
const mockBuildDisplayMessage = vi.fn(
  (input: string, files: string[], workspacePath: string) => `${input}|${files.join(',')}|${workspacePath}`
);

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

vi.mock('@/renderer/utils/emitter', () => ({
  emitter: {
    emit: (...args: unknown[]) => mockEmitterEmit(...args),
  },
}));

vi.mock('@/renderer/utils/file/messageFiles', () => ({
  buildDisplayMessage: (...args: Parameters<typeof mockBuildDisplayMessage>) => mockBuildDisplayMessage(...args),
}));

describe('useAcpInitialMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    uuidCounter = 0;
    sessionStorage.clear();
    mockAcpSendInvoke.mockResolvedValue({ success: true });
  });

  it('waits for workspace hydration before sending the initial ACP message', async () => {
    const { rerender } = renderHook(
      ({ workspacePath }: { workspacePath: string | null }) =>
        useAcpInitialMessage({
          conversationId: 'conv-hydration',
          workspacePath,
          backend: 'claude',
          setAiProcessing: vi.fn(),
          checkAndUpdateTitle: vi.fn(),
          addOrUpdateMessage: mockAddOrUpdateMessage,
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

    expect(mockAddOrUpdateMessage).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('acp_initial_message_conv-hydration')).not.toBeNull();

    rerender({ workspacePath: 'C:/workspace' });

    await waitFor(() => {
      expect(mockAcpSendInvoke).toHaveBeenCalledTimes(1);
    });

    expect(mockBuildDisplayMessage).toHaveBeenCalledWith('hydrate first', ['C:/workspace/file.txt'], 'C:/workspace');
    expect(mockAcpSendInvoke).toHaveBeenCalledWith({
      input: 'hydrate first|C:/workspace/file.txt|C:/workspace',
      msg_id: 'acp-init-1',
      conversation_id: 'conv-hydration',
      files: ['C:/workspace/file.txt'],
    });
    expect(sessionStorage.getItem('acp_initial_message_conv-hydration')).toBeNull();
    expect(mockAddOrUpdateMessage).not.toHaveBeenCalled();
  });

  it('uses display message when the initial ACP prompt includes uploaded files', async () => {
    const setAiProcessing = vi.fn();
    const checkAndUpdateTitle = vi.fn();

    sessionStorage.setItem(
      'acp_initial_message_conv-acp',
      JSON.stringify({
        input: 'describe this image',
        files: ['C:/workspace/uploads/photo.png'],
      })
    );

    renderHook(() =>
      useAcpInitialMessage({
        conversationId: 'conv-acp',
        backend: 'claude',
        workspacePath: 'C:/workspace',
        setAiProcessing,
        checkAndUpdateTitle,
        addOrUpdateMessage: mockAddOrUpdateMessage,
      })
    );

    await waitFor(() => {
      expect(mockAcpSendInvoke).toHaveBeenCalledTimes(1);
    });

    expect(mockBuildDisplayMessage).toHaveBeenCalledWith(
      'describe this image',
      ['C:/workspace/uploads/photo.png'],
      'C:/workspace'
    );
    expect(setAiProcessing).toHaveBeenCalledWith(true);
    expect(checkAndUpdateTitle).toHaveBeenCalledWith('conv-acp', 'describe this image');
    expect(mockAcpSendInvoke).toHaveBeenCalledWith({
      input: 'describe this image|C:/workspace/uploads/photo.png|C:/workspace',
      msg_id: 'acp-init-1',
      conversation_id: 'conv-acp',
      files: ['C:/workspace/uploads/photo.png'],
    });
    expect(mockEmitterEmit).toHaveBeenCalledWith('chat.history.refresh');
    expect(mockEmitterEmit).toHaveBeenCalledWith('acp.workspace.refresh');
    expect(sessionStorage.getItem('acp_initial_message_conv-acp')).toBeNull();
    expect(mockAddOrUpdateMessage).not.toHaveBeenCalled();
  });

  it('shows an error tip and stops loading when the ACP initial send fails', async () => {
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
        addOrUpdateMessage: mockAddOrUpdateMessage,
      })
    );

    await waitFor(() => {
      expect(mockAddOrUpdateMessage).toHaveBeenCalledTimes(1);
    });

    expect(mockAddOrUpdateMessage).toHaveBeenCalledWith(
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
