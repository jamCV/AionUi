/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { CreateConversationParams } from '@process/services/IConversationService';
import { ExtensionRegistry } from '@process/extensions';
import { getAssistantsDir, ProcessConfig } from '@process/utils/initStorage';
import type { TChatConversation, TProviderWithModel } from '@/common/config/storage';
import type { AcpBackendAll, AcpBackendConfig } from '@/common/types/acpTypes';
import { resolveLocaleKey } from '@/common/utils';
import type { AssistanceDescriptor, PersistedAssistantBinding, TeamCommand, TeamSelectionMode } from './teamTypes';
import { isSupportedTeamAssistant, isSupportedTeamConversation } from './teamTypes';

type DelegateTeamCommand = Extract<TeamCommand, { action: 'delegate' }>;

export type TeamAssistantSelection = {
  assistantId?: string;
  assistantName: string;
  selectionMode: TeamSelectionMode;
  selectionReason: string;
  createConversationParams: CreateConversationParams;
  binding: PersistedAssistantBinding;
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

const normalizeText = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim();
  return normalized || undefined;
};

const buildGeminiPlaceholderModel = (): TProviderWithModel => ({
  id: 'gemini-placeholder',
  name: 'Gemini',
  useModel: 'default',
  platform: 'gemini-with-google-auth' as TProviderWithModel['platform'],
  baseUrl: '',
  apiKey: '',
});

type ExtensionAssistant = Record<string, unknown> & {
  id?: string;
  name?: string;
  presetAgentType?: string;
  enabledSkills?: string[];
  context?: string;
  enabled?: boolean;
};

export class AssistantCatalogService {
  async listAvailableAssistants(mainConversation: TChatConversation): Promise<AssistanceDescriptor[]> {
    if (!isSupportedTeamConversation(mainConversation)) {
      return [];
    }

    const all = await this.listAllEnabledAssistances();
    const normalized = all
      .map((item) => this.normalizeToDescriptor(item))
      .filter((item): item is AssistanceDescriptor => !!item)
      .filter((item) => this.filterSupportedTeamAssistances(item));

    return normalized.toSorted((left, right) => left.name.localeCompare(right.name));
  }

  async findByIdOrAlias(mainConversation: TChatConversation, token: string): Promise<AssistanceDescriptor | undefined> {
    const tokenCandidates = normalizeIdCandidates(token.toLowerCase());
    if (tokenCandidates.length === 0) {
      return undefined;
    }

    const descriptors = await this.listAvailableAssistants(mainConversation);
    return descriptors.find((descriptor) => {
      const ids = normalizeIdCandidates(descriptor.id.toLowerCase());
      const aliasCandidates = normalizeIdCandidates((descriptor.alias || '').toLowerCase());
      const names = normalizeIdCandidates(descriptor.name.toLowerCase().replace(/\s+/g, '-'));
      const all = new Set([...ids, ...aliasCandidates, ...names]);
      return tokenCandidates.some((candidate) => all.has(candidate));
    });
  }

  async recommendForCommand(
    mainConversation: TChatConversation,
    command: DelegateTeamCommand
  ): Promise<AssistanceDescriptor | undefined> {
    const descriptors = await this.listAvailableAssistants(mainConversation);
    if (descriptors.length === 0) {
      return undefined;
    }

    const explicit = await this.findByIdOrAlias(mainConversation, command.recommendedAssistantId || '');
    if (explicit) {
      return explicit;
    }

    for (const candidateId of command.candidateAssistantIds ?? []) {
      const matched = await this.findByIdOrAlias(mainConversation, candidateId);
      if (matched) {
        return matched;
      }
    }

    const haystack = `${command.title}\n${command.taskPrompt}`.toLowerCase();
    let bestMatch: AssistanceDescriptor | undefined;
    let bestScore = 0;
    for (const descriptor of descriptors) {
      const tokens = [descriptor.id, descriptor.alias, descriptor.name]
        .map((item) => item?.toLowerCase().trim())
        .filter((item): item is string => !!item && item.length >= 2);

      const score = tokens.reduce((total, token) => {
        return haystack.includes(token) ? total + token.length : total;
      }, 0);

      if (score > bestScore) {
        bestScore = score;
        bestMatch = descriptor;
      }
    }

    return bestMatch;
  }

  async selectAssistant(
    mainConversation: TChatConversation,
    command: DelegateTeamCommand
  ): Promise<TeamAssistantSelection> {
    const recommended = await this.recommendForCommand(mainConversation, command);
    if (recommended) {
      return this.buildSelectionFromDescriptor(mainConversation, recommended, 'recommended');
    }

    return this.buildFallbackSelection(mainConversation);
  }

  async selectionFromExplicitAssistant(
    mainConversation: TChatConversation,
    assistantId: string
  ): Promise<TeamAssistantSelection> {
    const descriptor = await this.findByIdOrAlias(mainConversation, assistantId);
    if (!descriptor) {
      throw new Error(`Assistant not found or unsupported: ${assistantId}`);
    }

    return this.buildSelectionFromDescriptor(mainConversation, descriptor, 'manual');
  }

