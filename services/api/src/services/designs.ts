import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { designModels, designProjects, measurements, properties } from "@pool/database";
import { designModelSchema, designProjectSchema, z } from "@pool/validation";
import type { Ctx } from "../context";
import { AppError, badRequest, notFound } from "../lib/errors";
import { storageKeys } from "../adapters/storage/types";
import { loadProject, requirePermission } from "./access";
import { formatAddress } from "./mappers";

async function loadDesign(ctx: Ctx, designId: string) {
  const [row] = await ctx.deps.db.select().from(designProjects).where(eq(designProjects.id, designId));
  if (!row) throw notFound("Design");
  await loadProject(ctx, row.projectId);
  return row;
}

async function modelsWithUrls(ctx: Ctx, rows: (typeof designModels.$inferSelect)[]) {
  return Promise.all(
    rows
      .filter((m) => ctx.auth.role !== "client" || m.clientVisible)
      .map(async (m) => ({
        ...m,
        url: m.storageKey
          ? await ctx.deps.storage.createDownloadUrl(m.storageKey, { expiresInSeconds: ctx.deps.env.SIGNED_URL_TTL_SECONDS })
          : m.externalUrl,
      })),
  );
}

export async function listDesigns(ctx: Ctx, projectId: string) {
  await loadProject(ctx, projectId);
  await requirePermission(ctx, "design:read");
  const designs = await ctx.deps.db
    .select()
    .from(designProjects)
    .where(eq(designProjects.projectId, projectId))
    .orderBy(desc(designProjects.createdAt));
  const models = designs.length
    ? await ctx.deps.db.select().from(designModels).where(inArray(designModels.designProjectId, designs.map((d) => d.id)))
    : [];
  const withUrls = await modelsWithUrls(ctx, models);
  return {
    providers: ctx.deps.designs.list(),
    designs: designs.map((d) => ({ ...d, models: withUrls.filter((m) => m.designProjectId === d.id) })),
  };
}

/**
 * Create a design. For an external provider, the project's property and
 * measurements are sent through the provider-agnostic contract so designers
 * start from real site data.
 */
export async function createDesign(ctx: Ctx, projectId: string, input: z.infer<typeof designProjectSchema>) {
  const project = await loadProject(ctx, projectId);
  await requirePermission(ctx, "design:manage");
  let externalId = input.externalId ?? null;
  if (input.provider !== "manual") {
    const provider = ctx.deps.designs.get(input.provider);
    if (!provider) throw badRequest(`Unknown design provider ${input.provider}`);
    const [property] = await ctx.deps.db.select().from(properties).where(eq(properties.id, project.propertyId));
    const ms = await ctx.deps.db.select().from(measurements).where(and(eq(measurements.projectId, projectId), isNull(measurements.deletedAt)));
    try {
      const ref = await provider.createProject({
        title: input.title,
        projectNumber: project.number,
        propertyAddress: formatAddress(property?.address),
        location: property?.latitude != null && property.longitude != null ? { latitude: property.latitude, longitude: property.longitude } : null,
        measurements: ms.map((m) => ({ label: m.label, category: m.category, value: m.value, unit: m.unit, geometry: m.geometry })),
      });
      externalId = ref.externalId;
    } catch (error) {
      ctx.deps.log.warn({ err: error }, "design provider createProject failed");
      throw new AppError("service_unavailable", "The design platform could not be reached");
    }
  }
  const [row] = await ctx.deps.db
    .insert(designProjects)
    .values({ projectId, provider: input.provider, title: input.title, externalId, summary: input.summary ?? null, createdBy: ctx.auth.userId })
    .returning();
  return row!;
}

export async function updateDesignSummary(ctx: Ctx, designId: string, input: Partial<z.infer<typeof designProjectSchema>> & { status?: "draft" | "in_review" | "approved" | "superseded" }) {
  const design = await loadDesign(ctx, designId);
  await requirePermission(ctx, "design:manage");
  if (design.provider !== "manual" && design.externalId) {
    const provider = ctx.deps.designs.get(design.provider);
    await provider?.updateDesign(design.externalId, { title: input.title, status: input.status, summary: input.summary ?? undefined });
  }
  const [row] = await ctx.deps.db
    .update(designProjects)
    .set({ title: input.title ?? design.title, summary: input.summary ?? design.summary, status: input.status ?? design.status, updatedBy: ctx.auth.userId })
    .where(eq(designProjects.id, designId))
    .returning();
  return row!;
}

/** Pull the latest design, 3D model and renderings from the external provider. */
export async function syncDesign(ctx: Ctx, designId: string) {
  const design = await loadDesign(ctx, designId);
  await requirePermission(ctx, "design:manage");
  if (design.provider === "manual" || !design.externalId) return design;
  const provider = ctx.deps.designs.get(design.provider);
  if (!provider) throw badRequest("Design provider is no longer configured");
  const [remote, model, renderings] = await Promise.all([
    provider.getDesign(design.externalId),
    provider.get3DModel(design.externalId),
    provider.getRendering(design.externalId),
  ]);
  await ctx.deps.db.transaction(async (tx) => {
    await tx
      .update(designProjects)
      .set({ title: remote.title, status: remote.status, summary: remote.summary, lastSyncedAt: new Date().toISOString() })
      .where(eq(designProjects.id, designId));
    // Replace provider-sourced models (those without our own storage key).
    const existing = await tx.select().from(designModels).where(eq(designModels.designProjectId, designId));
    for (const m of existing.filter((x) => !x.storageKey && x.externalUrl)) {
      await tx.delete(designModels).where(eq(designModels.id, m.id));
    }
    if (model) {
      await tx.insert(designModels).values({ designProjectId: designId, kind: "model_3d", title: "3D model", format: model.format, externalUrl: model.url });
    }
    for (const r of renderings) {
      await tx.insert(designModels).values({ designProjectId: designId, kind: r.kind, title: r.title, format: "image", externalUrl: r.url });
    }
  });
  return (await listDesigns(ctx, design.projectId)).designs.find((d) => d.id === designId)!;
}

/** Attach a model/rendering: either an external URL or an upload to object storage. */
export async function addDesignModel(ctx: Ctx, designId: string, input: z.infer<typeof designModelSchema>) {
  const design = await loadDesign(ctx, designId);
  await requirePermission(ctx, "design:manage");
  if (!input.externalUrl && !input.file) throw badRequest("Provide an external URL or a file");
  const id = crypto.randomUUID();
  const storageKey = input.file ? storageKeys.designModel(ctx.auth.organizationId, design.id, id, input.file.fileName) : null;
  const [row] = await ctx.deps.db
    .insert(designModels)
    .values({ id, designProjectId: designId, kind: input.kind, title: input.title, format: input.format, externalUrl: input.externalUrl ?? null, storageKey, createdBy: ctx.auth.userId })
    .returning();
  const upload = input.file && storageKey ? await ctx.deps.storage.createUploadUrl(storageKey, { contentType: input.file.mimeType, expiresInSeconds: 3600 }) : null;
  return { model: row!, upload };
}
