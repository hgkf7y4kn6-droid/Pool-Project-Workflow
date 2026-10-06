import { and, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { changeOrders, clients, documents, materials, photos, projects, tasks } from "@pool/database";
import type { z } from "zod";
import type { searchQuery } from "@pool/validation";
import type { Ctx } from "../context";
import { accessibleProjectIds, hasPermission, isInternal, taskVisibilityCondition } from "./access";

type Hit = { type: string; id: string; title: string; subtitle: string | null; projectId: string | null };

/** Build a prefix tsquery ("exc plum" → 'exc':* & 'plum':*) from user input safely. */
function prefixQuery(q: string): string {
  return q
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean)
    .map((t) => `${t}:*`)
    .join(" & ");
}

/** Global search across entities the user can see, using the GIN full-text indexes. */
export async function globalSearch(ctx: Ctx, input: z.infer<typeof searchQuery>) {
  const types = new Set(input.types ?? ["project", "client", "task", "document", "photo", "material", "change_order"]);
  const tsq = prefixQuery(input.q);
  if (!tsq) return [];
  const like = `%${input.q.replace(/[%_]/g, "\\$&")}%`;
  const ids = await accessibleProjectIds(ctx);
  const db = ctx.deps.db;
  const limit = input.limit;
  const hits: Hit[] = [];
  const inIds = (col: Parameters<typeof inArray>[0]) => (ids.length ? inArray(col, ids) : sql`false`);

  if (types.has("project")) {
    const rows = await db
      .select({ id: projects.id, name: projects.name, number: projects.number, status: projects.status })
      .from(projects)
      .where(
        and(
          inIds(projects.id),
          or(
            sql`to_tsvector('simple', ${projects.name} || ' ' || ${projects.number} || ' ' || coalesce(${projects.description}, '')) @@ to_tsquery('simple', ${tsq})`,
            ilike(projects.number, like),
          ),
        ),
      )
      .limit(limit);
    hits.push(...rows.map((r) => ({ type: "project", id: r.id, title: r.name, subtitle: `${r.number} · ${r.status}`, projectId: r.id })));
  }
  if (types.has("client") && isInternal(ctx)) {
    const rows = await db
      .select({ id: clients.id, first: clients.firstName, last: clients.lastName, email: clients.email })
      .from(clients)
      .where(
        and(
          eq(clients.organizationId, ctx.auth.organizationId),
          isNull(clients.deletedAt),
          sql`to_tsvector('simple', ${clients.firstName} || ' ' || ${clients.lastName} || ' ' || coalesce(${clients.email}, '')) @@ to_tsquery('simple', ${tsq})`,
        ),
      )
      .limit(limit);
    hits.push(...rows.map((r) => ({ type: "client", id: r.id, title: `${r.first} ${r.last}`, subtitle: r.email, projectId: null })));
  }
  if (types.has("task") && ctx.auth.role !== "client") {
    const rows = await db
      .select({ id: tasks.id, title: tasks.title, status: tasks.status, projectId: tasks.projectId, projectName: projects.name })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(
        and(
          inIds(tasks.projectId),
          isNull(tasks.deletedAt),
          taskVisibilityCondition(ctx),
          sql`to_tsvector('simple', ${tasks.title} || ' ' || coalesce(${tasks.description}, '')) @@ to_tsquery('simple', ${tsq})`,
        ),
      )
      .orderBy(desc(tasks.updatedAt))
      .limit(limit);
    hits.push(...rows.map((r) => ({ type: "task", id: r.id, title: r.title, subtitle: `${r.projectName} · ${r.status}`, projectId: r.projectId })));
  }
  if (types.has("document") && (await hasPermission(ctx, "document:read"))) {
    const rows = await db
      .select({ id: documents.id, title: documents.title, category: documents.category, projectId: documents.projectId })
      .from(documents)
      .where(
        and(
          eq(documents.organizationId, ctx.auth.organizationId),
          isNull(documents.deletedAt),
          isInternal(ctx) ? or(isNull(documents.projectId), inIds(documents.projectId)) : inIds(documents.projectId),
          ctx.auth.role === "client" ? eq(documents.visibility, "client") : undefined,
          or(
            sql`to_tsvector('simple', ${documents.title} || ' ' || coalesce(${documents.description}, '')) @@ to_tsquery('simple', ${tsq})`,
            sql`${input.q.toLowerCase()} = any(${documents.tags})`,
          ),
        ),
      )
      .limit(limit);
    hits.push(...rows.map((r) => ({ type: "document", id: r.id, title: r.title, subtitle: r.category, projectId: r.projectId })));
  }
  if (types.has("photo")) {
    const rows = await db
      .select({ id: photos.id, caption: photos.caption, kind: photos.kind, projectId: photos.projectId })
      .from(photos)
      .where(and(inIds(photos.projectId), isNull(photos.deletedAt), ilike(photos.caption, like), ctx.auth.role === "client" ? eq(photos.visibility, "client") : undefined))
      .limit(limit);
    hits.push(...rows.map((r) => ({ type: "photo", id: r.id, title: r.caption ?? "Photo", subtitle: r.kind, projectId: r.projectId })));
  }
  if (types.has("material") && (await hasPermission(ctx, "material:read"))) {
    const rows = await db
      .select({ id: materials.id, name: materials.name, sku: materials.sku })
      .from(materials)
      .where(
        and(
          eq(materials.organizationId, ctx.auth.organizationId),
          sql`to_tsvector('simple', ${materials.name} || ' ' || coalesce(${materials.sku}, '')) @@ to_tsquery('simple', ${tsq})`,
        ),
      )
      .limit(limit);
    hits.push(...rows.map((r) => ({ type: "material", id: r.id, title: r.name, subtitle: r.sku, projectId: null })));
  }
  if (types.has("change_order") && (await hasPermission(ctx, "change_order:read"))) {
    const rows = await db
      .select({ id: changeOrders.id, title: changeOrders.title, number: changeOrders.number, projectId: changeOrders.projectId, status: changeOrders.status })
      .from(changeOrders)
      .where(
        and(
          inIds(changeOrders.projectId),
          isNull(changeOrders.deletedAt),
          or(ilike(changeOrders.title, like), ilike(changeOrders.description, like)),
          ctx.auth.role === "client" ? sql`${changeOrders.status} not in ('draft','submitted')` : undefined,
        ),
      )
      .limit(limit);
    hits.push(...rows.map((r) => ({ type: "change_order", id: r.id, title: `CO #${r.number}: ${r.title}`, subtitle: r.status, projectId: r.projectId })));
  }
  return hits;
}
