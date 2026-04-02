/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TeamCommand } from './teamTypes';
import { TeamCommandDetector } from './TeamCommandDetector';

const HIDDEN_TEAM_COMMAND_REGEX = /<aionui-team-command\s+hidden>\s*([\s\S]*?)\s*<\/aionui-team-command>/gi;
const HIDDEN_TEAM_COMMAND_START_TAG = '<aionui-team-command hidden>';

export class TeamHiddenCommandCodec {
  constructor(private readonly detector: TeamCommandDetector = new TeamCommandDetector()) {}

  extractCommands(rawText: string): TeamCommand[] {
    if (!rawText) {
      return [];
    }

    const commands: TeamCommand[] = [];
    const matches = rawText.matchAll(HIDDEN_TEAM_COMMAND_REGEX);
    for (const match of matches) {
      const parsed = this.detector.parse(match[1]);
      if (parsed) {
        commands.push(parsed);
      }
    }
    return commands;
  }

  stripCommands(rawText: string): string {
    if (!rawText) {
      return rawText;
    }

    return rawText.replace(HIDDEN_TEAM_COMMAND_REGEX, '').trim();
  }

  stripIncrementally(rawStreamBuffer: string): string {
    if (!rawStreamBuffer) {
      return rawStreamBuffer;
    }

    // Remove completed hidden command blocks first.
    const withoutCompleted = rawStreamBuffer.replace(HIDDEN_TEAM_COMMAND_REGEX, '');
    // If a full start tag is present without a matching closing tag yet, hide from that start.
    const partialStart = withoutCompleted.lastIndexOf(HIDDEN_TEAM_COMMAND_START_TAG);
    if (partialStart < 0) {
      // Also hide a trailing partial prefix of the start tag to avoid leaking split chunks
      // like "<aionui-team-com" during streaming.
      const trailingPrefixLength = this.getTrailingStartTagPrefixLength(withoutCompleted);
      if (trailingPrefixLength > 0) {
        return withoutCompleted.slice(0, -trailingPrefixLength);
      }
      return withoutCompleted;
    }
    return withoutCompleted.slice(0, partialStart);
  }

  private getTrailingStartTagPrefixLength(text: string): number {
    if (!text || !text.includes('<')) {
      return 0;
    }

    const maxLength = Math.min(text.length, HIDDEN_TEAM_COMMAND_START_TAG.length - 1);
    for (let length = maxLength; length > 0; length -= 1) {
      const suffix = text.slice(-length);
      if (HIDDEN_TEAM_COMMAND_START_TAG.startsWith(suffix)) {
        return length;
      }
    }

    return 0;
  }
}
