import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { computeBudgetSummary, laborCostCents } from "@pool/core";
import {
  budgetItems,
  budgets,
  changeOrders,
  expenses,
  laborEntries,
  materialUsage,
  materials,
  organizations,
  tasks,
  users,
  vendors,
  type DbOrTx,
} from "@pool/database";
import type { BudgetItemInput, ExpenseInput, LaborEntryInput, MaterialUsageInput } from "@pool/validation";
import { materialSchema, updateBudgetSchema, vendorSchema, z } from "@pool/validation";
import type { Ctx, Deps } from "../context";
import { badRequest, forbidden, notFound } from "../lib/errors";
import { hasPermission, loadProject, requirePermission } from "./access";
import { recordActivity } from "./activity";
import { notify, projectStakeholders } from "./notifications";
import { strip, vendorOut } from "./mappers";

async function ensureBudget(db: DbOrTx, projectId: string, userId: string) {
  const [existing] = await db.select().from(budgets).where(eq(budgets.projectId, projectId)).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(budgets).values({ projectId, createdBy: userId }).onConflictDoNothing().returning();
  return created ?? (await db.select().from(budgets).where(eq(budgets.projectId, projectId)))[0]!;
}

/** Load everything the roll-up needs with SQL aggregates (never whole tables). */
async function summaryInputs(db: DbOrTx, projectId: string) {
  const [budget] = await db.select().from(budgets).where(eq(budgets.projectId, projectId)).limit(1);
  const items = await db
    .select({ category: budgetItems.category, estimatedCents: sql<number>`sum(${budgetItems.estimatedCents})::bigint` })
    .from(budgetItems)
    .where(eq(budgetItems.projectId, projectId))
    .groupBy(budgetItems.category);
  const exp = await db
    .select({ category: expenses.category, amountCents: sql<number>`sum(${expenses.amountCents})::bigint` })
    .from(expenses)
    .where(and(eq(expenses.projectId, projectId), isNull(expenses.deletedAt)))
    .groupBy(expenses.category);
  const [labor] = await db
    .select({
      cost: sql<number>`coalesce(sum(round(${laborEntries.hours} * ${laborEntries.hourlyCostCents})), 0)::bigint`,
      hours: sql<number>`coalesce(sum(${laborEntries.hours}), 0)::float`,
    })
    .from(laborEntries)
    .where(and(eq(laborEntries.projectId, projectId), isNull(laborEntries.deletedAt)));
  const mats = await db
    .select({ quantityUsed: materialUsage.quantityUsed, quantityPlanned: materialUsage.quantityPlanned, unitCostCents: materialUsage.unitCostCents })
    .from(materialUsage)
    .where(eq(materialUsage.projectId, projectId));
  const cos = await db
    .select({ status: changeOrders.status, costCents: changeOrders.costCents, priceCents: changeOrders.priceCents })
    .from(changeOrders)
    .where(and(eq(changeOrders.projectId, projectId), isNull(changeOrders.deletedAt)));
  return { budget, items, exp, labor: labor ?? { cost: 0, hours: 0 }, mats, cos };
}

export async function computeProjectBudget(deps: Deps, projectId: string, db: DbOrTx = deps.db) {
  const [projectRow] = await db.execute<{ contract_amount_cents: number; organization_id: string }>(
    sql`select contract_amount_cents, organization_id from projects where id = ${projectId}`,
  ).then((r) => r.rows);
  if (!projectRow) throw notFound("Project");
  const [org] = await db.select({ settings: organizations.settings }).from(organizations).where(eq(organizations.id, projectRow.organization_id));
  const inputs = await summaryInputs(db, projectId);
  const summary = computeBudgetSummary({
    contractAmountCents: Number(projectRow.contract_amount_cents),
    contingencyPct: inputs.budget?.contingencyPct ?? 0,
    items: inputs.items.map((i) => ({ category: i.category, estimatedCents: Number(i.estimatedCents) })),
    expenses: inputs.exp.map((e) => ({ category: e.category, amountCents: Number(e.amountCents) })),
    // Labor is pre-aggregated in SQL; pass it as a single 1-hour entry of the total cost.
    labor: [{ hours: 1, hourlyCostCents: Number(inputs.labor.cost) }],
    materials: inputs.mats,
    changeOrders: inputs.cos,
    alertThresholdPct: org?.settings.budgetAlertThresholdPct ?? 90,
  });
  return { summary, laborHours: inputs.labor.hours, budget: inputs.budget };
}

