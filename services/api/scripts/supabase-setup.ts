/**
 * One-time Supabase setup for an environment:
 *   1. applies database migrations (incl. the Data API lockdown), and
 *   2. creates the private storage bucket.
 *
 *   MIGRATION_DATABASE_URL=… DATABASE_SSL=verify-full DATABASE_SSL_CA=… \
 *   SUPABASE_URL=… SUPABASE_SECRET_KEY=… npm run supabase:setup
 */
import { LIMITS } from "@pool/config";
import { tlsFromEnv } from "@pool/database";
import { runMigrations } from "@pool/database/migrate";
import { SupabaseStorage } from "../src/adapters/storage/supabase";

const dbUrl = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
const { SUPABASE_URL, SUPABASE_SECRET_KEY } = process.env;
const bucket = process.env.SUPABASE_STORAGE_BUCKET || "pool-pm-files";
if (!dbUrl || !SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  console.error("Set MIGRATION_DATABASE_URL (or DATABASE_URL), SUPABASE_URL and SUPABASE_SECRET_KEY.");
  process.exit(1);
}

await runMigrations(dbUrl, tlsFromEnv());
console.log("✓ database migrated (tables locked down from the public Data API)");
const result = await new SupabaseStorage({ url: SUPABASE_URL, secretKey: SUPABASE_SECRET_KEY, bucket }).ensureBucket({
  fileSizeLimitBytes: LIMITS.documentBytes,
});
console.log(`✓ storage bucket "${bucket}" ${result === "created" ? "created (private)" : "already exists"}`);
