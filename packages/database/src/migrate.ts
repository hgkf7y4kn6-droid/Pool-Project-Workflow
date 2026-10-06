import { migrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createDb } from "./index";

/**
 * Apply pending migrations from ./migrations. Every schema change goes
 * through a generated (or reviewed custom) migration file tracked in git and
 * recorded in the drizzle.__drizzle_migrations table — never manual DDL.
 */
export async function runMigrations(connectionString: string): Promise<void> {
  const { db, pool } = createDb({ connectionString, max: 1 });
  // MIGRATIONS_DIR lets bundled deployments (Docker) point at the copied folder.
  const migrationsFolder = process.env.MIGRATIONS_DIR ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../migrations");
  try {
    await migrate(db, { migrationsFolder });
  } finally {
    await pool.end();
  }
}
