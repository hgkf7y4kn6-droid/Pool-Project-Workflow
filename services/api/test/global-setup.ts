import pg from "pg";
import { createDb } from "@pool/database";
import { runMigrations } from "@pool/database/migrate";
import { seed } from "@pool/database/seed";

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres@localhost:5432/pool_test";

/** Fresh schema + migrations + demo seed once per test run. */
export default async function setup() {
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  await client.query("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
  await client.end();
  await runMigrations(TEST_DATABASE_URL);
  const { db, pool } = createDb({ connectionString: TEST_DATABASE_URL, max: 1 });
  await seed(db, { force: true });
  await pool.end();
}
