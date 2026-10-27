import pg from "pg";

/** Development only: drop and recreate the public schema. */
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
if (process.env.NODE_ENV === "production" || process.env.APP_ENV === "production") {
  throw new Error("Refusing to reset a production database");
}
// Never on a hosted database (Supabase etc.): dropping `public` also removes
// the platform's own grants. Opt in explicitly for a throwaway remote branch.
const local = /@(localhost|127\.0\.0\.1|postgres|db)(:|\/)/.test(url);
if (!local && process.env.ALLOW_REMOTE_RESET !== "1") {
  throw new Error("Refusing to reset a remote database. Set ALLOW_REMOTE_RESET=1 if this really is a throwaway database.");
}
const client = new pg.Client({ connectionString: url });
await client.connect();
await client.query("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
await client.end();
console.log("Database reset");
