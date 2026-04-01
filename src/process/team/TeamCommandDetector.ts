/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TeamCommand } from './teamTypes';

const TEAM_COMMAND_BLOCK_REGEX = /<aionui-team-command>\s*([\s\S]*?)\s*<\/aionui-team-command>/gi;

const normalizeString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  return normalized ? normalized : undefined;
};

const normalizeStringArray = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized = value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0);

  return normalized.length > 0 ? normalized : undefined;
};

export class TeamCommandDetector {
  parse(text: string | null | undefined): TeamCommand | null {
    if (!text) {
      return null;
    }

    const matches = [...text.matchAll(TEAM_COMMAND_BLOCK_REGEX)];
    if (matches.length !== 1) {
      if (matches.length > 1) {
        console.warn('[SubagentTeam] Ignoring message with multiple team command blocks.');
      }
      return null;
    }

    const rawJson = matches[0]?.[1]?.trim();
    if (!rawJson) {
      return null;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawJson);
    } catch (error) {
      console.warn('[SubagentTeam] Failed to parse team command JSON:', error);
      return null;
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }

    const command = parsed as Record<string, unknown>;
    if (command.action === 'delegate') {
      const title = normalizeString(command.title);
      const taskPrompt = normalizeString(command.taskPrompt);
      if (!title || !taskPrompt) {
        return null;
      }

      return {
        action: 'delegate',
        title,
        taskPrompt,
        expectedOutput: normalizeString(command.expectedOutput),
        recommendedAssistantId: normalizeString(command.recommendedAssistantId),
        candidateAssistantIds: normalizeStringArray(command.candidateAssistantIds),
        ownedPaths: normalizeStringArray(command.ownedPaths),
        blocking: typeof command.blocking === 'boolean' ? command.blocking : undefined,
      };
    }

    if (command.action === 'complete') {
      const summary = normalizeString(command.summary);
      if (!summary) {
        return null;
      }

      return {
        action: 'complete',
        summary,
      };
    }

    return null;
  }
}
