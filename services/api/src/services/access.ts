import { and, eq, exists, isNull, or, sql, type SQL } from "drizzle-orm";
import { can as baseCan, isExternalRole, projectAccessScope, type Permission } from "@pool/core";
import {
  projectMembers,
  projects,
  rolePermissionOverrides,
  tasks,
  teamMembers,
  type DbOrTx,
} from "@pool/database";
import type { Role } from "@pool/types";
import type { Ctx } from "../context";
import { forbidden, notFound } from "../lib/errors";

/*
 * Authorization has two layers and both are enforced here, server-side:
 *
 * 1. Capability (RBAC): may this role do X at all? Code-defined matrix in
 *    @pool/core plus per-organization overrides.
 * 2. Row level: which projects (and, for subcontractors, which tasks) may
 *    this user touch? Every query that reads project data is filtered by
 *    `projectAccessCondition`, and every write first calls `loadProject`.
 *
 * Inaccessible rows are reported as "not found" so IDs cannot be probed.
 */

const overrideCache = new Map<string, { expires: number; map: Map<string, boolean> }>();

async function overridesFor(db: DbOrTx, organizationId: string): Promise<Map<string, boolean>> {
  const hit = overrideCache.get(organizationId);
  if (hit && hit.expires > Date.now()) return hit.map;
  const rows = await db
    .select()
    .from(rolePermissionOverrides)
    .where(eq(rolePermissionOverrides.organizationId, organizationId));
  const map = new Map(rows.map((r) => [`${r.role}:${r.permission}`, r.granted]));
  overrideCache.set(organizationId, { expires: Date.now() + 60_000, map });
  return map;
}

export function invalidatePermissionCache(organizationId: string): void {
  overrideCache.delete(organizationId);
}

export async function hasPermission(ctx: Ctx, permission: Permission, role: Role = ctx.auth.role): Promise<boolean> {
  const overrides = await overridesFor(ctx.deps.db, ctx.auth.organizationId);
  const override = overrides.get(`${role}:${permission}`);
  if (override === undefined) return baseCan(role, permission);
  // External roles can have defaults revoked but never gain extra capabilities.
  if (isExternalRole(role) && override) return baseCan(role, permission);
  return override;
}

export async function requirePermission(ctx: Ctx, permission: Permission): Promise<void> {
  if (!(await hasPermission(ctx, permission))) throw forbidden();
}

/** SQL predicate on `projects` restricting rows to what the caller may see. */
export function projectAccessCondition(ctx: Ctx): SQL {
  const { organizationId, userId, role, clientId } = ctx.auth;
  const inOrg = eq(projects.organizationId, organizationId);
  const scope = projectAccessScope(role);
  if (scope === "organization") return inOrg;
  if (scope === "client") {
    return and(inOrg, clientId ? eq(projects.clientId, clientId) : sql`false`)!;
  }
  const db = ctx.deps.db;
  return and(
    inOrg,
    or(
      eq(projects.projectManagerId, userId),
      exists(
        db
          .select({ one: sql`1` })
          .from(projectMembers)
          .where(and(eq(projectMembers.projectId, projects.id), eq(projectMembers.userId, userId))),
      ),
      exists(
        db
          .select({ one: sql`1` })
          .from(teamMembers)
          .where(and(eq(teamMembers.teamId, projects.crewTeamId), eq(teamMembers.userId, userId))),
      ),
      exists(
        db
          .select({ one: sql`1` })
          .from(tasks)
          .where(and(eq(tasks.projectId, projects.id), eq(tasks.assigneeId, userId), isNull(tasks.deletedAt))),
      ),
    ),
  )!;
}

/** Subcontractors only see tasks assigned to them; everyone else sees all tasks of visible projects. */
export function taskVisibilityCondition(ctx: Ctx): SQL | undefined {
  if (ctx.auth.role === "subcontractor") return eq(tasks.assigneeId, ctx.auth.userId);
  if (ctx.auth.role === "client") return sql`false`;
  return undefined;
}

export type ProjectRow = typeof projects.$inferSelect;

/** Load a project the caller can access, or throw 404. */
export async function loadProject(ctx: Ctx, projectId: string, db: DbOrTx = ctx.deps.db): Promise<ProjectRow> {
  const [row] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), isNull(projects.deletedAt), projectAccessCondition(ctx)))
    .limit(1);
  if (!row) throw notFound("Project");
  return row;
}

/** Project IDs visible to the caller (used for cross-project feeds). */
export async function accessibleProjectIds(ctx: Ctx, db: DbOrTx = ctx.deps.db): Promise<string[]> {
  const rows = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(isNull(projects.deletedAt), projectAccessCondition(ctx)));
  return rows.map((r) => r.id);
}

export function isInternal(ctx: Ctx): boolean {
  return !isExternalRole(ctx.auth.role);
}

/** Throw unless the caller is internal staff. */
export function requireInternal(ctx: Ctx): void {
  if (!isInternal(ctx)) throw forbidden();
}
