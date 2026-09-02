/**
 * Auto-approve kill-switch E2E (Phase 2, day-14) — the kill-switch + gate path.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AutoApproveKillSwitch } from '@harness/attention-engine';
import { autoApproveKillSwitch, users } from '@harness/db';
import { createTestDb, destroyTestDb } from '@harness/db/test-utils';
import type { TestDb } from '@harness/db/test-utils';
import { newUserID } from '@harness/domain';

const SCHEMA = 'e2e_auto_approve';
const TEST_USER_ID = newUserID();

let testDb: TestDb;
let killSwitch: AutoApproveKillSwitch;

beforeAll(async () => {
  testDb = await createTestDb(SCHEMA);
  killSwitch = new AutoApproveKillSwitch(testDb.db);
  await testDb.db.insert(users).values({
    id: TEST_USER_ID,
    oidc_sub: 'mock|e2e-test',
    email: 'test@example.com',
    display_name: 'E2E Test User',
    roles: [],
  });
});

afterAll(async () => {
  await destroyTestDb(testDb, SCHEMA);
});

beforeEach(async () => {
  await testDb.sql.unsafe(`
    INSERT INTO "auto_approve_kill_switch" ("id", "auto_approve_enabled", "enabled")
    VALUES ('singleton', false, true)
    ON CONFLICT ("id") DO UPDATE SET
      "auto_approve_enabled" = EXCLUDED."auto_approve_enabled",
      "enabled" = EXCLUDED."enabled",
      "killed_at" = NULL,
      "killed_by" = NULL,
      "reason" = NULL
  `);
});

describe('auto-approve kill-switch E2E (day-14)', () => {
  it('reads the singleton row correctly', async () => {
    const rows = await testDb.db.select().from(autoApproveKillSwitch);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe('singleton');
    expect(rows[0]?.auto_approve_enabled).toBe(false);
    expect(rows[0]?.enabled).toBe(true);
  });

  it('isKilled() returns true when the row is absent', async () => {
    await testDb.sql.unsafe(`DELETE FROM "auto_approve_kill_switch" WHERE "id" = 'singleton'`);
    expect(await killSwitch.isKilled()).toBe(true);
  });

  it('isKilled() returns true when enabled=false (kill-switch tripped)', async () => {
    await killSwitch.kill(TEST_USER_ID, 'e2e test');
    expect(await killSwitch.isKilled()).toBe(true);
  });

  it('isKilled() returns false when enabled=true and flag is on', async () => {
    await killSwitch.setFlagEnabled(true);
    expect(await killSwitch.isKilled()).toBe(false);
  });

  it('setFlagEnabled toggles the feature flag', async () => {
    expect(await killSwitch.isFlagEnabled()).toBe(false);
    await killSwitch.setFlagEnabled(true);
    expect(await killSwitch.isFlagEnabled()).toBe(true);
    await killSwitch.setFlagEnabled(false);
    expect(await killSwitch.isFlagEnabled()).toBe(false);
  });

  it('kill() records the actor and reason', async () => {
    await killSwitch.kill(TEST_USER_ID, 'safety shutdown');

    // Use raw SQL since Drizzle has a schema mapping issue with this table.
    const row = await testDb.sql.unsafe(
      `SELECT * FROM "auto_approve_kill_switch" WHERE "id" = 'singleton'`,
    );
    expect(row).toHaveLength(1);
    expect(row[0]?.killed_by).toBe(TEST_USER_ID);
    expect(row[0]?.reason).toBe('safety shutdown');
    expect(row[0]?.killed_at).toBeDefined();
  });
});
