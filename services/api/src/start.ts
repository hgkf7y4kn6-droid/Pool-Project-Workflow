/**
 * Container entry point: apply pending database migrations, then start the
 * API. Migrations are idempotent and run inside one transaction, so a deploy
 * either moves the schema forward or fails before serving traffic.
 * Set SKIP_MIGRATIONS=1 to start without migrating (e.g. extra replicas).
 */
import { tlsFromEnv } from "@pool/database";
import { runMigrations } from "@pool/database/migrate";

if (process.env.SKIP_MIGRATIONS !== "1") {
  const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  await runMigrations(url, tlsFromEnv());
  console.log("Migrations applied");
}
await import("./server");
