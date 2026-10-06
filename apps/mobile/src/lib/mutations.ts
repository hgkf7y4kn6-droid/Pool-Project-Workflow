import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";
import { checkTaskCompletion, WorkCalendar } from "@pool/core";
import type {
  ChecklistItem,
  InspectionItemResult,
  Measurement,
  MeasurementCategory,
  MeasurementGeometry,
  MeasurementUnit,
  PhotoKind,
  Role,
  SyncEntityType,
  Task,
  TaskStatus,
  Visibility,
} from "@pool/types";
import { getRecord, listRecords, upsertRecords, deleteRecords, type LocalRecord, type RecordType } from "./db/records";
import { uuid } from "./ids";
import { currentLocation } from "./location";
import { currentSyncEngine } from "./sync/engine";
import { ensurePhotoDir, PHOTO_DIR, trackLocalPhoto } from "./sync/uploads";

/*
 * Every field action follows the same path:
 *   1. validate locally with the same rules the server uses (@pool/core),
 *   2. write the change to SQLite ("Saved on device"),
 *   3. queue a sync operation ("Waiting to sync" → "Synced").
 * Nothing here needs a network connection.
 */

export class LocalRuleError extends Error {
  constructor(
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "LocalRuleError";
  }
}

interface Actor {
  userId: string;
  role: Role;
  fullName: string;
}

async function enqueue(
  entityType: SyncEntityType,
  entityId: string,
  projectId: string | null,
  operation: "create" | "update" | "delete",
  payload: Record<string, unknown>,
  base?: LocalRecord | null,
) {
  const engine = currentSyncEngine();
  if (!engine) throw new Error("Sync engine is not running");
  const baseValues =
    operation === "update" && base ? Object.fromEntries(Object.keys(payload).map((k) => [k, base[k] ?? null])) : null;
  await engine.enqueue({
    entityType,
    entityId,
    projectId,
    operation,
    payload,
    baseVersion: base && typeof base.version === "number" ? base.version : null,
    baseValues,
  });
}

async function patchLocal(type: RecordType, id: string, patch: Record<string, unknown>) {
  const current = await getRecord<LocalRecord>(type, id);
  if (!current) throw new LocalRuleError("This item is no longer on your device. Pull to refresh.");
  await upsertRecords(type, [{ ...current, ...patch, updatedAt: new Date().toISOString() }]);
  return current;
}

const now = () => new Date().toISOString();
const today = () => now().slice(0, 10);
const calendar = new WorkCalendar();

// --- Tasks --------------------------------------------------------------------

export async function updateTaskStatus(task: Task, status: TaskStatus, actor: Actor) {
  if (status === "done") return completeTask(task, actor);
  const patch: Record<string, unknown> = { status };
  if (status === "in_progress" && !task.actualStartDate) patch.actualStartDate = today();
  const base = await patchLocal("task", task.id, patch);
  await enqueue("task", task.id, task.projectId, "update", patch, base);
}

export async function completeTask(task: Task, actor: Actor, override?: { reason: string }) {
  const items = await listRecords<ChecklistItem & { id: string }>("checklist_item", { parentId: task.id, where: "json_extract(data, '$.deletedAt') IS NULL" });
  const photos = await listRecords<{ checklistItemId?: string | null; deletedAt?: string | null }>("photo", { projectId: task.projectId });
  const photoCount = (itemId: string) => photos.filter((p) => p.checklistItemId === itemId && !p.deletedAt).length;
  const check = checkTaskCompletion(
    items.map((i) => ({ id: i.id, label: i.label, required: i.required, requiresPhoto: i.requiresPhoto, isChecked: i.isChecked, photoCount: photoCount(i.id) })),
    actor.role,
    { override: !!override, overrideReason: override?.reason ?? null },
  );
  if (!check.allowed) {
    throw new LocalRuleError(
      check.reason === "checklist_incomplete"
        ? "Finish the required checklist items first."
        : check.reason === "override_reason_required"
          ? "Give a reason for completing with open items."
          : "Only a supervisor can complete a task with open required items.",
      check,
    );
  }
  const patch: Record<string, unknown> = { status: "done", actualEndDate: today() };
  if (!task.actualStartDate) patch.actualStartDate = task.plannedStartDate && task.plannedStartDate <= today() ? task.plannedStartDate : today();
  const local = { ...patch, completedAt: now(), completedBy: actor.userId };
  const base = await patchLocal("task", task.id, local);
  await enqueue("task", task.id, task.projectId, "update", override ? { ...patch, override: true, overrideReason: override.reason } : patch, base);
}

