/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

export const HIDDEN_TEAM_COMMAND_START_TAG = '<aionui-team-command hidden>';

const HIDDEN_TEAM_COMMAND_BLOCK_REGEX = /<\s*aionui-team-command\s+hidden\s*>\s*(?=[{[])([\s\S]*?)<\s*\/\s*aionui-team-command\s*>/gi;
const HIDDEN_TEAM_COMMAND_START_REGEX = /<\s*aionui-team-command\s+hidden\s*>\s*(?=[{[])/gi;

/**
 * Extract complete hidden team command payloads from text.
 */
export function extractHiddenTeamCommandPayloads(content: string): string[] {
  if (!content || typeof content !== 'string') {
    return [];
  }

  return Array.from(content.matchAll(HIDDEN_TEAM_COMMAND_BLOCK_REGEX), (match) => match[1]);
}

/**
 * Remove complete hidden team command payload blocks from text.
 */
export function stripCompleteHiddenTeamCommandPayloads(content: string): string {
  if (!content || typeof content !== 'string') {
    return content;
  }

  return content.replace(HIDDEN_TEAM_COMMAND_BLOCK_REGEX, '');
}

/**
 * Find the last hidden team command start that looks like a real protocol payload.
 */
export function findLastHiddenTeamCommandPayloadStart(content: string): number {
  if (!content || typeof content !== 'string') {
    return -1;
  }

  let lastMatchIndex = -1;
  for (const match of content.matchAll(HIDDEN_TEAM_COMMAND_START_REGEX)) {
    if (typeof match.index === 'number') {
      lastMatchIndex = match.index;
    }
  }

  return lastMatchIndex;
}

/**
 * Check whether text contains a real hidden team command payload.
 * Literal mentions like `<aionui-team-command hidden>` in docs are ignored.
 */
export function hasHiddenTeamCommandPayload(content: string): boolean {
  return findLastHiddenTeamCommandPayloadStart(content) >= 0;
}

/**
 * Remove hidden team command payloads, including a trailing unclosed payload block.
 */
export function stripHiddenTeamCommandPayloads(content: string): string {
  if (!content || typeof content !== 'string') {
    return content;
  }

  const withoutCompletedBlocks = stripCompleteHiddenTeamCommandPayloads(content);
  const trailingPayloadStart = findLastHiddenTeamCommandPayloadStart(withoutCompletedBlocks);
  if (trailingPayloadStart < 0) {
    return withoutCompletedBlocks;
  }

  return withoutCompletedBlocks.slice(0, trailingPayloadStart);
}
