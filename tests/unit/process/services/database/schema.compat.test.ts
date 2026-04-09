import { afterEach, describe, expect, it } from 'vitest';
import { BetterSqlite3Driver } from '@process/services/database/drivers/BetterSqlite3Driver';
import { initSchema } from '@process/services/database/schema';

let nativeModuleAvailable = true;
try {
  const db = new BetterSqlite3Driver(':memory:');
  db.close();
} catch (error) {
  if (error instanceof Error && error.message.includes('NODE_MODULE_VERSION')) {
    nativeModuleAvailable = false;
  }
}

const describeOrSkip = nativeModuleAvailable ? describe : describe.skip;

describeOrSkip('initSchema legacy compatibility', () => {
  let driver: BetterSqlite3Driver;

  afterEach(() => {
    driver?.close();
  });

  it('archives legacy team_tasks tables that do not match the current schema', () => {
    driver = new BetterSqlite3Driver(':memory:');
    driver.exec(`CREATE TABLE team_tasks (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      parent_conversation_id TEXT,
      sub_conversation_id TEXT,
      assistant_id TEXT,
      assistant_name TEXT,
      status TEXT,
      title TEXT,
      task_prompt TEXT,
      expected_output TEXT,
      selection_mode TEXT,
      selection_reason TEXT,
      owned_paths_json TEXT,
      last_error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`);

    initSchema(driver);

    const tableNames = (
      driver.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'team_tasks%' ORDER BY name").all() as Array<{
        name: string;
      }>
    ).map((row) => row.name);

    expect(tableNames).toContain('team_tasks');
    expect(tableNames.some((name) => name.startsWith('team_tasks_legacy_'))).toBe(true);

    const columns = (driver.pragma('table_info(team_tasks)') as Array<{ name: string }>).map((column) => column.name);
    expect(columns).toContain('team_id');
    expect(columns).toContain('subject');
    expect(columns).toContain('metadata');
  });
});