export async function createTask(
  projectId: string,
  input: { title: string; description?: string; stageId?: string | null; assigneeId?: string | null; plannedStartDate?: string | null; durationDays?: number; priority?: Task["priority"]; checklist?: { label: string; required: boolean; requiresPhoto?: boolean }[] },
) {
  const id = uuid();
  const durationDays = input.durationDays ?? 1;
  const plannedEndDate = input.plannedStartDate ? calendar.finishDate(input.plannedStartDate, durationDays) : null;
  const checklist = (input.checklist ?? []).map((c, i) => ({ id: uuid(), ...c, requiresPhoto: !!c.requiresPhoto, sortOrder: i }));
  const record = {
    id,
    projectId,
    stageId: input.stageId ?? null,
    title: input.title,
    description: input.description ?? null,
    status: "todo",
    priority: input.priority ?? "normal",
    assigneeId: input.assigneeId ?? null,
    plannedStartDate: input.plannedStartDate ?? null,
    plannedEndDate,
    dueDate: plannedEndDate,
    durationDays,
    isMilestone: false,
    weatherSensitive: false,
    actualHours: 0,
    createdAt: now(),
    updatedAt: now(),
    deletedAt: null,
  };
  await upsertRecords("task", [record]);
  await upsertRecords(
    "checklist_item",
    checklist.map((c) => ({ ...c, taskId: id, projectId, isChecked: false, deletedAt: null })),
  );
  await enqueue("task", id, projectId, "create", {
    title: record.title,
    description: record.description,
    stageId: record.stageId,
    assigneeId: record.assigneeId,
    plannedStartDate: record.plannedStartDate,
    durationDays,
    priority: record.priority,
    checklist: checklist.map((c) => ({ id: c.id, label: c.label, required: c.required, requiresPhoto: c.requiresPhoto })),
  });
  return id;
}

export async function toggleChecklistItem(item: ChecklistItem, checked: boolean, actor: Actor) {
  const base = await patchLocal("checklist_item", item.id, { isChecked: checked, checkedAt: checked ? now() : null, checkedBy: checked ? actor.userId : null });
  await enqueue("checklist_item", item.id, (base.projectId as string) ?? null, "update", { isChecked: checked }, base);
}

export async function addTaskNote(task: Task, body: string, isProblem: boolean, actor: Actor) {
  const id = uuid();
  await upsertRecords("task_note", [
    { id, taskId: task.id, projectId: task.projectId, body, isProblem, visibility: "internal", createdAt: now(), createdBy: actor.userId, authorName: actor.fullName, deletedAt: null },
  ]);
  if (isProblem && task.status !== "done") await patchLocal("task", task.id, { status: "blocked" });
  await enqueue("task_note", id, task.projectId, "create", { taskId: task.id, body, isProblem, visibility: "internal" });
}

// --- Labor ----------------------------------------------------------------------

export async function logLabor(input: { projectId: string; taskId?: string | null; hours: number; workDate?: string; notes?: string | null }, actor: Actor) {
  const id = uuid();
  const record = { id, projectId: input.projectId, taskId: input.taskId ?? null, userId: actor.userId, userName: actor.fullName, workDate: input.workDate ?? today(), hours: input.hours, notes: input.notes ?? null, createdAt: now(), deletedAt: null };
  await upsertRecords("labor_entry", [record]);
  await enqueue("labor_entry", id, input.projectId, "create", { taskId: record.taskId, workDate: record.workDate, hours: record.hours, notes: record.notes });
}

// --- Measurements ------------------------------------------------------------------

export async function saveMeasurement(
  projectId: string,
  input: { id?: string; category: MeasurementCategory; label: string; value: number; unit: MeasurementUnit; notes?: string | null; geometry?: MeasurementGeometry | null; tagLocation?: boolean },
) {
  const location = input.tagLocation ? await currentLocation({ ask: true }) : null;
  if (input.id) {
    const payload = { category: input.category, label: input.label, value: input.value, unit: input.unit, notes: input.notes ?? null, geometry: input.geometry ?? null };
    const base = await patchLocal("measurement", input.id, payload);
    await enqueue("measurement", input.id, projectId, "update", payload, base);
    return input.id;
  }
  const id = uuid();
  const record: Partial<Measurement> & { id: string } = {
    id,
    projectId,
    category: input.category,
    label: input.label,
    value: input.value,
    unit: input.unit,
    notes: input.notes ?? null,
    geometry: input.geometry ?? null,
    location,
    measuredAt: now(),
    deletedAt: null,
  };
  await upsertRecords("measurement", [record as LocalRecord]);
  await enqueue("measurement", id, projectId, "create", {
    category: record.category,
    label: record.label,
    value: record.value,
    unit: record.unit,
    notes: record.notes,
    geometry: record.geometry,
    location,
    measuredAt: record.measuredAt,
  });
  return id;
}

