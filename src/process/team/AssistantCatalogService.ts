/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { CreateConversationParams } from '@process/services/IConversationService';
import { getAssistantsDir, ProcessConfig } from '@process/utils/initStorage';
import type { TChatConversation, TProviderWithModel } from '@/common/config/storage';
import type { AcpBackendConfig, AcpBackendAll } from '@/common/types/acpTypes';
import { resolveLocaleKey } from '@/common/utils';
import type { TeamCommand, TeamSelectionMode } from './teamTypes';

type DelegateTeamCommand = Extract<TeamCommand, { action: 'delegate' }>;

export type TeamAssistantSelection = {
  assistantId?: string;
  assistantName: string;
  selectionMode: TeamSelectionMode;
  selectionReason: string;
  createConversationParams: CreateConversationParams;
};

const ASSISTANT_RULE_LOCALE_FALLBACKS = ['en-US', 'zh-CN'];

const normalizeIdCandidates = (value: string | undefined): string[] => {
  if (!value) {
    return [];
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }

  const withoutBuiltinPrefix = trimmed.replace(/^builtin-/, '');
  const withBuiltinPrefix = trimmed.startsWith('builtin-') ? trimmed : `builtin-${trimmed}`;
  return [...new Set([trimmed, withoutBuiltinPrefix, withBuiltinPrefix])];
};

const buildGeminiPlaceholderModel = (): TProviderWithModel => ({
  id: 'gemini-placeholder',
  name: 'Gemini',
  useModel: 'default',
  platform: 'gemini-with-google-auth' as TProviderWithModel['platform'],
  baseUrl: '',
  apiKey: '',
});

export class AssistantCatalogService {
  async selectAssistant(
    mainConversation: TChatConversation,
    command: DelegateTeamCommand
  ): Promise<TeamAssistantSelection> {
    const presetAssistants = await this.listCompatiblePresetAssistants(mainConversation);

    const explicitlyRecommended = this.matchByAssistantId(presetAssistants, command.recommendedAssistantId);
    if (explicitlyRecommended) {
      return this.buildPresetSelection(mainConversation, explicitlyRecommended, 'recommendedAssistantId matched');
    }

    const candidateMatch = (command.candidateAssistantIds ?? [])
      .map((assistantId) => this.matchByAssistantId(presetAssistants, assistantId))
      .find((assistant): assistant is AcpBackendConfig => !!assistant);
    if (candidateMatch) {
      return this.buildPresetSelection(mainConversation, candidateMatch, 'candidateAssistantIds matched');
    }

    const keywordMatch = this.matchByKeyword(presetAssistants, command);
    if (keywordMatch) {
      return this.buildPresetSelection(mainConversation, keywordMatch, 'keyword match');
    }

    return this.buildFallbackSelection(mainConversation);
  }

  private async buildPresetSelection(
    mainConversation: TChatConversation,
    assistant: AcpBackendConfig,
    selectionReason: string
  ): Promise<TeamAssistantSelection> {
    const locale = resolveLocaleKey((await ProcessConfig.get('language')) || 'en-US');
    const fallbackRules = typeof assistant.context === 'string' ? assistant.context : undefined;
    const presetRules = await this.readAssistantRules(assistant.id, locale, fallbackRules);
    const sessionMode = this.getExtraString(mainConversation, 'sessionMode');
    const workspace = this.getWorkspace(mainConversation);

    const runtimeKey = this.getRuntimeKey(mainConversation);
    if (runtimeKey === 'gemini') {
      return {
        assistantId: assistant.id,
        assistantName: assistant.name,
        selectionMode: 'recommended',
        selectionReason,
        createConversationParams: {
          type: 'gemini',
          model: this.getGeminiModel(mainConversation),
          name: assistant.name,
          extra: {
            workspace,
            customWorkspace: true,
            webSearchEngine: this.getExtraString(mainConversation, 'webSearchEngine') as
              | 'google'
              | 'default'
              | undefined,
            contextFileName: this.getExtraString(mainConversation, 'contextFileName'),
            presetRules,
            enabledSkills: assistant.enabledSkills,
            presetAssistantId: assistant.id,
            sessionMode,
          },
        },
      };
    }

    return {
      assistantId: assistant.id,
      assistantName: assistant.name,
      selectionMode: 'recommended',
      selectionReason,
      createConversationParams: {
        type: 'acp',
        model: {} as TProviderWithModel,
        name: assistant.name,
        extra: {
          workspace,
          customWorkspace: true,
          backend: runtimeKey as AcpBackendAll,
          presetContext: presetRules,
          enabledSkills: assistant.enabledSkills,
          presetAssistantId: assistant.id,
          sessionMode,
          currentModelId: this.getExtraString(mainConversation, 'currentModelId'),
        },
      },
    };
  }