  private async listAllEnabledAssistances(): Promise<Array<AcpBackendConfig | ExtensionAssistant>> {
    const configuredAssistants = ((await ProcessConfig.get('acp.customAgents')) || []) as AcpBackendConfig[];
    const extensionAssistants = ExtensionRegistry.getInstance().getAssistants() as ExtensionAssistant[];

    const enabledConfigured = configuredAssistants.filter((assistant) => assistant.enabled !== false);
    const enabledExtensions = extensionAssistants.filter((assistant) => assistant.enabled !== false);
    return [...enabledConfigured, ...enabledExtensions];
  }

  private normalizeToDescriptor(item: AcpBackendConfig | ExtensionAssistant): AssistanceDescriptor | undefined {
    const id = normalizeText(item.id);
    const name = normalizeText(item.name);
    if (!id || !name) {
      return undefined;
    }

    const rawRuntime = normalizeText((item as { presetAgentType?: string }).presetAgentType) || 'claude';
    const runtime = this.toSupportedRuntime(rawRuntime);
    if (!runtime) {
      return undefined;
    }

    const source = this.detectSource(item);
    return {
      id,
      name,
      alias: normalizeText((item as { alias?: string }).alias),
      runtime,
      backend: runtime === 'acp' ? rawRuntime : runtime,
      presetAssistantId: source !== 'custom' ? id : undefined,
      customAgentId: source === 'custom' ? id : undefined,
      enabledSkills: Array.isArray((item as { enabledSkills?: unknown[] }).enabledSkills)
        ? ((item as { enabledSkills: unknown[] }).enabledSkills.filter(
            (value): value is string => typeof value === 'string'
          ) as string[])
        : undefined,
      presetRules: normalizeText((item as { context?: string }).context),
      source,
    };
  }

  private filterSupportedTeamAssistances(descriptor: AssistanceDescriptor): boolean {
    return isSupportedTeamAssistant(descriptor);
  }

  private toSupportedRuntime(runtime: string): AssistanceDescriptor['runtime'] | undefined {
    const normalized = runtime.trim().toLowerCase();
    if (normalized === 'gemini') {
      return 'gemini';
    }
    if (normalized === 'codex') {
      return 'codex';
    }
    if (!normalized || normalized === 'acp' || normalized === 'claude' || normalized === 'custom') {
      return 'acp';
    }
    if (
      [
        'qwen',
        'iflow',
        'codebuddy',
        'droid',
        'goose',
        'auggie',
        'kimi',
        'opencode',
        'copilot',
        'qoder',
        'vibe',
        'cursor',
      ].includes(normalized)
    ) {
      return 'acp';
    }
    return undefined;
  }

  private detectSource(item: AcpBackendConfig | ExtensionAssistant): AssistanceDescriptor['source'] {
    const source = normalizeText((item as { _source?: string })._source);
    if (source === 'extension') {
      return 'extension';
    }
    const isPreset = Boolean((item as { isPreset?: boolean }).isPreset);
    if (!isPreset) {
      return 'custom';
    }
    return 'preset';
  }

  private async buildSelectionFromDescriptor(
    mainConversation: TChatConversation,
    descriptor: AssistanceDescriptor,
    selectionMode: TeamSelectionMode
  ): Promise<TeamAssistantSelection> {
    const workspace = this.getWorkspace(mainConversation);
    const sessionMode = this.getExtraString(mainConversation, 'sessionMode');
    const presetRules = await this.readDescriptorRules(descriptor);
    const selectionReason = selectionMode === 'recommended' ? 'recommendedAssistantId matched' : 'selected assistant';

    if (descriptor.runtime === 'gemini') {
      const createConversationParams: CreateConversationParams = {
        type: 'gemini',
        model: this.getGeminiModel(mainConversation),
        name: descriptor.name,
        extra: {
          workspace,
          customWorkspace: true,
          webSearchEngine: this.getExtraString(mainConversation, 'webSearchEngine') as 'google' | 'default' | undefined,
          contextFileName: this.getExtraString(mainConversation, 'contextFileName'),
          presetRules,
          enabledSkills: descriptor.enabledSkills,
          presetAssistantId: descriptor.presetAssistantId,
          sessionMode,
        },
      };

      return {
        assistantId: descriptor.id,
        assistantName: descriptor.name,
        selectionMode,
        selectionReason,
        createConversationParams,
        binding: this.toBinding(descriptor, createConversationParams),
      };
    }

    if (descriptor.runtime === 'codex') {
      const createConversationParams: CreateConversationParams = {
        type: 'codex',
        model: {} as TProviderWithModel,
        name: descriptor.name,
        extra: {
          workspace,
          customWorkspace: true,
          presetContext: presetRules,
          enabledSkills: descriptor.enabledSkills,
          presetAssistantId: descriptor.presetAssistantId,
          sessionMode,
          codexModel: this.getExtraString(mainConversation, 'codexModel'),
          cliPath: this.getExtraString(mainConversation, 'cliPath'),
        },
      };

      return {
        assistantId: descriptor.id,
        assistantName: descriptor.name,
        selectionMode,
        selectionReason,
        createConversationParams,
        binding: this.toBinding(descriptor, createConversationParams),
      };
    }

    const backend = (descriptor.backend || 'claude') as AcpBackendAll;
    const createConversationParams: CreateConversationParams = {
      type: 'acp',
      model: {} as TProviderWithModel,
      name: descriptor.name,
      extra: {
        workspace,
        customWorkspace: true,
        backend,
        presetContext: presetRules,
        enabledSkills: descriptor.enabledSkills,
        presetAssistantId: descriptor.presetAssistantId,
        customAgentId: descriptor.customAgentId,
        sessionMode,
        currentModelId: this.getExtraString(mainConversation, 'currentModelId'),
      },
    };

    return {
      assistantId: descriptor.id,
      assistantName: descriptor.name,
      selectionMode,
      selectionReason,
      createConversationParams,
      binding: this.toBinding(descriptor, createConversationParams),
    };
  }

