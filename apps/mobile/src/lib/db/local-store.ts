import type { SyncChange, SyncEntityType } from "@pool/types";
import type { LocalDataStore } from "@pool/sync";
import { getMeta, setMeta } from "./database";
import { deleteRecords, getRecord, retainProjects, upsertRecords, type LocalRecord, type RecordType } from "./records";
import { registerUploadTicket } from "../sync/uploads";

const CURSOR_KEY = "sync.cursor";

/** Applies pulled changes and push acknowledgements to the local database. */
export class SqliteLocalStore implements LocalDataStore {
  async applyServerChanges(changes: SyncChange[], skip: ReadonlySet<string>): Promise<void> {
    const upserts = new Map<RecordType, LocalRecord[]>();
    const deletes = new Map<RecordType, string[]>();
    for (const c of changes) {
      // Local edits waiting to upload win until the server acknowledges them.
      if (skip.has(`${c.entityType}:${c.entityId}`)) continue;
      const type = c.entityType as RecordType;
      if (c.deleted || !c.record) {
        if (!deletes.has(type)) deletes.set(type, []);
        deletes.get(type)!.push(c.entityId);
      } else {
        if (!upserts.has(type)) upserts.set(type, []);
        // Keep device-only fields (e.g. the local photo file) across server updates.
        upserts.get(type)!.push(c.record as LocalRecord);
      }
    }
    for (const [type, rows] of upserts) {
      if (type === "photo") {
        for (const r of rows) {
          const existing = await getRecord<LocalRecord>("photo", r.id);
          if (existing?.localUri) r.localUri = existing.localUri;
        }
      }
      await upsertRecords(type, rows);
    }
    for (const [type, ids] of deletes) await deleteRecords(type, ids);
  }

  async applyAcknowledgement(type: SyncEntityType, id: string, version: number, record: Record<string, unknown> | null): Promise<void> {
    const existing = await getRecord<LocalRecord>(type as RecordType, id);
    if (record && "deleted" in record && record.deleted) {
      await deleteRecords(type as RecordType, [id]);
      return;
    }
    const { upload, ...rest } = (record ?? {}) as Record<string, unknown> & { upload?: unknown };
    const merged = { ...(existing ?? {}), ...rest, id, version } as LocalRecord;
    if (existing?.localUri) merged.localUri = existing.localUri;
    await upsertRecords(type as RecordType, [merged]);
    if (type === "photo" && upload) await registerUploadTicket(id, upload as never);
  }

  async applyServerRecord(type: SyncEntityType, id: string, record: Record<string, unknown>): Promise<void> {
    await upsertRecords(type as RecordType, [{ ...record, id } as LocalRecord]);
  }

  async retainProjects(projectIds: string[]): Promise<void> {
    await retainProjects(projectIds);
  }

  getCursor() {
    return getMeta(CURSOR_KEY);
  }

  setCursor(cursor: string | null) {
    return setMeta(CURSOR_KEY, cursor);
  }
}