  private async buildFallbackSelection(mainConversation: TChatConversation): Promise<TeamAssistantSelection> {
    const type = mainConversation.type;
    const workspace = this.getWorkspace(mainConversation);

    if (type === 'gemini') {
      return {
        assistantName: mainConversation.model.name || 'Gemini',
        selectionMode: 'fallback',
        selectionReason: 'current runtime default agent',
        createConversationParams: {
          type: 'gemini',
          model: this.getGeminiModel(mainConversation),
          name: mainConversation.model.name || 'Gemini',
          extra: {
            workspace,
            customWorkspace: true,
            webSearchEngine: mainConversation.extra.webSearchEngine,
            sessionMode: mainConversation.extra.sessionMode,
          },
        },
      };
    }

    if (type === 'acp') {
      return {
        assistantName: this.getFallbackAgentName(mainConversation),
        selectionMode: 'fallback',
        selectionReason: 'current runtime default agent',
        createConversationParams: {
          type: 'acp',
          model: {} as TProviderWithModel,
          name: this.getFallbackAgentName(mainConversation),
          extra: {
            workspace,
            customWorkspace: true,
            backend: mainConversation.extra.backend,
            cliPath: mainConversation.extra.cliPath,
            agentName: mainConversation.extra.agentName,
            customAgentId:
              mainConversation.extra.backend === 'custom' ? mainConversation.extra.customAgentId : undefined,
            sessionMode: mainConversation.extra.sessionMode,
            currentModelId: mainConversation.extra.currentModelId,
          },
        },
      };
    }

    if (type === 'codex') {
      return {
        assistantName: 'Codex',
        selectionMode: 'fallback',
        selectionReason: 'current runtime default agent',
        createConversationParams: {
          type: 'codex',
          model: {} as TProviderWithModel,
          name: 'Codex',
          extra: {
            workspace,
            customWorkspace: true,
            cliPath: mainConversation.extra.cliPath,
            sessionMode: mainConversation.extra.sessionMode,
            codexModel: mainConversation.extra.codexModel,
          },
        },
      };
    }

    if (type === 'openclaw-gateway') {
      return {
        assistantName: mainConversation.extra.agentName || 'OpenClaw',
        selectionMode: 'fallback',
        selectionReason: 'current runtime default agent',
        createConversationParams: {
          type: 'openclaw-gateway',
          model: {} as TProviderWithModel,
          name: mainConversation.extra.agentName || 'OpenClaw',
          extra: {
            workspace,
            customWorkspace: true,
            backend: mainConversation.extra.backend,
            agentName: mainConversation.extra.agentName,
            cliPath: mainConversation.extra.gateway?.cliPath,
          },
        },
      };
    }

    if (type === 'nanobot') {
      return {
        assistantName: 'Nano Bot',
        selectionMode: 'fallback',
        selectionReason: 'current runtime default agent',
        createConversationParams: {
          type: 'nanobot',
          model: {} as TProviderWithModel,
          name: 'Nano Bot',
          extra: {
            workspace,
            customWorkspace: true,
          },
        },
      };
    }

    if (type === 'remote') {
      return {
        assistantName: mainConversation.name,
        selectionMode: 'fallback',
        selectionReason: 'current runtime default agent',
        createConversationParams: {
          type: 'remote',
          model: {} as TProviderWithModel,
          name: mainConversation.name,
          extra: {
            workspace,
            customWorkspace: true,
            remoteAgentId: mainConversation.extra.remoteAgentId,
          },
        },
      };
    }

    throw new Error(`Unsupported conversation type for assistant selection: ${type satisfies never}`);
  }

