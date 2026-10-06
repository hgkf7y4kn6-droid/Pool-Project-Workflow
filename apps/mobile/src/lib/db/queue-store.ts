import type { SyncOperation } from "@pool/types";
import type { SyncQueueStore } from "@pool/sync";
import { getDb, notifyChange } from "./database";

/** Durable SQLite-backed sync queue (survives app restarts and crashes). */
export class SqliteQueueStore implements SyncQueueStore {
  async listUnsynced(): Promise<SyncOperation[]> {
    const db = await getDb();
    const rows = await db.getAllAsync<{ data: string }>("SELECT data FROM sync_queue ORDER BY seq");
    return rows.map((r) => JSON.parse(r.data) as SyncOperation);
  }
  async get(id: string): Promise<SyncOperation | null> {
    const db = await getDb();
    const row = await db.getFirstAsync<{ data: string }>("SELECT data FROM sync_queue WHERE id = ?", id);
    return row ? (JSON.parse(row.data) as SyncOperation) : null;
  }
  async insert(op: SyncOperation): Promise<void> {
    const db = await getDb();
    await db.runAsync("INSERT INTO sync_queue (id, data) VALUES (?, ?)", op.id, JSON.stringify(op));
    notifyChange(["sync_queue"]);
  }
  async update(op: SyncOperation): Promise<void> {
    const db = await getDb();
    await db.runAsync("UPDATE sync_queue SET data = ? WHERE id = ?", JSON.stringify(op), op.id);
    notifyChange(["sync_queue"]);
  }
  async remove(id: string): Promise<void> {
    const db = await getDb();
    await db.runAsync("DELETE FROM sync_queue WHERE id = ?", id);
    notifyChange(["sync_queue"]);
  }
  async resetInFlight(): Promise<void> {
    const ops = await this.listUnsynced();
    for (const op of ops) if (op.status === "in_flight") await this.update({ ...op, status: "pending" });
  }
}
