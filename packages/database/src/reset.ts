import pg from "pg";

/** Development only: drop and recreate the public schema. */
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
if (process.env.NODE_ENV === "production" || process.env.APP_ENV === "production") {
  throw new Error("Refusing to reset a production database");
}
const client = new pg.Client({ connectionString: url });
await client.connect();
await client.query("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
await client.end();
console.log("Database reset");