export async function getBudgetSummary(ctx: Ctx, projectId: string) {
  await loadProject(ctx, projectId);
  await requirePermission(ctx, "budget:read");
  const { summary, laborHours, budget } = await computeProjectBudget(ctx.deps, projectId);
  return { summary, laborHours, contingencyPct: budget?.contingencyPct ?? 0, notes: budget?.notes ?? null };
}

export async function getBudget(ctx: Ctx, projectId: string) {
  const base = await getBudgetSummary(ctx, projectId);
  const items = await ctx.deps.db
    .select()
    .from(budgetItems)
    .where(eq(budgetItems.projectId, projectId))
    .orderBy(asc(budgetItems.category), asc(budgetItems.createdAt));
  return { ...base, items };
}

export async function updateBudget(ctx: Ctx, projectId: string, input: z.infer<typeof updateBudgetSchema>) {
  await loadProject(ctx, projectId);
  await requirePermission(ctx, "budget:update");
  const budget = await ensureBudget(ctx.deps.db, projectId, ctx.auth.userId);
  await ctx.deps.db.update(budgets).set({ ...input, updatedBy: ctx.auth.userId }).where(eq(budgets.id, budget.id));
  return getBudget(ctx, projectId);
}

export async function upsertBudgetItem(ctx: Ctx, projectId: string, input: BudgetItemInput, itemId?: string) {
  await loadProject(ctx, projectId);
  await requirePermission(ctx, "budget:update");
  const budget = await ensureBudget(ctx.deps.db, projectId, ctx.auth.userId);
  const estimatedCents = Math.round(input.quantity * input.unitCostCents);
  if (itemId) {
    const [row] = await ctx.deps.db
      .update(budgetItems)
      .set({ ...input, estimatedCents, updatedBy: ctx.auth.userId })
      .where(and(eq(budgetItems.id, itemId), eq(budgetItems.projectId, projectId)))
      .returning();
    if (!row) throw notFound("Budget item");
    return row;
  }
  const { id, ...values } = input;
  const [row] = await ctx.deps.db
    .insert(budgetItems)
    .values({ ...(id ? { id } : {}), ...values, estimatedCents, budgetId: budget.id, projectId, createdBy: ctx.auth.userId, updatedBy: ctx.auth.userId })
    .returning();
  return row!;
}

export async function deleteBudgetItem(ctx: Ctx, projectId: string, itemId: string) {
  await loadProject(ctx, projectId);
  await requirePermission(ctx, "budget:update");
  const deleted = await ctx.deps.db
    .delete(budgetItems)
    .where(and(eq(budgetItems.id, itemId), eq(budgetItems.projectId, projectId)))
    .returning();
  if (!deleted.length) throw notFound("Budget item");
}

/**
 * After a cost is recorded, alert stakeholders once per alert code when the
 * budget crosses its threshold (dedupe key prevents repeats).
 */
export async function checkBudgetAlerts(deps: Deps, organizationId: string, projectId: string, db: DbOrTx = deps.db) {
  const { summary } = await computeProjectBudget(deps, projectId, db);
  const important = summary.alerts.filter((a) => a.code !== "category_over_budget");
  if (!important.length) return;
  const recipients = await projectStakeholders(db, projectId, ["admin", "project_manager"]);
  for (const alert of important) {
    await notify(
      deps,
      {
        organizationId,
        userIds: recipients,
        type: "budget_threshold",
        projectId,
        title: alert.level === "critical" ? "Budget critical" : "Budget threshold exceeded",
        body: alert.message,
        dedupeKey: `budget:${projectId}:${alert.code}`,
      },
      db,
    );
  }
}

// --- Expenses -------------------------------------------------------------------

export async function listExpenses(ctx: Ctx, projectId: string) {
  await loadProject(ctx, projectId);
  await requirePermission(ctx, "budget:read");
  const rows = await ctx.deps.db
    .select({ expense: expenses, vendorName: vendors.name })
    .from(expenses)
    .leftJoin(vendors, eq(vendors.id, expenses.vendorId))
    .where(and(eq(expenses.projectId, projectId), isNull(expenses.deletedAt)))
    .orderBy(desc(expenses.incurredOn));
  return rows.map((r) => ({ ...strip(r.expense), vendorName: r.vendorName }));
}

export async function createExpense(ctx: Ctx, projectId: string, input: ExpenseInput, db: DbOrTx = ctx.deps.db) {
  await loadProject(ctx, projectId, db);
  await requirePermission(ctx, "expense:create");
  const { id, ...values } = input;
  const [row] = await db
    .insert(expenses)
    .values({ ...(id ? { id } : {}), ...values, projectId, createdBy: ctx.auth.userId, updatedBy: ctx.auth.userId })
    .returning();
  await recordActivity(
    ctx,
    { projectId, action: "expense.recorded", entityType: "expense", entityId: row!.id, summary: `recorded an expense: ${input.description}` },
    db,
  );
  await checkBudgetAlerts(ctx.deps, ctx.auth.organizationId, projectId, db);
  return strip(row!);
}

