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
  // Simulate Supabase: the Data API roles exist and new tables in `public`
  // are granted to them by default (what 0002_supabase_lockdown undoes).
  await client.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  END $$`);
  await client.end();
  const seedDb = new pg.Client({ connectionString: url });
  await seedDb.connect();
  await seedDb.query("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated");
  await seedDb.query("GRANT USAGE ON SCHEMA public TO anon, authenticated");
  await seedDb.end();
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

  it("keeps every table private from Supabase's public Data API roles", async () => {
    const noRls = await db.execute<{ tablename: string }>(
      sql`select tablename from pg_tables where schemaname = 'public' and not rowsecurity order by 1`,
    );
    expect(noRls.rows.map((r) => r.tablename), "tables without row level security").toEqual([]);

    const exposed = await db.execute<{ table_name: string; grantee: string }>(
      sql`select table_name, grantee from information_schema.role_table_grants
          where table_schema = 'public' and grantee in ('anon', 'authenticated')`,
    );
    expect(exposed.rows, "grants to anon/authenticated").toEqual([]);

    // Tables created by later migrations stay private too (default privileges revoked).
    await db.execute(sql`create table public.zz_future_table (id int)`);
    const future = await db.execute<{ ok: boolean }>(sql`select has_table_privilege('anon', 'public.zz_future_table', 'select') as ok`);
    expect(future.rows[0]!.ok).toBe(false);
    await db.execute(sql`drop table public.zz_future_table`);

    // Even with an explicit grant, RLS (no policies) returns no rows to a non-owner.
    await db.execute(sql`grant select on public.organizations to anon`);
    const leaked = await db.transaction(async (tx) => {
      await tx.execute(sql`set local role anon`);
      return (await tx.execute<{ n: number }>(sql`select count(*)::int as n from public.organizations`)).rows[0]!.n;
    });
    await db.execute(sql`revoke select on public.organizations from anon`);
    expect(leaked).toBe(0);
  });
});
