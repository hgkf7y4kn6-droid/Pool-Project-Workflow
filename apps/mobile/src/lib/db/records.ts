import type { PullEntityType } from "@pool/types";
import { getDb, notifyChange } from "./database";

export type RecordType = PullEntityType;
export type LocalRecord = Record<string, unknown> & { id: string; version?: number };

/** How each entity type is indexed locally. */
const INDEX: Record<RecordType, { project: (r: LocalRecord) => unknown; parent?: (r: LocalRecord) => unknown; sort?: (r: LocalRecord) => unknown }> = {
  project: { project: (r) => r.id, sort: (r) => r.updatedAt },
  client: { project: () => null, sort: (r) => `${r.lastName ?? ""} ${r.firstName ?? ""}` },
  property: { project: () => null, parent: (r) => r.clientId },
  stage: { project: (r) => r.projectId, sort: (r) => String(r.sortOrder ?? 0).padStart(4, "0") },
  task: { project: (r) => r.projectId, parent: (r) => r.stageId, sort: (r) => r.plannedStartDate ?? r.dueDate ?? "9999" },
  task_dependency: { project: (r) => r.projectId, parent: (r) => r.successorId },
  checklist_item: { project: (r) => r.projectId, parent: (r) => r.taskId, sort: (r) => String(r.sortOrder ?? 0).padStart(4, "0") },
  task_note: { project: (r) => r.projectId, parent: (r) => r.taskId, sort: (r) => r.createdAt },
  labor_entry: { project: (r) => r.projectId, parent: (r) => r.taskId, sort: (r) => r.workDate },
  expense: { project: (r) => r.projectId, sort: (r) => r.incurredOn },
  measurement: { project: (r) => r.projectId, parent: (r) => r.category, sort: (r) => r.label },
  photo: { project: (r) => r.projectId, parent: (r) => r.taskId, sort: (r) => r.takenAt },
  inspection: { project: (r) => r.projectId, sort: (r) => r.scheduledFor ?? r.createdAt },
  document: { project: (r) => r.projectId, parent: (r) => r.category, sort: (r) => r.title },
  change_order: { project: (r) => r.projectId, sort: (r) => String(r.number ?? 0).padStart(5, "0") },
  message: { project: (r) => r.projectId, parent: (r) => r.threadKey, sort: (r) => r.createdAt },
  activity: { project: (r) => r.projectId, sort: (r) => r.createdAt },
};

const str = (v: unknown) => (v === null || v === undefined ? null : String(v));

export async function upsertRecords(type: RecordType, records: LocalRecord[]): Promise<void> {
  if (!records.length) return;
  const db = await getDb();
  const idx = INDEX[type];
  const now = new Date().toISOString();
  await db.withTransactionAsync(async () => {
    for (const r of records) {
      await db.runAsync(
        `INSERT INTO records (type, id, project_id, parent_id, sort_key, version, data, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(type, id) DO UPDATE SET project_id = excluded.project_id, parent_id = excluded.parent_id,
           sort_key = excluded.sort_key, version = excluded.version, data = excluded.data, updated_at = excluded.updated_at`,
        type,
        r.id,
        str(idx.project(r)),
        str(idx.parent?.(r)),
        str(idx.sort?.(r)),
        typeof r.version === "number" ? r.version : null,
        JSON.stringify(r),
        now,
      );
    }
  });
  notifyChange([type]);
}

export async function deleteRecords(type: RecordType, ids: string[]): Promise<void> {
  if (!ids.length) return;
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const id of ids) await db.runAsync("DELETE FROM records WHERE type = ? AND id = ?", type, id);
  });
  notifyChange([type]);
}

export async function getRecord<T = LocalRecord>(type: RecordType, id: string): Promise<T | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ data: string }>("SELECT data FROM records WHERE type = ? AND id = ?", type, id);
  return row ? (JSON.parse(row.data) as T) : null;
}

export interface ListOptions {
  projectId?: string;
  parentId?: string | null;
  /** Extra SQL condition on the JSON (json_extract(data, '$.field')). */
  where?: string;
  params?: (string | number | null)[];
  order?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

export async function listRecords<T = LocalRecord>(type: RecordType, options: ListOptions = {}): Promise<T[]> {
  const db = await getDb();
  const clauses = ["type = ?"];
  const params: (string | number | null)[] = [type];
  if (options.projectId) {
    clauses.push("project_id = ?");
    params.push(options.projectId);
  }
  if (options.parentId !== undefined) {
    if (options.parentId === null) clauses.push("parent_id IS NULL");
    else {
      clauses.push("parent_id = ?");
      params.push(options.parentId);
    }
  }
  if (options.where) {
    clauses.push(`(${options.where})`);
    params.push(...(options.params ?? []));
  }
  const sql = `SELECT data FROM records WHERE ${clauses.join(" AND ")} ORDER BY sort_key ${options.order === "desc" ? "DESC" : "ASC"}, id
    ${options.limit ? `LIMIT ${Math.floor(options.limit)} OFFSET ${Math.floor(options.offset ?? 0)}` : ""}`;
  const rows = await db.getAllAsync<{ data: string }>(sql, ...params);
  return rows.map((r) => JSON.parse(r.data) as T);
}

export async function countRecords(type: RecordType, options: Pick<ListOptions, "projectId" | "where" | "params"> = {}): Promise<number> {
  const db = await getDb();
  const clauses = ["type = ?"];
  const params: (string | number | null)[] = [type];
  if (options.projectId) {
    clauses.push("project_id = ?");
    params.push(options.projectId);
  }
  if (options.where) {
    clauses.push(`(${options.where})`);
    params.push(...(options.params ?? []));
  }
  const row = await db.getFirstAsync<{ n: number }>(`SELECT count(*) AS n FROM records WHERE ${clauses.join(" AND ")}`, ...params);
  return row?.n ?? 0;
}

/** Remove records belonging to projects the user can no longer access. */
export async function retainProjects(projectIds: string[]): Promise<void> {
  const db = await getDb();
  const placeholders = projectIds.map(() => "?").join(",");
  await db.runAsync(
    `DELETE FROM records WHERE project_id IS NOT NULL AND type <> 'client' ${projectIds.length ? `AND project_id NOT IN (${placeholders})` : ""}`,
    ...projectIds,
  );
  notifyChange(["*"]);
}
