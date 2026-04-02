/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import {
  filterMessageContent,
  hasHiddenTeamCommandTags,
  stripHiddenTeamCommandTags,
} from '@/renderer/utils/chat/thinkTagFilter';

describe('hidden team command filtering', () => {
  describe('hasHiddenTeamCommandTags', () => {
    it('detects hidden team command blocks', () => {
      expect(hasHiddenTeamCommandTags('<aionui-team-command hidden>{"action":"delegate"}</aionui-team-command>')).toBe(
        true
      );
    });

    it('ignores literal mentions of the hidden tag', () => {
      expect(hasHiddenTeamCommandTags('sanitize hidden `<aionui-team-command hidden>` blocks')).toBe(false);
    });

    it('returns false for normal text', () => {
      expect(hasHiddenTeamCommandTags('normal visible content')).toBe(false);
    });
  });

  describe('stripHiddenTeamCommandTags', () => {
    it('removes complete hidden command blocks while preserving surrounding text', () => {
      const input = 'Before\n<aionui-team-command hidden>{"action":"complete"}</aionui-team-command>\nAfter';

      expect(stripHiddenTeamCommandTags(input)).toBe('Before\nAfter');
    });

    it('leaves malformed non-payload hidden tag text unchanged', () => {
      const input = '<aionui-team-command hidden>visible summary</aionui-team-command stray';

      expect(stripHiddenTeamCommandTags(input)).toBe(input);
    });

    it('leaves literal hidden tag mentions unchanged', () => {
      const input = 'sanitize hidden `<aionui-team-command hidden>` blocks before rendering';

      expect(stripHiddenTeamCommandTags(input)).toBe(input);
    });

    it('removes trailing unclosed hidden payloads', () => {
      const input = 'Visible\n<aionui-team-command hidden>{"action":"delegate","taskPrompt":"x"';

      expect(stripHiddenTeamCommandTags(input)).toBe('Visible');
    });

    it('leaves ordinary text unchanged', () => {
      const input = 'just a normal summary';

      expect(stripHiddenTeamCommandTags(input)).toBe(input);
    });
  });

  describe('filterMessageContent', () => {
    it('filters hidden command blocks from string content', () => {
      const input = 'Result\n<aionui-team-command hidden>{"action":"delegate"}</aionui-team-command>\nDone';

      expect(filterMessageContent(input)).toBe('Result\nDone');
    });

    it('filters both think tags and hidden command blocks from content objects', () => {
      const input = {
        content:
          '<think>internal</think>Visible\n<aionui-team-command hidden>{"action":"delegate"}</aionui-team-command>\nDone',
        other: 'preserved',
      };

      expect(filterMessageContent(input)).toEqual({
        content: 'Visible\nDone',
        other: 'preserved',
      });
    });

    it('returns non-string object content unchanged', () => {
      const input = { content: 123, other: 'preserved' };

      expect(filterMessageContent(input)).toBe(input);
    });
  });
});
