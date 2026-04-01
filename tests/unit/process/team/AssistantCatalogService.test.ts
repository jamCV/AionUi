import type { TChatConversation } from '@/common/config/storage';
import type { AcpBackendConfig } from '@/common/types/acpTypes';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockProcessConfigGet = vi.fn();
const mockGetAssistantsDir = vi.fn(() => 'E:/assistants');
const mockReadFile = vi.fn();

vi.mock('@process/utils/initStorage', () => ({
  ProcessConfig: {
    get: (...args: unknown[]) => mockProcessConfigGet(...args),
  },
  getAssistantsDir: () => mockGetAssistantsDir(),
}));

vi.mock('node:fs/promises', () => ({
  default: {
    readFile: (...args: unknown[]) => mockReadFile(...args),
  },
}));

import { AssistantCatalogService } from '@/process/team/AssistantCatalogService';

const makeGeminiConversation = (): Extract<TChatConversation, { type: 'gemini' }> => ({
  id: 'conv-gemini',
  name: 'Main Conversation',
  createTime: 1,
  modifyTime: 2,
  type: 'gemini',
  model: {
    id: 'provider-1',
    name: 'Gemini',
    useModel: 'gemini-2.5-pro',
    platform: 'gemini-with-google-auth',
    baseUrl: '',
    apiKey: '',
  },
  extra: {
    workspace: 'E:/workspace',
    customWorkspace: true,
    webSearchEngine: 'google',
    sessionMode: 'plan',
  },
});

const makeCodexConversation = (): Extract<TChatConversation, { type: 'codex' }> => ({
  id: 'conv-codex',
  name: 'Codex Main',
  createTime: 1,
  modifyTime: 2,
  type: 'codex',
  status: 'running',
  extra: {
    workspace: 'E:/workspace',
    customWorkspace: true,
    cliPath: 'codex',
    sessionMode: 'auto',
    codexModel: 'gpt-5-codex',
  },
});

describe('AssistantCatalogService', () => {
  const service = new AssistantCatalogService();

  beforeEach(() => {
    vi.clearAllMocks();
    mockProcessConfigGet.mockImplementation(async (key: string) => {
      if (key === 'acp.customAgents') {
        return [];
      }

      if (key === 'language') {
        return 'en-US';
      }

      return undefined;
    });
    mockReadFile.mockRejectedValue(new Error('not found'));
  });

  it('selects a recommended preset assistant and loads its localized rules', async () => {
    const presetAssistant: AcpBackendConfig = {
      id: 'builtin-researcher',
      name: 'Research Assistant',
      isPreset: true,
      presetAgentType: 'gemini',
      enabledSkills: ['docs-search'],
      context: 'fallback rule',
    };
    mockProcessConfigGet.mockImplementation(async (key: string) => {
      if (key === 'acp.customAgents') {
        return [presetAssistant];
      }

      if (key === 'language') {
        return 'en-US';
      }

      return undefined;
    });
    mockReadFile.mockResolvedValue('# localized system rule');

    const selection = await service.selectAssistant(makeGeminiConversation(), {
      action: 'delegate',
      title: 'Investigate flaky test',
      taskPrompt: 'Find the root cause and propose a patch',
      recommendedAssistantId: 'researcher',
    });

    expect(selection.assistantId).toBe('builtin-researcher');
    expect(selection.selectionMode).toBe('recommended');
    expect(selection.selectionReason).toBe('recommendedAssistantId matched');
    expect(selection.createConversationParams).toMatchObject({
      type: 'gemini',
      name: 'Research Assistant',
      extra: {
        workspace: 'E:/workspace',
        customWorkspace: true,
        webSearchEngine: 'google',
        presetRules: '# localized system rule',
        enabledSkills: ['docs-search'],
        presetAssistantId: 'builtin-researcher',
        sessionMode: 'plan',
      },
    });
    expect(mockReadFile).toHaveBeenCalledWith(expect.stringContaining('builtin-researcher.en-US.md'), 'utf-8');
  });

  it('falls back to the current runtime when no compatible preset assistant exists', async () => {
    const selection = await service.selectAssistant(makeCodexConversation(), {
      action: 'delegate',
      title: 'Patch the bug',
      taskPrompt: 'Implement the fix in the current runtime',
    });

    expect(selection.assistantId).toBeUndefined();
    expect(selection.assistantName).toBe('Codex');
    expect(selection.selectionMode).toBe('fallback');
    expect(selection.selectionReason).toBe('current runtime default agent');
    expect(selection.createConversationParams).toMatchObject({
      type: 'codex',
      name: 'Codex',
      extra: {
        workspace: 'E:/workspace',
        customWorkspace: true,
        cliPath: 'codex',
        sessionMode: 'auto',
        codexModel: 'gpt-5-codex',
      },
    });
  });
});
