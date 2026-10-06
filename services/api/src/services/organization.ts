import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { PERMISSIONS, ROLE_PERMISSIONS, type Permission } from "@pool/core";
import {
  integrations,
  organizations,
  rolePermissionOverrides,
  stageTemplates,
  teamMembers,
  teams,
  users,
} from "@pool/database";
import { ROLES, type Role } from "@pool/types";
import type { InviteUserInput } from "@pool/validation";
import { stageTemplateSchema, teamSchema, updateOrganizationSchema, updateUserSchema, z } from "@pool/validation";
import type { Ctx } from "../context";
import { AppError, badRequest, forbidden, notFound } from "../lib/errors";
import { hasPermission, invalidatePermissionCache, requireInternal, requirePermission } from "./access";
import { sendInvite } from "./auth";

export async function getOrganization(ctx: Ctx) {
  const [org] = await ctx.deps.db.select().from(organizations).where(eq(organizations.id, ctx.auth.organizationId));
  if (!org) throw notFound("Organization");
  if (ctx.auth.role === "client" || ctx.auth.role === "subcontractor") {
    return { id: org.id, name: org.name, timezone: org.timezone, currency: org.currency };
  }
  return org;
}

export async function updateOrganization(ctx: Ctx, input: z.infer<typeof updateOrganizationSchema>) {
  await requirePermission(ctx, "org:manage");
  const [org] = await ctx.deps.db.select().from(organizations).where(eq(organizations.id, ctx.auth.organizationId));
  const settings = input.settings
    ? { ...org!.settings, ...input.settings, weather: { ...org!.settings.weather, ...(input.settings.weather ?? {}) } }
    : org!.settings;
  const [row] = await ctx.deps.db
    .update(organizations)
    .set({ name: input.name ?? org!.name, timezone: input.timezone ?? org!.timezone, settings, updatedBy: ctx.auth.userId })
    .where(eq(organizations.id, ctx.auth.organizationId))
    .returning();
  return row!;
}

const userColumns = {
  id: users.id,
  email: users.email,
  fullName: users.fullName,
  phone: users.phone,
  role: users.role,
  avatarUrl: users.avatarUrl,
  isActive: users.isActive,
  mfaEnabled: users.mfaEnabled,
  clientId: users.clientId,
  lastLoginAt: users.lastLoginAt,
  createdAt: users.createdAt,
  defaultHourlyCostCents: users.defaultHourlyCostCents,
  invitePending: sql<boolean>`${users.passwordHash} is null`,
};

export async function listUsers(ctx: Ctx, opts: { role?: Role; includeInactive?: boolean }) {
  await requirePermission(ctx, "user:read");
  const rows = await ctx.deps.db
    .select(userColumns)
    .from(users)
    .where(
      and(
        eq(users.organizationId, ctx.auth.organizationId),
        opts.role ? eq(users.role, opts.role) : undefined,
        opts.includeInactive ? undefined : eq(users.isActive, true),
      ),
    )
    .orderBy(asc(users.fullName));
  const canSeeRates = await hasPermission(ctx, "budget:read");
  return rows.map((u) => ({ ...u, defaultHourlyCostCents: canSeeRates ? u.defaultHourlyCostCents : null }));
}

