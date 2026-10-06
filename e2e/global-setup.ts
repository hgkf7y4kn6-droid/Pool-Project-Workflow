import pg from "pg";
import { createDb } from "@pool/database";
import { runMigrations } from "@pool/database/migrate";
import { seed } from "@pool/database/seed";

/** Fresh database with the demo company before every run. */
export default async function globalSetup() {
  const url = process.env.E2E_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/pool_e2e";
  const admin = new pg.Client({ connectionString: url.replace(/\/[^/]+$/, "/postgres") });
  await admin.connect();
  const dbName = url.split("/").pop()!.split("?")[0]!;
  await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${dbName}`);
  await admin.end();
  await runMigrations(url);
  const { db, pool } = createDb({ connectionString: url, max: 1 });
  await seed(db);
  await pool.end();
}
