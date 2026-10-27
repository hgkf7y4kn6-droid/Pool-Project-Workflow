/**
 * Container entry point: apply pending database migrations, then start the
 * API. Migrations are idempotent and run inside one transaction, so a deploy
 * either moves the schema forward or fails before serving traffic.
 * Set SKIP_MIGRATIONS=1 to start without migrating (e.g. extra replicas).
 */
import { tlsFromEnv } from "@pool/database";
import { runMigrations } from "@pool/database/migrate";

/** Host and port only, so the log never contains the password. */
function describeTarget(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port || "5432"} as ${decodeURIComponent(u.username)}`;
  } catch {
    return "an unparseable DATABASE_URL";
  }
}

if (process.env.SKIP_MIGRATIONS !== "1") {
  const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  const target = describeTarget(url);
  console.log(`Applying migrations to ${target}`);
  try {
    await runMigrations(url, tlsFromEnv());
  } catch (err) {
    // Drizzle wraps driver errors; the cause holds the useful part (timeout, bad password, TLS).
    const cause = err instanceof Error && err.cause instanceof Error ? err.cause.message : undefined;
    console.error(`Migrations failed against ${target}: ${cause ?? (err instanceof Error ? err.message : String(err))}`);
    // Supabase's direct host is IPv6-only; most hosts (Render included) need the pooler.
    if (/@db\.[a-z0-9]+\.supabase\.co[:/]/.test(url)) {
      console.error("This is Supabase's direct connection (IPv6 only). Use Connect → Session pooler instead (*.pooler.supabase.com:5432).");
    }
    process.exit(1);
  }
  console.log("Migrations applied");
}
await import("./server");
