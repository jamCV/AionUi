import { describe, expect, it } from 'vitest';

import { TeamHiddenCommandCodec } from '@/process/team/TeamHiddenCommandCodec';

const consumeStreamingChunks = (chunks: string[]): string => {
  const codec = new TeamHiddenCommandCodec();
  let raw = '';
  let visibleLength = 0;
  let visible = '';

  for (const chunk of chunks) {
    raw += chunk;
    const nextVisible = codec.stripIncrementally(raw);
    const delta = nextVisible.slice(visibleLength);
    visibleLength = nextVisible.length;
    visible += delta;
  }

  return visible;
};

describe('TeamHiddenCommandCodec', () => {
  it('hides split start-tag prefixes during streaming and never leaks hidden protocol', () => {
    const visible = consumeStreamingChunks([
      'Before <aionui-team-com',
      'mand hidden>{"action":"complete","summary":"done"}',
      '</aionui-team-command> After',
    ]);

    expect(visible).toBe('Before  After');
    expect(visible).not.toContain('<aionui-team-command');
  });

  it('keeps normal content visible when no hidden protocol exists', () => {
    const codec = new TeamHiddenCommandCodec();
    expect(codec.stripIncrementally('normal content')).toBe('normal content');
  });

  it('preserves literal mentions of the hidden tag in visible text', () => {
    const visible = consumeStreamingChunks([
      'sanitize hidden `<aionui-team-com',
      'mand hidden>` blocks before rendering',
    ]);

    expect(visible).toBe('sanitize hidden `<aionui-team-command hidden>` blocks before rendering');
  });

  it('extracts and strips hidden command blocks', () => {
    const codec = new TeamHiddenCommandCodec();
    const raw =
      'x<aionui-team-command hidden>{"action":"complete","summary":"done"}</aionui-team-command>y';

    expect(codec.extractCommands(raw)).toEqual([{ action: 'complete', summary: 'done' }]);
    expect(codec.stripCommands(raw)).toBe('xy');
  });

  it('does not treat literal tag mentions as commands', () => {
    const codec = new TeamHiddenCommandCodec();
    const raw = 'sanitize hidden `<aionui-team-command hidden>` blocks before rendering';

    expect(codec.extractCommands(raw)).toEqual([]);
    expect(codec.stripCommands(raw)).toBe(raw);
  });
});
