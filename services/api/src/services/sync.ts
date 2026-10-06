import { and, asc, eq, gt, inArray, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { threeWayMerge } from "@pool/sync";
import { can } from "@pool/core";
import {
  activityLogs,
  changeOrders,
  checklistItems,
  clients,
  documents,
  expenses,
  inspections,
  laborEntries,
  measurements,
  messages,
  photos,
  projectStages,
  projects,
  properties,
  syncOperations,
  taskDependencies,
  taskNotes,
  tasks,
  type DbOrTx,
} from "@pool/database";
import type {
  PullEntityType,
  SyncChange,
  SyncPullResponse,
  SyncPushOperation,
  SyncPushResult,
} from "@pool/types";
import {
  createTaskSchema,
  expenseSchema,
  inspectionSchema,
  laborEntrySchema,
  measurementSchema,
  messageSchema,
  photoCreateSchema,
  photoUpdateSchema,
  taskNoteSchema,
  updateInspectionSchema,
  updateMeasurementSchema,
  updateTaskSchema,
  z,
  type SyncPullInput,
  type SyncPushInput,
} from "@pool/validation";
import type { Ctx } from "../context";
import { AppError } from "../lib/errors";
import { parse } from "../lib/validate";
import { accessibleProjectIds, hasPermission } from "./access";
import { createExpense, createLaborEntry, deleteExpense, deleteLaborEntry } from "./budget";
import { createInspection, updateInspection } from "./inspections";
import { measurementOut, photoOut, propertyOut, strip } from "./mappers";
import { createMeasurement, deleteMeasurement, updateMeasurement } from "./measurements";
import { sendMessage } from "./messages";
import { createPhoto, deletePhoto, updatePhoto } from "./photos";
import { addTaskNote, applyChecklistToggle, applyTaskUpdate, createTask, deleteTask, loadTask } from "./tasks";

/*
 * Push: apply offline operations in order. Each op runs in its own
 * transaction, is logged by id for idempotency, and is version-checked with
 * a per-field three-way merge so concurrent edits to different fields never
 * conflict. Pull: return rows changed since the device's cursor, up to a
 * high-water mark guaranteed to be fully committed (see migration 0001).
 */

type Handler = (ctx: Ctx, op: SyncPushOperation, tx: DbOrTx) => Promise<{ version: number; record: Record<string, unknown> }>;

interface VersionedTable {
  table: PgTable;
  id: unknown;
  version: unknown;
}

async function currentRow(tx: DbOrTx, table: typeof tasks | typeof checklistItems | typeof measurements | typeof inspections | typeof photos, id: string) {
  const [row] = await tx.select().from(table).where(eq(table.id, id)).limit(1);
  return row as (Record<string, unknown> & { version: number; deletedAt: string | null }) | undefined;
}

class SyncConflict extends Error {
  constructor(
    readonly serverVersion: number,
    readonly serverRecord: Record<string, unknown>,
    readonly fields: string[],
  ) {
    super("conflict");
  }
}

/** Version check + merge for updates. Returns the fields that should be applied. */
async function mergeUpdate(
  tx: DbOrTx,
  table: typeof tasks | typeof checklistItems | typeof measurements | typeof inspections | typeof photos,
  op: SyncPushOperation,
): Promise<Record<string, unknown>> {
  const row = await currentRow(tx, table, op.entityId);
  if (!row || row.deletedAt) throw new AppError("not_found", "This record was deleted on the server");
  if (op.baseVersion === null || op.baseVersion === row.version || op.force) return op.payload;
  const { merged, conflictingFields } = threeWayMerge(op.payload, op.baseValues, row);
  if (conflictingFields.length) {
    const { changeSeq: _s, ...serverRecord } = row;
    throw new SyncConflict(row.version, serverRecord, conflictingFields);
  }
  return merged;
}

const projectIdOf = (op: SyncPushOperation): string => {
  if (!op.projectId) throw new AppError("bad_request", "projectId is required");
  return op.projectId;
};

const HANDLERS: Record<string, Handler> = {
  "task:create": async (ctx, op, tx) => {
    const input = parse(createTaskSchema, { ...op.payload, id: op.entityId });
    const task = await createTask(ctx, projectIdOf(op), input, tx);
    return { version: task.version, record: task };
  },
  "task:update": async (ctx, op, tx) => {
    const fields = await mergeUpdate(tx, tasks, op);
    const task = await loadTask(ctx, op.entityId, tx);
    const input = parse(updateTaskSchema.extend({ override: z.boolean().optional(), overrideReason: z.string().max(1000).nullish() }), fields);
    const updated = await applyTaskUpdate(ctx, task, input, tx);
    return { version: updated.version, record: strip(updated) };
  },
  "task:delete": async (ctx, op, tx) => {
    void tx;
    await deleteTask(ctx, op.entityId);
    return { version: 0, record: { id: op.entityId, deleted: true } };
  },
  "checklist_item:update": async (ctx, op, tx) => {
    const fields = await mergeUpdate(tx, checklistItems, op);
    if (typeof fields.isChecked !== "boolean") throw new AppError("bad_request", "Only isChecked can be changed offline");
    const row = await applyChecklistToggle(ctx, op.entityId, fields.isChecked, tx);
    return { version: row.version, record: strip(row) };
  },
  "task_note:create": async (ctx, op, tx) => {
    const input = parse(taskNoteSchema, { ...op.payload, id: op.entityId });
    const taskId = String(op.payload.taskId ?? "");
    const note = await addTaskNote(ctx, taskId, input, tx);
    return { version: note.version, record: note };
  },
  "labor_entry:create": async (ctx, op, tx) => {
    const input = parse(laborEntrySchema, { ...op.payload, id: op.entityId });
    const row = await createLaborEntry(ctx, projectIdOf(op), input, tx);
    return { version: row.version, record: row };
  },
  "labor_entry:delete": async (ctx, op) => {
    await deleteLaborEntry(ctx, projectIdOf(op), op.entityId);
    return { version: 0, record: { id: op.entityId, deleted: true } };
  },
  "expense:create": async (ctx, op, tx) => {
    const input = parse(expenseSchema, { ...op.payload, id: op.entityId });
    const row = await createExpense(ctx, projectIdOf(op), input, tx);
    return { version: row.version, record: row };
  },
  "expense:delete": async (ctx, op) => {
    await deleteExpense(ctx, projectIdOf(op), op.entityId);
    return { version: 0, record: { id: op.entityId, deleted: true } };
  },
  "measurement:create": async (ctx, op, tx) => {
    const input = parse(measurementSchema, { ...op.payload, id: op.entityId });
    const row = await createMeasurement(ctx, projectIdOf(op), input, tx);
    return { version: row.version, record: row };
  },
  "measurement:update": async (ctx, op, tx) => {
    const fields = await mergeUpdate(tx, measurements, op);
    const row = await updateMeasurement(ctx, op.entityId, parse(updateMeasurementSchema, fields), tx);
    return { version: row.version, record: row };
  },
  "measurement:delete": async (ctx, op) => {
    await deleteMeasurement(ctx, op.entityId);
    return { version: 0, record: { id: op.entityId, deleted: true } };
  },
  "photo:create": async (ctx, op, tx) => {
    const input = parse(photoCreateSchema, { ...op.payload, id: op.entityId });
    const { photo, upload } = await createPhoto(ctx, projectIdOf(op), input, tx);
    // The device uses `upload` to PUT the file once it has bandwidth.
    return { version: photo.version, record: { ...photo, upload } };
  },
  "photo:update": async (ctx, op, tx) => {
    const fields = await mergeUpdate(tx, photos, op);
    const row = await updatePhoto(ctx, op.entityId, parse(photoUpdateSchema, fields));
    return { version: row.version, record: row };
  },
  "photo:delete": async (ctx, op) => {
    await deletePhoto(ctx, op.entityId);
    return { version: 0, record: { id: op.entityId, deleted: true } };
  },
  "inspection:create": async (ctx, op, tx) => {
    const input = parse(inspectionSchema, { ...op.payload, id: op.entityId });
    const row = await createInspection(ctx, projectIdOf(op), input, tx);
    return { version: row.version, record: row };
  },
  "inspection:update": async (ctx, op, tx) => {
    const fields = await mergeUpdate(tx, inspections, op);
    const row = await updateInspection(ctx, op.entityId, parse(updateInspectionSchema, fields), tx);
    return { version: row.version, record: row };
  },
  "message:create": async (ctx, op, tx) => {
    const input = parse(messageSchema, { ...op.payload, id: op.entityId });
    const row = await sendMessage(ctx, projectIdOf(op), input, tx);
    return { version: row.version, record: row };
  },
};

const RETRYABLE: ReadonlySet<string> = new Set(["not_found", "internal_error", "service_unavailable", "rate_limited"]);

export async function pushOperations(ctx: Ctx, input: SyncPushInput): Promise<SyncPushResult[]> {
  const results: SyncPushResult[] = [];
  for (const op of input.operations as SyncPushOperation[]) {
    const [logged] = await ctx.deps.db.select().from(syncOperations).where(eq(syncOperations.id, op.id)).limit(1);
    if (logged?.status === "applied") {
      results.push({ id: op.id, status: "duplicate", version: logged.resultVersion });
      continue;
    }
    const log = async (status: "applied" | "conflict" | "rejected", version: number | null, errorCode: string | null) => {
      await ctx.deps.db
        .insert(syncOperations)
        .values({
          id: op.id,
          organizationId: ctx.auth.organizationId,
          userId: ctx.auth.userId,
          deviceId: input.deviceId,
          projectId: op.projectId,
          entityType: op.entityType,
          entityId: op.entityId,
          operation: op.operation,
          status,
          resultVersion: version,
          errorCode,
          clientCreatedAt: op.createdAt,
        })
        .onConflictDoUpdate({ target: syncOperations.id, set: { status, resultVersion: version, errorCode, receivedAt: new Date().toISOString() } });
    };

    const handler = HANDLERS[`${op.entityType}:${op.operation}`];
    if (!handler) {
      await log("rejected", null, "unsupported");
      results.push({ id: op.id, status: "rejected", code: "unsupported", message: `${op.operation} ${op.entityType} is not supported offline`, retryable: false });
      continue;
    }
    try {
      const outcome = await ctx.deps.db.transaction(async (tx) => {
        // An offline "create" retried after a lost response may already exist.
        if (op.operation === "create") {
          const existing = await existingVersion(tx, op);
          if (existing !== null) return { version: existing, record: { id: op.entityId }, duplicate: true };
        }
        return { ...(await handler(ctx, op, tx)), duplicate: false };
      });
      await log("applied", outcome.version, null);
      results.push(
        outcome.duplicate
          ? { id: op.id, status: "duplicate", version: outcome.version }
          : { id: op.id, status: "applied", version: outcome.version, record: outcome.record },
      );
    } catch (error) {
      if (error instanceof SyncConflict) {
        await log("conflict", error.serverVersion, "conflict");
        results.push({ id: op.id, status: "conflict", serverVersion: error.serverVersion, serverRecord: error.serverRecord, conflictingFields: error.fields });
        continue;
      }
      if (error instanceof AppError) {
        await log("rejected", null, error.code);
        results.push({
          id: op.id,
          status: "rejected",
          code: error.code,
          message: error.details ? `${error.message}: ${Object.entries(error.details).map(([k, v]) => `${k} ${v.join(", ")}`).join("; ")}` : error.message,
          retryable: RETRYABLE.has(error.code),
        });
        continue;
      }
      ctx.deps.log.error({ err: error, opId: op.id }, "sync operation failed");
      await log("rejected", null, "internal_error").catch(() => undefined);
      results.push({ id: op.id, status: "rejected", code: "internal_error", message: "Server error; will retry", retryable: true });
    }
  }
  return results;
}

async function existingVersion(tx: DbOrTx, op: SyncPushOperation): Promise<number | null> {
  const table = {
    task: tasks,
    checklist_item: checklistItems,
    task_note: taskNotes,
    labor_entry: laborEntries,
    expense: expenses,
    measurement: measurements,
    photo: photos,
    inspection: inspections,
    message: messages,
  }[op.entityType] as unknown as VersionedTable & typeof tasks;
  const [row] = await tx.select({ version: table.version }).from(table).where(eq(table.id, op.entityId)).limit(1);
  return row ? row.version : null;
}

// ---------------------------------------------------------------------------
// Pull
// ---------------------------------------------------------------------------

interface PullSource {
  type: PullEntityType;
  table: PgTable & { changeSeq: unknown; id: unknown };
  /** Restrict rows to the visible projects (and role visibility). */
  where: (ctx: Ctx, projectIds: string[], extra: { clientIds: string[]; propertyIds: string[] }) => SQL | undefined;
  shape?: (row: Record<string, unknown>) => Record<string, unknown>;
  enabled?: (ctx: Ctx) => Promise<boolean> | boolean;
  deleted?: (row: Record<string, unknown>) => boolean;
}

const inProjects = (col: Parameters<typeof inArray>[0], ids: string[]) => (ids.length ? inArray(col, ids) : sql`false`);
const isClient = (ctx: Ctx) => ctx.auth.role === "client";
const isSub = (ctx: Ctx) => ctx.auth.role === "subcontractor";

const SOURCES: PullSource[] = [
  { type: "project", table: projects as never, where: (_c, ids) => inProjects(projects.id, ids) },
  {
    type: "client",
    table: clients as never,
    enabled: (ctx) => !isSub(ctx),
    where: (_c, _ids, extra) => inProjects(clients.id, extra.clientIds),
  },
  {
    type: "property",
    table: properties as never,
    where: (_c, _ids, extra) => inProjects(properties.id, extra.propertyIds),
    shape: (r) => propertyOut(r as never),
  },
  {
    type: "stage",
    table: projectStages as never,
    where: (ctx, ids) => and(inProjects(projectStages.projectId, ids), isClient(ctx) ? eq(projectStages.clientVisible, true) : undefined),
  },
  {
    type: "task",
    table: tasks as never,
    enabled: (ctx) => !isClient(ctx),
    where: (ctx, ids) => and(inProjects(tasks.projectId, ids), isSub(ctx) ? eq(tasks.assigneeId, ctx.auth.userId) : undefined),
  },
  {
    type: "task_dependency",
    table: taskDependencies as never,
    enabled: (ctx) => !isClient(ctx) && !isSub(ctx),
    where: (_c, ids) => inProjects(taskDependencies.projectId, ids),
  },
  {
    type: "checklist_item",
    table: checklistItems as never,
    enabled: (ctx) => !isClient(ctx),
    where: (ctx, ids) =>
      and(
        inProjects(checklistItems.projectId, ids),
        isSub(ctx) ? sql`${checklistItems.taskId} in (select id from tasks where assignee_id = ${ctx.auth.userId})` : undefined,
      ),
  },
  {
    type: "task_note",
    table: taskNotes as never,
    enabled: (ctx) => !isClient(ctx),
    where: (ctx, ids) =>
      and(
        inProjects(taskNotes.projectId, ids),
        isSub(ctx) ? sql`${taskNotes.taskId} in (select id from tasks where assignee_id = ${ctx.auth.userId})` : undefined,
      ),
  },
  {
    type: "labor_entry",
    table: laborEntries as never,
    enabled: (ctx) => !isClient(ctx),
    where: (ctx, ids) =>
      and(inProjects(laborEntries.projectId, ids), can(ctx.auth.role, "labor:read") ? undefined : eq(laborEntries.userId, ctx.auth.userId)),
  },
  {
    type: "expense",
    table: expenses as never,
    enabled: (ctx) => hasPermission(ctx, "budget:read"),
    where: (_c, ids) => inProjects(expenses.projectId, ids),
  },
  {
    type: "measurement",
    table: measurements as never,
    enabled: (ctx) => !isClient(ctx),
    where: (_c, ids) => inProjects(measurements.projectId, ids),
    shape: (r) => measurementOut(r as never),
  },
  {
    type: "photo",
    table: photos as never,
    where: (ctx, ids) =>
      and(
        inProjects(photos.projectId, ids),
        isClient(ctx) ? eq(photos.visibility, "client") : undefined,
        isSub(ctx) ? eq(photos.createdBy, ctx.auth.userId) : undefined,
      ),
    shape: (r) => photoOut(r as never),
  },
  {
    type: "inspection",
    table: inspections as never,
    enabled: (ctx) => !isClient(ctx) && !isSub(ctx),
    where: (_c, ids) => inProjects(inspections.projectId, ids),
  },
  {
    type: "document",
    table: documents as never,
    where: (ctx, ids) =>
      and(
        or(inProjects(documents.projectId, ids), isClient(ctx) || isSub(ctx) ? sql`false` : and(isNull(documents.projectId), eq(documents.organizationId, ctx.auth.organizationId))),
        isClient(ctx) ? eq(documents.visibility, "client") : undefined,
      ),
  },
  {
    type: "change_order",
    table: changeOrders as never,
    enabled: (ctx) => !isSub(ctx),
    where: (ctx, ids) =>
      and(inProjects(changeOrders.projectId, ids), isClient(ctx) ? sql`${changeOrders.status} not in ('draft','submitted')` : undefined),
  },
  {
    type: "message",
    table: messages as never,
    where: (ctx, ids) =>
      and(inProjects(messages.projectId, ids), can(ctx.auth.role, "message:read_internal") ? undefined : eq(messages.visibility, "client")),
  },
  {
    type: "activity",
    table: activityLogs as never,
    where: (ctx, ids) =>
      and(inProjects(activityLogs.projectId, ids), isClient(ctx) || isSub(ctx) ? eq(activityLogs.clientVisible, true) : undefined),
    deleted: () => false,
  },
];

export async function pullChanges(ctx: Ctx, input: SyncPullInput): Promise<SyncPullResponse> {
  const db = ctx.deps.db;
  const watermark = await db.transaction(async (tx) => {
    const res = await tx.execute<{ mark: string | number }>(sql`select sync_high_water_mark() as mark`);
    return Number(res.rows[0]?.mark ?? 0);
  });
  const cursor = Math.max(0, Number(input.cursor ?? 0) || 0);
  const visible = await accessibleProjectIds(ctx);
  const projectIds = input.projectIds ? visible.filter((id) => input.projectIds!.includes(id)) : visible;

  const projectRows = projectIds.length
    ? await db.select({ clientId: projects.clientId, propertyId: projects.propertyId }).from(projects).where(inArray(projects.id, projectIds))
    : [];
  const extra = {
    clientIds: [...new Set(projectRows.map((p) => p.clientId))],
    propertyIds: [...new Set(projectRows.map((p) => p.propertyId))],
  };

  const limit = input.limit;
  const collected: SyncChange[] = [];
  for (const source of SOURCES) {
    if (source.enabled && !(await source.enabled(ctx))) continue;
    const table = source.table as unknown as typeof tasks;
    const rows = (await db
      .select()
      .from(table)
      .where(and(gt(table.changeSeq, cursor), lte(table.changeSeq, watermark), source.where(ctx, projectIds, extra)))
      .orderBy(asc(table.changeSeq))
      .limit(limit)) as unknown as (Record<string, unknown> & { id: string; changeSeq: number; deletedAt?: string | null })[];
    for (const row of rows) {
      const deleted = source.deleted ? source.deleted(row) : !!row.deletedAt;
      const shaped = source.shape ? source.shape(row) : row;
      const { changeSeq: _s, ...record } = shaped as Record<string, unknown>;
      collected.push({ entityType: source.type, entityId: row.id, seq: String(row.changeSeq), deleted, record: deleted ? null : redact(ctx, source.type, record) });
    }
  }
  collected.sort((a, b) => Number(a.seq) - Number(b.seq));
  const hasMore = collected.length > limit;
  const changes = collected.slice(0, limit);
  const nextCursor = hasMore ? changes.at(-1)!.seq : String(Math.max(watermark, cursor));
  return { changes, cursor: nextCursor, hasMore, serverTime: new Date().toISOString(), accessibleProjectIds: visible };
}

/** Field-level redaction for external roles. */
function redact(ctx: Ctx, type: PullEntityType, record: Record<string, unknown>): Record<string, unknown> {
  if (!isClient(ctx) && !isSub(ctx)) return record;
  if (type === "project") {
    const { estimatedCostCents: _e, crewTeamId: _c, ...rest } = record;
    return isSub(ctx) ? { ...rest, contractAmountCents: null } : rest;
  }
  if (type === "change_order") {
    const { costCents: _c, laborHoursImpact: _l, ...rest } = record;
    return rest;
  }
  if (type === "client" && isClient(ctx)) {
    const { notes: _n, ...rest } = record;
    return rest;
  }
  if (type === "property") {
    const { siteNotes: _s, ...rest } = record;
    return isClient(ctx) ? rest : record;
  }
  return record;
}