export async function deleteExpense(ctx: Ctx, projectId: string, expenseId: string) {
  await loadProject(ctx, projectId);
  await requirePermission(ctx, "budget:update");
  const [row] = await ctx.deps.db
    .update(expenses)
    .set({ deletedAt: new Date().toISOString(), updatedBy: ctx.auth.userId })
    .where(and(eq(expenses.id, expenseId), eq(expenses.projectId, projectId), isNull(expenses.deletedAt)))
    .returning();
  if (!row) throw notFound("Expense");
}

// --- Labor ------------------------------------------------------------------------

export async function listLabor(ctx: Ctx, projectId: string) {
  await loadProject(ctx, projectId);
  const canReadAll = await hasPermission(ctx, "labor:read");
  const rows = await ctx.deps.db
    .select({ entry: laborEntries, userName: users.fullName, taskTitle: tasks.title })
    .from(laborEntries)
    .innerJoin(users, eq(users.id, laborEntries.userId))
    .leftJoin(tasks, eq(tasks.id, laborEntries.taskId))
    .where(
      and(
        eq(laborEntries.projectId, projectId),
        isNull(laborEntries.deletedAt),
        canReadAll ? undefined : eq(laborEntries.userId, ctx.auth.userId),
      ),
    )
    .orderBy(desc(laborEntries.workDate));
  const showCost = await hasPermission(ctx, "budget:read");
  return rows.map((r) => {
    const e = strip(r.entry);
    return {
      ...e,
      hourlyCostCents: showCost ? e.hourlyCostCents : null,
      costCents: showCost ? laborCostCents(e) : null,
      userName: r.userName,
      taskTitle: r.taskTitle,
    };
  });
}

export async function createLaborEntry(ctx: Ctx, projectId: string, input: LaborEntryInput, db: DbOrTx = ctx.deps.db) {
  await loadProject(ctx, projectId, db);
  const userId = input.userId ?? ctx.auth.userId;
  if (userId !== ctx.auth.userId) await requirePermission(ctx, "labor:create");
  else if (!(await hasPermission(ctx, "labor:create")) && !(await hasPermission(ctx, "labor:create_own"))) throw forbidden();
  const [worker] = await db.select().from(users).where(and(eq(users.id, userId), eq(users.organizationId, ctx.auth.organizationId)));
  if (!worker) throw badRequest("Unknown worker");
  // Only managers may set a custom rate; everyone else gets the worker's standard cost.
  const rate =
    input.hourlyCostCents !== undefined && (await hasPermission(ctx, "budget:update")) ? input.hourlyCostCents : worker.defaultHourlyCostCents;
  if (input.taskId) {
    const [t] = await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.id, input.taskId), eq(tasks.projectId, projectId)));
    if (!t) throw badRequest("Task does not belong to this project");
  }
  const { id, ...values } = input;
  const [row] = await db
    .insert(laborEntries)
    .values({ ...(id ? { id } : {}), ...values, userId, hourlyCostCents: rate, projectId, createdBy: ctx.auth.userId, updatedBy: ctx.auth.userId })
    .returning();
  if (input.taskId) {
    await db
      .update(tasks)
      .set({ actualHours: sql`${tasks.actualHours} + ${input.hours}` })
      .where(eq(tasks.id, input.taskId));
  }
  await recordActivity(
    ctx,
    { projectId, action: "labor.recorded", entityType: "labor_entry", entityId: row!.id, summary: `logged ${input.hours}h${worker.id !== ctx.auth.userId ? ` for ${worker.fullName}` : ""}` },
    db,
  );
  await checkBudgetAlerts(ctx.deps, ctx.auth.organizationId, projectId, db);
  return strip(row!);
}

export async function deleteLaborEntry(ctx: Ctx, projectId: string, entryId: string) {
  await loadProject(ctx, projectId);
  const [entry] = await ctx.deps.db
    .select()
    .from(laborEntries)
    .where(and(eq(laborEntries.id, entryId), eq(laborEntries.projectId, projectId), isNull(laborEntries.deletedAt)));
  if (!entry) throw notFound("Labor entry");
  if (entry.userId !== ctx.auth.userId) await requirePermission(ctx, "labor:create");
  await ctx.deps.db.transaction(async (tx) => {
    await tx.update(laborEntries).set({ deletedAt: new Date().toISOString(), updatedBy: ctx.auth.userId }).where(eq(laborEntries.id, entryId));
    if (entry.taskId) {
      await tx.update(tasks).set({ actualHours: sql`greatest(${tasks.actualHours} - ${entry.hours}, 0)` }).where(eq(tasks.id, entry.taskId));
    }
  });
}

