import { and, asc, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { clients, projects, properties, users } from "@pool/database";
import type { ClientInput, PropertyInput } from "@pool/validation";
import { updateClientSchema, updatePropertySchema, z } from "@pool/validation";
import type { Ctx } from "../context";
import { badRequest, notFound } from "../lib/errors";
import { decodeCursor, page } from "../lib/http";
import { loadProject, projectAccessCondition, requireInternal, requirePermission } from "./access";
import { recordActivity } from "./activity";
import { clientOut, propertyOut } from "./mappers";

export async function listClients(ctx: Ctx, q: { q?: string; cursor?: string; limit: number }) {
  await requirePermission(ctx, "client:read");
  requireInternal(ctx);
  const offset = decodeCursor(q.cursor);
  const like = q.q ? `%${q.q.replace(/[%_]/g, "\\$&")}%` : null;
  const rows = await ctx.deps.db
    .select({
      client: clients,
      projectCount: sql<number>`(select count(*)::int from ${projects} p where p.client_id = ${clients.id} and p.deleted_at is null)`,
    })
    .from(clients)
    .where(
      and(
        eq(clients.organizationId, ctx.auth.organizationId),
        isNull(clients.deletedAt),
        like ? or(ilike(clients.firstName, like), ilike(clients.lastName, like), ilike(clients.email, like), ilike(clients.phone, like)) : undefined,
      ),
    )
    .orderBy(asc(clients.lastName), asc(clients.firstName))
    .limit(q.limit + 1)
    .offset(offset);
  return page(rows.map((r) => ({ ...clientOut(r.client), projectCount: r.projectCount })), q.limit, offset);
}

async function loadClient(ctx: Ctx, clientId: string) {
  if (ctx.auth.role === "client" && ctx.auth.clientId !== clientId) throw notFound("Client");
  const [row] = await ctx.deps.db
    .select()
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.organizationId, ctx.auth.organizationId), isNull(clients.deletedAt)));
  if (!row) throw notFound("Client");
  return row;
}

/** Client record with properties, project history and portal users. */
export async function getClient(ctx: Ctx, clientId: string) {
  await requirePermission(ctx, "client:read");
  const client = await loadClient(ctx, clientId);
  const props = await ctx.deps.db.select().from(properties).where(and(eq(properties.clientId, clientId), isNull(properties.deletedAt)));
  const history = await ctx.deps.db
    .select({ id: projects.id, number: projects.number, name: projects.name, status: projects.status, plannedStartDate: projects.plannedStartDate, plannedCompletionDate: projects.plannedCompletionDate, contractAmountCents: projects.contractAmountCents })
    .from(projects)
    .where(and(eq(projects.clientId, clientId), isNull(projects.deletedAt), projectAccessCondition(ctx)))
    .orderBy(desc(projects.createdAt));
  const portalUsers = await ctx.deps.db
    .select({ id: users.id, email: users.email, fullName: users.fullName, isActive: users.isActive, lastLoginAt: users.lastLoginAt })
    .from(users)
    .where(eq(users.clientId, clientId));
  return { ...clientOut(client), properties: props.map(propertyOut), projects: history, portalUsers };
}

export async function createClient(ctx: Ctx, input: ClientInput) {
  await requirePermission(ctx, "client:manage");
  const { id, ...values } = input;
  const [row] = await ctx.deps.db
    .insert(clients)
    .values({ ...(id ? { id } : {}), ...values, organizationId: ctx.auth.organizationId, createdBy: ctx.auth.userId, updatedBy: ctx.auth.userId })
    .returning();
  await recordActivity(ctx, { projectId: null, action: "client.created", entityType: "client", entityId: row!.id, summary: `added client ${values.firstName} ${values.lastName}` });
  return clientOut(row!);
}

export async function updateClient(ctx: Ctx, clientId: string, input: z.infer<typeof updateClientSchema>) {
  await requirePermission(ctx, "client:manage");
  await loadClient(ctx, clientId);
  const [row] = await ctx.deps.db.update(clients).set({ ...input, updatedBy: ctx.auth.userId }).where(eq(clients.id, clientId)).returning();
  return clientOut(row!);
}

export async function getProperty(ctx: Ctx, propertyId: string) {
  await requirePermission(ctx, "property:read");
  const [row] = await ctx.deps.db
    .select()
    .from(properties)
    .where(and(eq(properties.id, propertyId), eq(properties.organizationId, ctx.auth.organizationId), isNull(properties.deletedAt)));
  if (!row) throw notFound("Property");
  if (ctx.auth.role !== "admin") {
    // Non-admins reach a property through a project they can see.
    const [visible] = await ctx.deps.db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.propertyId, propertyId), projectAccessCondition(ctx)))
      .limit(1);
    if (!visible && !(ctx.auth.role === "project_manager" || ctx.auth.role === "designer")) throw notFound("Property");
  }
  return propertyOut(row);
}

export async function createProperty(ctx: Ctx, input: PropertyInput) {
  await requirePermission(ctx, "property:manage");
  await loadClient(ctx, input.clientId);
  const { location, id, ...rest } = input;
  const [row] = await ctx.deps.db
    .insert(properties)
    .values({
      ...(id ? { id } : {}),
      ...rest,
      organizationId: ctx.auth.organizationId,
      city: rest.address.city,
      latitude: location?.latitude ?? null,
      longitude: location?.longitude ?? null,
      locationAccuracyM: location?.accuracyMeters ?? null,
      createdBy: ctx.auth.userId,
      updatedBy: ctx.auth.userId,
    })
    .returning();
  return propertyOut(row!);
}

export async function updateProperty(ctx: Ctx, propertyId: string, input: z.infer<typeof updatePropertySchema>) {
  await requirePermission(ctx, "property:manage");
  await getProperty(ctx, propertyId);
  const { location, ...rest } = input;
  const [row] = await ctx.deps.db
    .update(properties)
    .set({
      ...rest,
      ...(rest.address ? { city: rest.address.city } : {}),
      ...(location !== undefined
        ? { latitude: location?.latitude ?? null, longitude: location?.longitude ?? null, locationAccuracyM: location?.accuracyMeters ?? null }
        : {}),
      updatedBy: ctx.auth.userId,
    })
    .where(eq(properties.id, propertyId))
    .returning();
  const [project] = await ctx.deps.db.select({ id: projects.id }).from(projects).where(eq(projects.propertyId, propertyId)).limit(1);
  await recordActivity(ctx, { projectId: project?.id ?? null, action: "property.updated", entityType: "property", entityId: propertyId, summary: "updated the property profile", metadata: { fields: Object.keys(input) } });
  return propertyOut(row!);
}

/** The property behind a project (property tab). */
export async function projectProperty(ctx: Ctx, projectId: string) {
  const project = await loadProject(ctx, projectId);
  const [row] = await ctx.deps.db.select().from(properties).where(eq(properties.id, project.propertyId));
  if (!row) throw badRequest("Project has no property");
  return propertyOut(row);
}
