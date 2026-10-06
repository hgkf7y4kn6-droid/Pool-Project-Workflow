import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { correctiveTasksFor, deriveInspectionResult, todayISO } from "@pool/core";
import { inspectionTemplates, inspections, type DbOrTx } from "@pool/database";
import type { InspectionInput } from "@pool/validation";
import { inspectionTemplateSchema, updateInspectionSchema, z } from "@pool/validation";
import type { Ctx } from "../context";
import { notFound } from "../lib/errors";
import { loadProject, requirePermission } from "./access";
import { recordActivity } from "./activity";
import { notify, projectStakeholders } from "./notifications";
import { strip } from "./mappers";
import { createTask } from "./tasks";

type Row = typeof inspections.$inferSelect;

export async function listInspectionTemplates(ctx: Ctx) {
  await requirePermission(ctx, "inspection:read");
  return ctx.deps.db
    .select()
    .from(inspectionTemplates)
    .where(eq(inspectionTemplates.organizationId, ctx.auth.organizationId))
    .orderBy(asc(inspectionTemplates.name));
}

export async function upsertInspectionTemplate(ctx: Ctx, input: z.infer<typeof inspectionTemplateSchema>, id?: string) {
  await requirePermission(ctx, "stage_template:manage");
  if (id) {
    const [row] = await ctx.deps.db
      .update(inspectionTemplates)
      .set({ ...input, updatedBy: ctx.auth.userId })
      .where(and(eq(inspectionTemplates.id, id), eq(inspectionTemplates.organizationId, ctx.auth.organizationId)))
      .returning();
    if (!row) throw notFound("Inspection template");
    return row;
  }
  const [row] = await ctx.deps.db
    .insert(inspectionTemplates)
    .values({ ...input, organizationId: ctx.auth.organizationId, createdBy: ctx.auth.userId })
    .returning();
  return row!;
}

export async function listInspections(ctx: Ctx, projectId: string) {
  await loadProject(ctx, projectId);
  await requirePermission(ctx, "inspection:read");
  const rows = await ctx.deps.db
    .select()
    .from(inspections)
    .where(and(eq(inspections.projectId, projectId), isNull(inspections.deletedAt)))
    .orderBy(desc(inspections.scheduledFor), desc(inspections.createdAt));
  return rows.map(strip);
}

export async function getInspection(ctx: Ctx, inspectionId: string) {
  const [row] = await ctx.deps.db.select().from(inspections).where(and(eq(inspections.id, inspectionId), isNull(inspections.deletedAt)));
  if (!row) throw notFound("Inspection");
  await loadProject(ctx, row.projectId);
  await requirePermission(ctx, "inspection:read");
  return strip(row);
}

/** Create corrective tasks + notifications when an inspection fails. */
async function handleFailure(ctx: Ctx, row: Row, db: DbOrTx, generateTasks: boolean) {
  const createdTasks: string[] = [];
  if (generateTasks) {
    for (const draft of correctiveTasksFor(row.inspectionType, row.items)) {
      const task = await createTask(
        ctx,
        row.projectId,
        {
          title: draft.title,
          description: draft.description,
          status: "todo",
          priority: draft.priority,
          isMilestone: false,
          durationDays: draft.durationDays,
          weatherSensitive: false,
          stageId: row.stageId,
          plannedStartDate: todayISO(),
          checklist: [{ label: "Correction completed and photographed", required: true, requiresPhoto: true }],
        },
        db,
      );
      createdTasks.push(task.id);
    }
  }
  await recordActivity(
    ctx,
    {
      projectId: row.projectId,
      action: "inspection.failed",
      entityType: "inspection",
      entityId: row.id,
      summary: `recorded a failed ${row.inspectionType.replace(/_/g, " ")} inspection${createdTasks.length ? ` and created ${createdTasks.length} corrective task(s)` : ""}`,
      metadata: { correctiveTaskIds: createdTasks },
    },
    db,
  );
  await notify(
    ctx.deps,
    {
      organizationId: ctx.auth.organizationId,
      userIds: await projectStakeholders(db, row.projectId),
      excludeUserId: ctx.auth.userId,
      type: "inspection_failed",
      projectId: row.projectId,
      title: "Inspection failed",
      body: `${row.inspectionType.replace(/_/g, " ")} inspection failed by ${row.inspectorName}`,
      data: { inspectionId: row.id },
    },
    db,
  );
  return createdTasks;
}

