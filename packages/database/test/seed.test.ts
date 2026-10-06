import pg from "pg";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "../src";
import { runMigrations } from "../src/migrate";
import { seed } from "../src/seed";

// Uses its own database so it can run alongside the API integration tests.
const admin = process.env.TEST_DATABASE_URL ?? "postgres://postgres@localhost:5432/pool_test";
const url = admin.replace(/\/[^/]+$/, "/pool_test_seed");

beforeAll(async () => {
  const client = new pg.Client({ connectionString: admin });
  await client.connect();
  await client.query("DROP DATABASE IF EXISTS pool_test_seed WITH (FORCE)");
  await client.query("CREATE DATABASE pool_test_seed");
  await client.end();
  await runMigrations(url);
}, 60_000);

const { db, pool } = createDb({ connectionString: url, max: 2 });
afterAll(() => pool.end());

describe("migrations + seed", () => {
  it("seeds the demo company and can recreate it (tenant delete)", async () => {
    const first = await seed(db, { today: "2026-10-06" });
    expect(first?.organizationId).toBeTruthy();
    expect(await seed(db)).toBeNull(); // idempotent without --force
    const second = await seed(db, { force: true, today: "2026-10-06" });
    expect(second?.organizationId).not.toBe(first?.organizationId);
    const { rows } = await db.execute<{ n: number }>(sql`select count(*)::int as n from organizations`);
    expect(rows[0]!.n).toBe(1);
  }, 60_000);

  it("bumps version and change_seq on every update (sync triggers)", async () => {
    const before = await db.execute<{ id: string; version: number; change_seq: number }>(sql`select id, version, change_seq from tasks limit 1`);
    const t = before.rows[0]!;
    await db.execute(sql`update tasks set title = title || '!' where id = ${t.id}`);
    const after = (await db.execute<{ version: number; change_seq: number }>(sql`select version, change_seq from tasks where id = ${t.id}`)).rows[0]!;
    expect(after.version).toBe(t.version + 1);
    expect(Number(after.change_seq)).toBeGreaterThan(Number(t.change_seq));
    const mark = (await db.execute<{ m: number }>(sql`select sync_high_water_mark() as m`)).rows[0]!;
    expect(Number(mark.m)).toBeGreaterThanOrEqual(Number(after.change_seq));
  });
});
