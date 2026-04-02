/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TeamCommand } from './teamTypes';

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

    const rawJson = text.trim();
    if (!rawJson) {
      return null;
    }

    const candidates = this.extractCandidates(rawJson);

    let parsed: unknown | undefined;
    for (const candidate of candidates) {
      try {
        parsed = JSON.parse(candidate);
        break;
      } catch {
        // try next candidate
      }
    }
    if (parsed === undefined) {
      console.warn('[SubagentTeam] Failed to parse team command JSON: no valid candidate found');
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

  private extractCandidates(rawText: string): string[] {
    const candidates = new Set<string>();
    candidates.add(rawText);

    const hiddenTagMatches = Array.from(
      rawText.matchAll(/<aionui-team-command(?:\s+hidden)?>([\s\S]*?)<\/aionui-team-command>/gi)
    );
    if (hiddenTagMatches.length > 1) {
      return [];
    }
    for (const match of hiddenTagMatches) {
      const inner = match[1]?.trim();
      if (inner) {
        candidates.add(inner);
      }
    }

    const firstObjectMatch = rawText.match(/\{[\s\S]*\}/);
    if (firstObjectMatch?.[0]) {
      candidates.add(firstObjectMatch[0].trim());
    }

    return Array.from(candidates);
  }
}
