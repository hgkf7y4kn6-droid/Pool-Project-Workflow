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
  const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../migrations");
  try {
    await migrate(db, { migrationsFolder });
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  runMigrations(url)
    .then(() => console.log("Migrations applied"))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
