import { describe, expect, it } from 'vitest';
import { ALL_MIGRATIONS } from '@process/services/database/migrations';
import { CURRENT_DB_VERSION } from '@process/services/database/schema';

describe('database schema versioning', () => {
  it('matches the latest declared migration version', () => {
    const latestMigrationVersion = Math.max(...ALL_MIGRATIONS.map((migration) => migration.version));

    expect(CURRENT_DB_VERSION).toBe(latestMigrationVersion);
  });
});
