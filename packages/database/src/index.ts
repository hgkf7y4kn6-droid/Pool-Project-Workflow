import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

export * as schema from "./schema";
export * from "./schema";

export type Database = NodePgDatabase<typeof schema>;
/** A database handle or an open transaction (both expose the same query API). */
export type DbOrTx = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * TLS to Postgres:
 * - "disable": local development and CI.
 * - "require": encrypted, server certificate not verified.
 * - "verify-full": encrypted and verified. Supabase serves a certificate from
 *   its own CA, so pass that CA (Dashboard → Database → SSL Configuration) as `ca`.
 */
export type DatabaseSsl = "disable" | "require" | "verify-full";

export interface CreateDbOptions {
  connectionString: string;
  max?: number;
  ssl?: DatabaseSsl | boolean;
  /** PEM CA certificate for "verify-full". */
  ca?: string;
  statementTimeoutMs?: number;
}

/** node-postgres lets `sslmode` in the URL override the ssl option; we configure TLS explicitly instead. */
function withoutSslParams(url: string): string {
  try {
    const u = new URL(url);
    for (const k of ["sslmode", "sslrootcert", "sslcert", "sslkey", "uselibpqcompat"]) u.searchParams.delete(k);
    return u.toString();
  } catch {
    return url;
  }
}

export function sslConfig(ssl: CreateDbOptions["ssl"], ca?: string): pg.PoolConfig["ssl"] {
  const mode = ssl === true ? "verify-full" : ssl === false || ssl === undefined ? "disable" : ssl;
  if (mode === "disable") return undefined;
  if (mode === "require") return { rejectUnauthorized: false };
  return ca ? { rejectUnauthorized: true, ca } : { rejectUnauthorized: true };
}

/** TLS settings from DATABASE_SSL / DATABASE_SSL_CA (CLI scripts; the API validates the same variables). */
export function tlsFromEnv(env: Record<string, string | undefined> = process.env): { ssl?: DatabaseSsl; ca?: string } {
  const raw = env.DATABASE_SSL;
  const ssl = raw === "true" ? "verify-full" : raw === "false" ? "disable" : (raw as DatabaseSsl | undefined) || undefined;
  if (ssl && !["disable", "require", "verify-full"].includes(ssl)) throw new Error(`DATABASE_SSL must be disable, require or verify-full (got "${raw}")`);
  const caRaw = env.DATABASE_SSL_CA;
  const ca = caRaw ? (caRaw.includes("BEGIN CERTIFICATE") ? caRaw : Buffer.from(caRaw, "base64").toString("utf8")) : undefined;
  return { ssl, ca };
}

export function createDb(options: CreateDbOptions): { db: Database; pool: pg.Pool } {
  const ssl = sslConfig(options.ssl, options.ca);
  const pool = new pg.Pool({
    connectionString: options.ssl === undefined ? options.connectionString : withoutSslParams(options.connectionString),
    max: options.max ?? 10,
    ssl,
    statement_timeout: options.statementTimeoutMs ?? 15_000,
    // Poolers (Supabase Supavisor) close idle connections; recycle ours first.
    idleTimeoutMillis: 30_000,
  });
  // Return bigint (int8) columns that drizzle reads raw (e.g. count(*)) as JS numbers.
  pg.types.setTypeParser(20, (v) => Number(v));
  const db = drizzle(pool, { schema, casing: "snake_case" });
  return { db, pool };
}
export { deleteOrganization } from "./tenant";