export async function inviteUser(ctx: Ctx, input: InviteUserInput) {
  await requirePermission(ctx, "user:manage");
  if (input.role === "admin" && ctx.auth.role !== "admin") throw forbidden("Only administrators can invite administrators");
  if (input.role === "client" && !input.clientId) throw badRequest("Client users must be linked to a client record");
  const [existing] = await ctx.deps.db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${input.email}`);
  if (existing) throw new AppError("conflict", "A user with this email already exists");
  const [user] = await ctx.deps.db
    .insert(users)
    .values({
      organizationId: ctx.auth.organizationId,
      email: input.email,
      fullName: input.fullName,
      role: input.role,
      phone: input.phone ?? null,
      clientId: input.role === "client" ? input.clientId! : null,
      createdBy: ctx.auth.userId,
    })
    .returning();
  const [inviter] = await ctx.deps.db.select({ fullName: users.fullName }).from(users).where(eq(users.id, ctx.auth.userId));
  await sendInvite(ctx.deps, user!, inviter?.fullName ?? "Your team");
  return { id: user!.id, email: user!.email, fullName: user!.fullName, role: user!.role, invitePending: true };
}

export async function updateUser(ctx: Ctx, userId: string, input: z.infer<typeof updateUserSchema> & { defaultHourlyCostCents?: number }) {
  const self = userId === ctx.auth.userId;
  if (!self || input.role !== undefined || input.isActive !== undefined) await requirePermission(ctx, "user:manage");
  if (self && (input.role !== undefined || input.isActive === false)) throw badRequest("You cannot change your own role or deactivate yourself");
  if (input.role === "admin" && ctx.auth.role !== "admin") throw forbidden();
  const [row] = await ctx.deps.db
    .update(users)
    .set({ ...input, updatedBy: ctx.auth.userId })
    .where(and(eq(users.id, userId), eq(users.organizationId, ctx.auth.organizationId)))
    .returning();
  if (!row) throw notFound("User");
  return { id: row.id, email: row.email, fullName: row.fullName, role: row.role, isActive: row.isActive, phone: row.phone };
}

// --- Teams -----------------------------------------------------------------------

export async function listTeams(ctx: Ctx) {
  requireInternal(ctx);
  const rows = await ctx.deps.db
    .select()
    .from(teams)
    .where(eq(teams.organizationId, ctx.auth.organizationId))
    .orderBy(asc(teams.name));
  const members = rows.length
    ? await ctx.deps.db
        .select({ teamId: teamMembers.teamId, userId: users.id, fullName: users.fullName, role: users.role })
        .from(teamMembers)
        .innerJoin(users, eq(users.id, teamMembers.userId))
        .where(inArray(teamMembers.teamId, rows.map((r) => r.id)))
    : [];
  return rows.map((t) => ({ ...t, members: members.filter((m) => m.teamId === t.id) }));
}

export async function upsertTeam(ctx: Ctx, input: z.infer<typeof teamSchema>, id?: string) {
  await requirePermission(ctx, "team:manage");
  const teamId = await ctx.deps.db.transaction(async (tx) => {
    const { memberIds, ...values } = input;
    let tid = id;
    if (tid) {
      const [row] = await tx
        .update(teams)
        .set({ ...values, updatedBy: ctx.auth.userId })
        .where(and(eq(teams.id, tid), eq(teams.organizationId, ctx.auth.organizationId)))
        .returning();
      if (!row) throw notFound("Team");
      await tx.delete(teamMembers).where(eq(teamMembers.teamId, tid));
    } else {
      const [row] = await tx.insert(teams).values({ ...values, organizationId: ctx.auth.organizationId, createdBy: ctx.auth.userId }).returning();
      tid = row!.id;
    }
    if (memberIds.length) {
      const valid = await tx.select({ id: users.id }).from(users).where(and(inArray(users.id, memberIds), eq(users.organizationId, ctx.auth.organizationId)));
      if (valid.length) await tx.insert(teamMembers).values(valid.map((u) => ({ teamId: tid!, userId: u.id })));
    }
    return tid!;
  });
  return (await listTeams(ctx)).find((t) => t.id === teamId)!;
}

// --- Roles & permissions -----------------------------------------------------------

export async function rolesMatrix(ctx: Ctx) {
  requireInternal(ctx);
  const overrides = await ctx.deps.db
    .select()
    .from(rolePermissionOverrides)
    .where(eq(rolePermissionOverrides.organizationId, ctx.auth.organizationId));
  return ROLES.map((role) => ({
    role,
    permissions: PERMISSIONS.map((permission) => {
      const o = overrides.find((x) => x.role === role && x.permission === permission);
      return { permission, default: ROLE_PERMISSIONS[role].has(permission), granted: o ? o.granted : ROLE_PERMISSIONS[role].has(permission), overridden: !!o };
    }),
  }));
}

export async function setRolePermissions(ctx: Ctx, role: Role, changes: { permission: string; granted: boolean | null }[]) {
  await requirePermission(ctx, "org:manage");
  if (role === "admin") throw badRequest("Administrator permissions cannot be changed");
  for (const c of changes) {
    if (!PERMISSIONS.includes(c.permission as Permission)) throw badRequest(`Unknown permission ${c.permission}`);
    if (c.granted === null) {
      await ctx.deps.db
        .delete(rolePermissionOverrides)
        .where(and(eq(rolePermissionOverrides.organizationId, ctx.auth.organizationId), eq(rolePermissionOverrides.role, role), eq(rolePermissionOverrides.permission, c.permission)));
    } else {
      await ctx.deps.db
        .insert(rolePermissionOverrides)
        .values({ organizationId: ctx.auth.organizationId, role, permission: c.permission, granted: c.granted, createdBy: ctx.auth.userId })
        .onConflictDoUpdate({
          target: [rolePermissionOverrides.organizationId, rolePermissionOverrides.role, rolePermissionOverrides.permission],
          set: { granted: c.granted, updatedBy: ctx.auth.userId },
        });
    }
  }
  invalidatePermissionCache(ctx.auth.organizationId);
  return rolesMatrix(ctx);
}

// --- Stage templates ------------------------------------------------------------------

export async function listStageTemplates(ctx: Ctx) {
  requireInternal(ctx);
  return ctx.deps.db
    .select()
    .from(stageTemplates)
    .where(and(eq(stageTemplates.organizationId, ctx.auth.organizationId), eq(stageTemplates.isActive, true)))
    .orderBy(asc(stageTemplates.sortOrder));
}

export async function upsertStageTemplate(ctx: Ctx, input: z.infer<typeof stageTemplateSchema>, id?: string) {
  await requirePermission(ctx, "stage_template:manage");
  if (id) {
    const [row] = await ctx.deps.db
      .update(stageTemplates)
      .set({ ...input, updatedBy: ctx.auth.userId })
      .where(and(eq(stageTemplates.id, id), eq(stageTemplates.organizationId, ctx.auth.organizationId)))
      .returning();
    if (!row) throw notFound("Stage template");
    return row;
  }
  const [dupe] = await ctx.deps.db
    .select({ id: stageTemplates.id })
    .from(stageTemplates)
    .where(and(eq(stageTemplates.organizationId, ctx.auth.organizationId), eq(stageTemplates.key, input.key)));
  if (dupe) throw new AppError("conflict", "A stage with this key already exists");
  const [row] = await ctx.deps.db
    .insert(stageTemplates)
    .values({ ...input, organizationId: ctx.auth.organizationId, createdBy: ctx.auth.userId })
    .returning();
  return row!;
}

export async function deactivateStageTemplate(ctx: Ctx, id: string) {
  await requirePermission(ctx, "stage_template:manage");
  await ctx.deps.db
    .update(stageTemplates)
    .set({ isActive: false })
    .where(and(eq(stageTemplates.id, id), eq(stageTemplates.organizationId, ctx.auth.organizationId)));
}

export async function listIntegrations(ctx: Ctx) {
  await requirePermission(ctx, "integration:manage");
  const rows = await ctx.deps.db
    .select({ id: integrations.id, provider: integrations.provider, kind: integrations.kind, isEnabled: integrations.isEnabled, updatedAt: integrations.updatedAt })
    .from(integrations)
    .where(eq(integrations.organizationId, ctx.auth.organizationId));
  return {
    connected: rows,
    available: {
      design: ctx.deps.designs.list(),
      weather: [{ id: ctx.deps.weather.id }],
      storage: [{ id: ctx.deps.storage.driver }],
      push: [{ id: ctx.deps.push.id }],
      ai: ctx.deps.ai ? [{ id: ctx.deps.ai.id }] : [],
    },
  };
}

