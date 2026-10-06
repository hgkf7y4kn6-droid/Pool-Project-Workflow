import type { SyncChange, SyncEntityType, SyncOperation } from "@pool/types";
import type { LocalDataStore, NetworkMonitor, SyncQueueStore } from "./types";

/** In-memory queue for tests and non-persistent environments. */
export class MemoryQueueStore implements SyncQueueStore {
  private ops: SyncOperation[] = [];

  async listUnsynced(): Promise<SyncOperation[]> {
    return this.ops.map((o) => ({ ...o }));
  }
  async get(id: string): Promise<SyncOperation | null> {
    const op = this.ops.find((o) => o.id === id);
    return op ? { ...op } : null;
  }
  async insert(op: SyncOperation): Promise<void> {
    this.ops.push({ ...op });
  }
  async update(op: SyncOperation): Promise<void> {
    const i = this.ops.findIndex((o) => o.id === op.id);
    if (i === -1) throw new Error(`Unknown op ${op.id}`);
    this.ops[i] = { ...op };
  }
  async remove(id: string): Promise<void> {
    this.ops = this.ops.filter((o) => o.id !== id);
  }
  async resetInFlight(): Promise<void> {
    this.ops = this.ops.map((o) => (o.status === "in_flight" ? { ...o, status: "pending" } : o));
  }
}

/** In-memory local store: `records` maps "type:id" → record. */
export class MemoryLocalStore implements LocalDataStore {
  records = new Map<string, Record<string, unknown>>();
  cursor: string | null = null;

  async applyServerChanges(changes: SyncChange[], skip: ReadonlySet<string>): Promise<void> {
    for (const c of changes) {
      const key = `${c.entityType}:${c.entityId}`;
      if (skip.has(key)) continue;
      if (c.deleted || !c.record) this.records.delete(key);
      else this.records.set(key, c.record);
    }
  }
  async applyAcknowledgement(type: SyncEntityType, id: string, version: number, record: Record<string, unknown> | null) {
    const key = `${type}:${id}`;
    this.records.set(key, { ...(this.records.get(key) ?? {}), ...(record ?? {}), version });
  }
  async applyServerRecord(type: SyncEntityType, id: string, record: Record<string, unknown>) {
    this.records.set(`${type}:${id}`, record);
  }
  async getCursor() {
    return this.cursor;
  }
  async setCursor(cursor: string | null) {
    this.cursor = cursor;
  }
}

/** Manually controlled connectivity, for tests and the web fallback. */
export class ManualNetworkMonitor implements NetworkMonitor {
  private listeners = new Set<(online: boolean) => void>();
  constructor(private online = true) {}
  async isOnline() {
    return this.online;
  }
  set(online: boolean) {
    this.online = online;
    for (const l of this.listeners) l(online);
  }
  subscribe(listener: (online: boolean) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
