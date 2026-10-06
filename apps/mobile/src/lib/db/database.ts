import * as SQLite from "expo-sqlite";

/**
 * On-device SQLite database: the source of truth for everything the field
 * app shows. The sync engine fills it from the server and every local edit
 * lands here first, so screens work identically online and offline.
 *
 * Records of all synced entity types share one table with indexed columns for
 * the common access paths (by project, by parent) and the full JSON record.
 */

const MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS records (
     type TEXT NOT NULL,
     id TEXT NOT NULL,
     project_id TEXT,
     parent_id TEXT,
     sort_key TEXT,
     version INTEGER,
     data TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     PRIMARY KEY (type, id)
   );
   CREATE INDEX IF NOT EXISTS records_project ON records(type, project_id, sort_key);
   CREATE INDEX IF NOT EXISTS records_parent ON records(type, parent_id, sort_key);
   CREATE TABLE IF NOT EXISTS sync_queue (
     seq INTEGER PRIMARY KEY AUTOINCREMENT,
     id TEXT NOT NULL UNIQUE,
     data TEXT NOT NULL
   );
   CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
   CREATE TABLE IF NOT EXISTS uploads (
     photo_id TEXT PRIMARY KEY,
     local_uri TEXT NOT NULL,
     mime_type TEXT NOT NULL,
     status TEXT NOT NULL,
     attempts INTEGER NOT NULL DEFAULT 0,
     last_error TEXT,
     ticket TEXT,
     next_attempt_at TEXT,
     updated_at TEXT NOT NULL
   );
   CREATE TABLE IF NOT EXISTS offline_files (
     document_id TEXT PRIMARY KEY,
     version_id TEXT NOT NULL,
     local_uri TEXT NOT NULL,
     file_name TEXT NOT NULL,
     mime_type TEXT NOT NULL,
     saved_at TEXT NOT NULL
   );`,
];

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync("pool-pm.db");
      await db.execAsync("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
      const row = await db.getFirstAsync<{ user_version: number }>("PRAGMA user_version");
      const current = row?.user_version ?? 0;
      for (let v = current; v < MIGRATIONS.length; v++) {
        await db.withTransactionAsync(async () => {
          await db.execAsync(MIGRATIONS[v]!);
          await db.execAsync(`PRAGMA user_version = ${v + 1}`);
        });
      }
      return db;
    })();
  }
  return dbPromise;
}

// --- Change notifications ------------------------------------------------------

type ChangeListener = (types: ReadonlySet<string>) => void;
const listeners = new Set<ChangeListener>();
let pending = new Set<string>();
let scheduled = false;

/** Batch change notifications per tick so a sync page triggers one re-render. */
export function notifyChange(types: Iterable<string>): void {
  for (const t of types) pending.add(t);
  if (scheduled) return;
  scheduled = true;
  setTimeout(() => {
    const batch = pending;
    pending = new Set();
    scheduled = false;
    listeners.forEach((l) => l(batch));
  }, 0);
}

export function subscribeChanges(listener: ChangeListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function getMeta(key: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM meta WHERE key = ?", key);
  return row?.value ?? null;
}

export async function setMeta(key: string, value: string | null): Promise<void> {
  const db = await getDb();
  if (value === null) await db.runAsync("DELETE FROM meta WHERE key = ?", key);
  else await db.runAsync("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, value);
}

/** Wipe all local data (sign-out / account switch). Unsynced changes must be confirmed by the caller first. */
export async function resetLocalData(): Promise<void> {
  const db = await getDb();
  await db.execAsync("DELETE FROM records; DELETE FROM sync_queue; DELETE FROM meta; DELETE FROM uploads; DELETE FROM offline_files;");
  notifyChange(["*"]);
}