export async function createInspection(ctx: Ctx, projectId: string, input: InspectionInput, db: DbOrTx = ctx.deps.db) {
  await loadProject(ctx, projectId, db);
  await requirePermission(ctx, "inspection:create");
  const { generateCorrectiveTasks, id, ...values } = input;
  let items = values.items;
  if (!items.length && values.templateId) {
    const [tpl] = await db.select().from(inspectionTemplates).where(and(eq(inspectionTemplates.id, values.templateId), eq(inspectionTemplates.organizationId, ctx.auth.organizationId)));
    items = (tpl?.items ?? []).map((i) => ({ key: i.key, label: i.label, result: "pending" as const }));
  }
  const result = values.result !== "pending" ? values.result : deriveInspectionResult(items);
  const run = async (tx: DbOrTx) => {
    const [row] = await tx
      .insert(inspections)
      .values({ ...(id ? { id } : {}), ...values, items, result, projectId, createdBy: ctx.auth.userId, updatedBy: ctx.auth.userId })
      .returning();
    let correctiveTaskIds: string[] = [];
    if (result === "fail" || result === "partial") correctiveTaskIds = await handleFailure(ctx, row!, tx, generateCorrectiveTasks);
    else
      await recordActivity(
        ctx,
        { projectId, action: "inspection.recorded", entityType: "inspection", entityId: row!.id, summary: `${result === "pending" ? "scheduled" : "recorded"} a ${values.inspectionType.replace(/_/g, " ")} inspection${result === "pass" ? " (passed)" : ""}`, clientVisible: result === "pass" },
        tx,
      );
    return { ...strip(row!), correctiveTaskIds };
  };
  return db === ctx.deps.db ? ctx.deps.db.transaction(run) : run(db);
}

export async function updateInspection(
  ctx: Ctx,
  inspectionId: string,
  input: z.infer<typeof updateInspectionSchema>,
  db: DbOrTx = ctx.deps.db,
) {
  const run = async (tx: DbOrTx) => {
    const [current] = await tx.select().from(inspections).where(and(eq(inspections.id, inspectionId), isNull(inspections.deletedAt)));
    if (!current) throw notFound("Inspection");
    await loadProject(ctx, current.projectId, tx);
    await requirePermission(ctx, "inspection:create");
    const { generateCorrectiveTasks = true, ...patch } = input;
    const items = patch.items ?? current.items;
    const result = patch.result && patch.result !== "pending" ? patch.result : deriveInspectionResult(items);
    const [row] = await tx
      .update(inspections)
      .set({ ...patch, items, result, inspectedAt: patch.inspectedAt ?? (result !== "pending" ? (current.inspectedAt ?? new Date().toISOString()) : current.inspectedAt), updatedBy: ctx.auth.userId })
      .where(eq(inspections.id, inspectionId))
      .returning();
    let correctiveTaskIds: string[] = [];
    const newlyFailed = (result === "fail" || result === "partial") && current.result !== result;
    if (newlyFailed) correctiveTaskIds = await handleFailure(ctx, row!, tx, generateCorrectiveTasks);
    else if (result === "pass" && current.result !== "pass") {
      await recordActivity(
        ctx,
        { projectId: current.projectId, action: "inspection.recorded", entityType: "inspection", entityId: inspectionId, summary: `recorded a passed ${current.inspectionType.replace(/_/g, " ")} inspection`, clientVisible: true },
        tx,
      );
    }
    return { ...strip(row!), correctiveTaskIds };
  };
  return db === ctx.deps.db ? ctx.deps.db.transaction(run) : run(db);
}