  private async listCompatiblePresetAssistants(mainConversation: TChatConversation): Promise<AcpBackendConfig[]> {
    const runtimeKey = this.getRuntimeKey(mainConversation);
    if (!runtimeKey) {
      return [];
    }

    const configuredAssistants = ((await ProcessConfig.get('acp.customAgents')) || []) as AcpBackendConfig[];
    return configuredAssistants.filter((assistant) => {
      if (!assistant.isPreset || assistant.enabled === false) {
        return false;
      }

      return (assistant.presetAgentType || 'gemini') === runtimeKey;
    });
  }

  private matchByAssistantId(
    assistants: AcpBackendConfig[],
    assistantId: string | undefined
  ): AcpBackendConfig | undefined {
    if (!assistantId) {
      return undefined;
    }

    const idCandidates = new Set(normalizeIdCandidates(assistantId));
    return assistants.find((assistant) =>
      normalizeIdCandidates(assistant.id).some((candidate) => idCandidates.has(candidate))
    );
  }

  private matchByKeyword(assistants: AcpBackendConfig[], command: DelegateTeamCommand): AcpBackendConfig | undefined {
    const haystack = `${command.title}\n${command.taskPrompt}`.toLowerCase();
    let bestMatch: AcpBackendConfig | undefined;
    let bestScore = 0;

    for (const assistant of assistants) {
      const candidates = [
        assistant.id,
        assistant.id.replace(/^builtin-/, ''),
        assistant.name,
        ...Object.values(assistant.nameI18n || {}),
      ]
        .map((value) => value.trim().toLowerCase())
        .filter((value) => value.length >= 3);

      const score = candidates.reduce((total, candidate) => {
        return haystack.includes(candidate) ? total + candidate.length : total;
      }, 0);

      if (score > bestScore) {
        bestScore = score;
        bestMatch = assistant;
      }
    }

    return bestScore > 0 ? bestMatch : undefined;
  }

  private getRuntimeKey(conversation: TChatConversation): string | undefined {
    if (conversation.type === 'gemini') {
      return 'gemini';
    }

    if (conversation.type === 'acp') {
      return conversation.extra.backend;
    }

    if (conversation.type === 'codex') {
      return 'codex';
    }

    return undefined;
  }

  private getGeminiModel(conversation: TChatConversation): TProviderWithModel {
    return conversation.type === 'gemini' ? conversation.model : buildGeminiPlaceholderModel();
  }

  private getFallbackAgentName(conversation: Extract<TChatConversation, { type: 'acp' }>): string {
    if (conversation.extra.agentName) {
      return conversation.extra.agentName;
    }

    return conversation.extra.backend;
  }

  private getWorkspace(conversation: TChatConversation): string | undefined {
    const extra = conversation.extra as { workspace?: string };
    return extra.workspace;
  }

  private getExtraString(conversation: TChatConversation, key: string): string | undefined {
    const extra = conversation.extra as Record<string, unknown>;
    const value = extra[key];
    return typeof value === 'string' ? value : undefined;
  }

  private async readAssistantRules(
    assistantId: string,
    locale: string,
    fallbackRules?: string
  ): Promise<string | undefined> {
    const assistantsDir = getAssistantsDir();
    const locales = [...new Set([locale, ...ASSISTANT_RULE_LOCALE_FALLBACKS])];

    for (const currentLocale of locales) {
      try {
        const filePath = path.join(assistantsDir, `${assistantId}.${currentLocale}.md`);
        const content = await fs.readFile(filePath, 'utf-8');
        const normalized = content.trim();
        if (normalized) {
          return normalized;
        }
      } catch {
        // Ignore missing locale files and continue fallback lookup.
      }
    }

    return fallbackRules;
  }
}