export async function deleteMeasurement(m: Measurement) {
  await deleteRecords("measurement", [m.id]);
  await enqueue("measurement", m.id, m.projectId, "delete", {});
}

// --- Photos ------------------------------------------------------------------------

export interface CapturedImage {
  uri: string;
  width?: number;
  height?: number;
  fileSize?: number;
  mimeType?: string;
}

/**
 * Save a captured/selected image as a project photo. Project, task, stage,
 * time, author and (if permitted) GPS are attached automatically — the user
 * only optionally adds a caption.
 */
export async function savePhoto(
  image: CapturedImage,
  context: {
    projectId: string;
    taskId?: string | null;
    stageId?: string | null;
    checklistItemId?: string | null;
    inspectionId?: string | null;
    changeOrderId?: string | null;
    kind?: PhotoKind;
    caption?: string | null;
    visibility?: Visibility;
    tagLocation?: boolean;
  },
  actor: Actor,
) {
  const id = uuid();
  const mimeType = image.mimeType ?? "image/jpeg";
  let localUri = image.uri;
  if (Platform.OS !== "web") {
    await ensurePhotoDir();
    localUri = `${PHOTO_DIR}${id}.jpg`;
    await FileSystem.copyAsync({ from: image.uri, to: localUri });
  }
  let byteSize = image.fileSize;
  if (!byteSize && Platform.OS !== "web") {
    const info = await FileSystem.getInfoAsync(localUri);
    byteSize = info.exists ? info.size : undefined;
  }
  const location = context.tagLocation === false ? null : await currentLocation({ ask: false });
  const takenAt = now();
  const record = {
    id,
    projectId: context.projectId,
    taskId: context.taskId ?? null,
    stageId: context.stageId ?? null,
    checklistItemId: context.checklistItemId ?? null,
    inspectionId: context.inspectionId ?? null,
    changeOrderId: context.changeOrderId ?? null,
    kind: context.kind ?? "progress",
    caption: context.caption ?? null,
    visibility: context.visibility ?? "internal",
    takenAt,
    location,
    width: image.width ?? null,
    height: image.height ?? null,
    byteSize: byteSize ?? null,
    mimeType,
    uploadStatus: "pending",
    localUri,
    createdBy: actor.userId,
    createdAt: takenAt,
    deletedAt: null,
  };
  await upsertRecords("photo", [record]);
  await trackLocalPhoto(id, localUri, mimeType);
  await enqueue("photo", id, context.projectId, "create", {
    taskId: record.taskId,
    stageId: record.stageId,
    checklistItemId: record.checklistItemId,
    inspectionId: record.inspectionId,
    changeOrderId: record.changeOrderId,
    kind: record.kind,
    caption: record.caption,
    visibility: record.visibility,
    takenAt,
    location,
    width: record.width,
    height: record.height,
    byteSize: Math.max(1, record.byteSize ?? 1),
    mimeType: mimeType === "image/jpg" ? "image/jpeg" : mimeType,
  });
  return id;
}

export async function updatePhotoCaption(photo: { id: string; projectId: string }, caption: string) {
  const base = await patchLocal("photo", photo.id, { caption });
  await enqueue("photo", photo.id, photo.projectId, "update", { caption }, base);
}

// --- Inspections --------------------------------------------------------------------

export async function createInspection(
  projectId: string,
  input: { templateId?: string | null; inspectionType: string; inspectorName: string; scheduledFor?: string | null; stageId?: string | null; items: InspectionItemResult[] },
) {
  const id = uuid();
  const record = { id, projectId, ...input, result: "pending", notes: null, createdAt: now(), deletedAt: null };
  await upsertRecords("inspection", [record]);
  await enqueue("inspection", id, projectId, "create", { ...input });
  return id;
}

export async function updateInspection(
  inspection: { id: string; projectId: string },
  patch: { items?: InspectionItemResult[]; notes?: string | null; result?: "pending" | "pass" | "fail" | "partial"; signatureName?: string | null; signatureDataUrl?: string | null; inspectedAt?: string | null },
) {
  const base = await patchLocal("inspection", inspection.id, patch);
  await enqueue("inspection", inspection.id, inspection.projectId, "update", patch, base);
}

// --- Messages -----------------------------------------------------------------------

export async function sendMessage(projectId: string, body: string, visibility: Visibility, actor: Actor) {
  const id = uuid();
  const threadKey = visibility === "client" ? "client" : "crew";
  await upsertRecords("message", [
    { id, projectId, body, visibility, threadKey, authorId: actor.userId, authorName: actor.fullName, createdAt: now(), attachments: [], deletedAt: null },
  ]);
  await enqueue("message", id, projectId, "create", { body, visibility, threadKey });
}