  private async buildFallbackSelection(mainConversation: TChatConversation): Promise<TeamAssistantSelection> {
    const workspace = this.getWorkspace(mainConversation);
    const sessionMode = this.getExtraString(mainConversation, 'sessionMode');

    if (mainConversation.type === 'gemini') {
      const createConversationParams: CreateConversationParams = {
        type: 'gemini',
        model: this.getGeminiModel(mainConversation),
        name: mainConversation.model.name || 'Gemini',
        extra: {
          workspace,
          customWorkspace: true,
          webSearchEngine: mainConversation.extra.webSearchEngine,
          sessionMode,
        },
      };

      const descriptor: AssistanceDescriptor = {
        id: 'fallback-gemini',
        name: mainConversation.model.name || 'Gemini',
        runtime: 'gemini',
        source: 'fallback',
      };
      return {
        assistantName: descriptor.name,
        selectionMode: 'fallback',
        selectionReason: 'current runtime default agent',
        createConversationParams,
        binding: this.toBinding(descriptor, createConversationParams),
      };
    }

    if (mainConversation.type === 'codex') {
      const createConversationParams: CreateConversationParams = {
        type: 'codex',
        model: {} as TProviderWithModel,
        name: 'Codex',
        extra: {
          workspace,
          customWorkspace: true,
          cliPath: this.getExtraString(mainConversation, 'cliPath'),
          sessionMode,
          codexModel: this.getExtraString(mainConversation, 'codexModel'),
        },
      };
      const descriptor: AssistanceDescriptor = {
        id: 'fallback-codex',
        name: 'Codex',
        runtime: 'codex',
        source: 'fallback',
      };
      return {
        assistantName: descriptor.name,
        selectionMode: 'fallback',
        selectionReason: 'current runtime default agent',
        createConversationParams,
        binding: this.toBinding(descriptor, createConversationParams),
      };
    }

    if (mainConversation.type === 'acp') {
      const createConversationParams: CreateConversationParams = {
        type: 'acp',
        model: {} as TProviderWithModel,
        name: mainConversation.extra.agentName || String(mainConversation.extra.backend),
        extra: {
          workspace,
          customWorkspace: true,
          backend: mainConversation.extra.backend,
          cliPath: mainConversation.extra.cliPath,
          agentName: mainConversation.extra.agentName,
          customAgentId: mainConversation.extra.backend === 'custom' ? mainConversation.extra.customAgentId : undefined,
          sessionMode,
          currentModelId: mainConversation.extra.currentModelId,
        },
      };
      const descriptor: AssistanceDescriptor = {
        id: 'fallback-acp',
        name: mainConversation.extra.agentName || String(mainConversation.extra.backend),
        runtime: 'acp',
        backend: mainConversation.extra.backend,
        source: 'fallback',
      };
      return {
        assistantName: descriptor.name,
        selectionMode: 'fallback',
        selectionReason: 'current runtime default agent',
        createConversationParams,
        binding: this.toBinding(descriptor, createConversationParams),
      };
    }

    throw new Error(`Unsupported conversation type for assistant selection: ${mainConversation.type}`);
  }

  private toBinding(
    descriptor: AssistanceDescriptor,
    createConversationParams: CreateConversationParams
  ): PersistedAssistantBinding {
    return {
      descriptorId: descriptor.id,
      assistantName: descriptor.name,
      runtime: descriptor.runtime,
      createConversationParams: {
        type: createConversationParams.type,
        name: createConversationParams.name,
        model: createConversationParams.model as unknown as Record<string, unknown>,
        extra: createConversationParams.extra as unknown as Record<string, unknown>,
      },
    };
  }

  private getGeminiModel(conversation: TChatConversation): TProviderWithModel {
    return conversation.type === 'gemini' ? conversation.model : buildGeminiPlaceholderModel();
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

  private async readDescriptorRules(descriptor: AssistanceDescriptor): Promise<string | undefined> {
    const fallbackRules = descriptor.presetRules;
    const assistantId = descriptor.presetAssistantId || descriptor.id;
    if (!assistantId) {
      return fallbackRules;
    }

    const locale = resolveLocaleKey((await ProcessConfig.get('language')) || 'en-US');
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