// --- Materials & vendors ----------------------------------------------------------

export async function listMaterials(ctx: Ctx, q?: string) {
  await requirePermission(ctx, "material:read");
  return ctx.deps.db
    .select()
    .from(materials)
    .where(
      and(
        eq(materials.organizationId, ctx.auth.organizationId),
        q ? sql`(${materials.name} ilike ${"%" + q + "%"} or ${materials.sku} ilike ${"%" + q + "%"})` : undefined,
      ),
    )
    .orderBy(asc(materials.category), asc(materials.name))
    .limit(500);
}

export async function upsertMaterial(ctx: Ctx, input: z.infer<typeof materialSchema>, id?: string) {
  await requirePermission(ctx, "material:manage");
  if (id) {
    const [row] = await ctx.deps.db
      .update(materials)
      .set({ ...input, updatedBy: ctx.auth.userId })
      .where(and(eq(materials.id, id), eq(materials.organizationId, ctx.auth.organizationId)))
      .returning();
    if (!row) throw notFound("Material");
    return row;
  }
  const [row] = await ctx.deps.db
    .insert(materials)
    .values({ ...input, organizationId: ctx.auth.organizationId, createdBy: ctx.auth.userId })
    .returning();
  return row!;
}

export async function listMaterialUsage(ctx: Ctx, projectId: string) {
  await loadProject(ctx, projectId);
  await requirePermission(ctx, "material:read");
  const showCost = await hasPermission(ctx, "budget:read");
  const rows = await ctx.deps.db
    .select({ usage: materialUsage, materialName: materials.name, unit: materials.unit, sku: materials.sku })
    .from(materialUsage)
    .innerJoin(materials, eq(materials.id, materialUsage.materialId))
    .where(eq(materialUsage.projectId, projectId))
    .orderBy(asc(materials.name));
  return rows.map((r) => ({
    ...r.usage,
    unitCostCents: showCost ? r.usage.unitCostCents : null,
    materialName: r.materialName,
    unit: r.unit,
    sku: r.sku,
  }));
}

export async function upsertMaterialUsage(ctx: Ctx, projectId: string, input: MaterialUsageInput, usageId?: string) {
  await loadProject(ctx, projectId);
  await requirePermission(ctx, "material:manage");
  const [material] = await ctx.deps.db
    .select()
    .from(materials)
    .where(and(eq(materials.id, input.materialId), eq(materials.organizationId, ctx.auth.organizationId)));
  if (!material) throw badRequest("Unknown material");
  const values = { ...input, unitCostCents: input.unitCostCents ?? material.unitCostCents };
  if (usageId) {
    const [row] = await ctx.deps.db
      .update(materialUsage)
      .set({ ...values, updatedBy: ctx.auth.userId })
      .where(and(eq(materialUsage.id, usageId), eq(materialUsage.projectId, projectId)))
      .returning();
    if (!row) throw notFound("Material usage");
    return row;
  }
  const [row] = await ctx.deps.db
    .insert(materialUsage)
    .values({ ...values, projectId, createdBy: ctx.auth.userId })
    .returning();
  await checkBudgetAlerts(ctx.deps, ctx.auth.organizationId, projectId);
  return row!;
}

export async function listVendors(ctx: Ctx, kind?: string) {
  await requirePermission(ctx, "vendor:read");
  const rows = await ctx.deps.db
    .select()
    .from(vendors)
    .where(and(eq(vendors.organizationId, ctx.auth.organizationId), kind ? sql`${vendors.kind} = ${kind}` : undefined))
    .orderBy(asc(vendors.name));
  return rows.map(vendorOut);
}

export async function upsertVendor(ctx: Ctx, input: z.infer<typeof vendorSchema>, id?: string) {
  await requirePermission(ctx, "vendor:manage");
  const { location, ...rest } = input;
  const values = { ...rest, latitude: location?.latitude ?? null, longitude: location?.longitude ?? null };
  if (id) {
    const [row] = await ctx.deps.db
      .update(vendors)
      .set({ ...values, updatedBy: ctx.auth.userId })
      .where(and(eq(vendors.id, id), eq(vendors.organizationId, ctx.auth.organizationId)))
      .returning();
    if (!row) throw notFound("Vendor");
    return vendorOut(row);
  }
  const [row] = await ctx.deps.db
    .insert(vendors)
    .values({ ...values, organizationId: ctx.auth.organizationId, createdBy: ctx.auth.userId })
    .returning();
  return vendorOut(row!);
}
