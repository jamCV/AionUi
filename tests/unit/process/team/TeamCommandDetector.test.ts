import { describe, expect, it } from 'vitest';

import { TeamCommandDetector } from '@/process/team/TeamCommandDetector';

describe('TeamCommandDetector', () => {
  const detector = new TeamCommandDetector();

  it('parses a valid delegate command and normalizes optional fields', () => {
    const command = detector.parse(`
      intro
      <aionui-team-command>
      {
        "action": "delegate",
        "title": "Investigate bug",
        "taskPrompt": "Check the failing workflow",
        "expectedOutput": "Root cause and patch plan",
        "recommendedAssistantId": " researcher ",
        "candidateAssistantIds": [" builtin-researcher ", "", "helper"],
        "ownedPaths": [" src/app.ts ", "tests/app.test.ts"],
        "blocking": true
      }
      </aionui-team-command>
    `);

    expect(command).toEqual({
      action: 'delegate',
      title: 'Investigate bug',
      taskPrompt: 'Check the failing workflow',
      expectedOutput: 'Root cause and patch plan',
      recommendedAssistantId: 'researcher',
      candidateAssistantIds: ['builtin-researcher', 'helper'],
      ownedPaths: ['src/app.ts', 'tests/app.test.ts'],
      blocking: true,
    });
  });

  it('returns null for invalid delegate payloads and multiple command blocks', () => {
    expect(
      detector.parse(`
        <aionui-team-command>{"action":"delegate","title":"Missing prompt"}</aionui-team-command>
      `)
    ).toBeNull();

    expect(
      detector.parse(`
        <aionui-team-command>{"action":"complete","summary":"done"}</aionui-team-command>
        <aionui-team-command>{"action":"complete","summary":"done twice"}</aionui-team-command>
      `)
    ).toBeNull();
  });

  it('parses a valid complete command', () => {
    expect(
      detector.parse(`
        <aionui-team-command>
        {"action":"complete","summary":"Patch applied and verified."}
        </aionui-team-command>
      `)
    ).toEqual({
      action: 'complete',
      summary: 'Patch applied and verified.',
    });
  });
});
