import { describe, expect, it } from 'vitest';

import {
  extractHiddenTeamCommandPayloads,
  findLastHiddenTeamCommandPayloadStart,
  hasHiddenTeamCommandPayload,
  stripHiddenTeamCommandPayloads,
} from '@/common/chat/teamCommandText';

describe('teamCommandText', () => {
  it('detects real hidden team command payloads', () => {
    const content = 'Visible<aionui-team-command hidden>{"action":"complete"}</aionui-team-command>';

    expect(hasHiddenTeamCommandPayload(content)).toBe(true);
    expect(extractHiddenTeamCommandPayloads(content)).toEqual(['{"action":"complete"}']);
  });

  it('ignores literal mentions of the hidden tag in normal text', () => {
    const content = 'sanitize hidden `<aionui-team-command hidden>` blocks before rendering';

    expect(hasHiddenTeamCommandPayload(content)).toBe(false);
    expect(findLastHiddenTeamCommandPayloadStart(content)).toBe(-1);
    expect(stripHiddenTeamCommandPayloads(content)).toBe(content);
  });

  it('strips a trailing unclosed real payload block', () => {
    const content = 'Visible\n<aionui-team-command hidden>{"action":"delegate","taskPrompt":"x"';

    expect(stripHiddenTeamCommandPayloads(content)).toBe('Visible\n');
  });
});
