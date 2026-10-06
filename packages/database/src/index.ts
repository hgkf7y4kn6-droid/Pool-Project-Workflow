import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

export * as schema from "./schema";
export * from "./schema";

export type Database = NodePgDatabase<typeof schema>;
/** A database handle or an open transaction (both expose the same query API). */
export type DbOrTx = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface CreateDbOptions {
  connectionString: string;
  max?: number;
  /** Require TLS (production). */
  ssl?: boolean;
  statementTimeoutMs?: number;
}

export function createDb(options: CreateDbOptions): { db: Database; pool: pg.Pool } {
  const pool = new pg.Pool({
    connectionString: options.connectionString,
    max: options.max ?? 10,
    ssl: options.ssl ? { rejectUnauthorized: true } : undefined,
    statement_timeout: options.statementTimeoutMs ?? 15_000,
  });
  // Return bigint (int8) columns that drizzle reads raw (e.g. count(*)) as JS numbers.
  pg.types.setTypeParser(20, (v) => Number(v));
  const db = drizzle(pool, { schema, casing: "snake_case" });
  return { db, pool };
}
