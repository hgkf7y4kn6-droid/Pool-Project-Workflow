import { and, asc, eq, isNull } from "drizzle-orm";
import { measurements, properties, type DbOrTx } from "@pool/database";
import type { MeasurementInput } from "@pool/validation";
import { updateMeasurementSchema, z } from "@pool/validation";
import type { Ctx } from "../context";
import { badRequest, notFound } from "../lib/errors";
import { loadProject, requirePermission } from "./access";
import { recordActivity } from "./activity";
import { measurementOut } from "./mappers";

export async function listMeasurements(ctx: Ctx, projectId: string) {
  await loadProject(ctx, projectId);
  await requirePermission(ctx, "measurement:read");
  const rows = await ctx.deps.db
    .select()
    .from(measurements)
    .where(and(eq(measurements.projectId, projectId), isNull(measurements.deletedAt)))
    .orderBy(asc(measurements.category), asc(measurements.label));
  return rows.map(measurementOut);
}

export async function createMeasurement(ctx: Ctx, projectId: string, input: MeasurementInput, db: DbOrTx = ctx.deps.db) {
  const project = await loadProject(ctx, projectId, db);
  await requirePermission(ctx, "measurement:create");
  const propertyId = input.propertyId ?? project.propertyId;
  if (propertyId !== project.propertyId) {
    const [p] = await db.select({ id: properties.id }).from(properties).where(eq(properties.id, propertyId));
    if (!p) throw badRequest("Unknown property");
  }
  const { location, id, ...rest } = input;
  const [row] = await db
    .insert(measurements)
    .values({
      ...(id ? { id } : {}),
      ...rest,
      projectId,
      propertyId,
      latitude: location?.latitude ?? null,
      longitude: location?.longitude ?? null,
      locationAccuracyM: location?.accuracyMeters ?? null,
      createdBy: ctx.auth.userId,
      updatedBy: ctx.auth.userId,
    })
    .returning();
  await recordActivity(
    ctx,
    { projectId, action: "measurement.recorded", entityType: "measurement", entityId: row!.id, summary: `recorded ${input.label}: ${input.value} ${input.unit}` },
    db,
  );
  return measurementOut(row!);
}

export async function updateMeasurement(ctx: Ctx, measurementId: string, input: z.infer<typeof updateMeasurementSchema>, db: DbOrTx = ctx.deps.db) {
  const [current] = await db.select().from(measurements).where(and(eq(measurements.id, measurementId), isNull(measurements.deletedAt)));
  if (!current) throw notFound("Measurement");
  await loadProject(ctx, current.projectId, db);
  await requirePermission(ctx, "measurement:create");
  const { location, ...rest } = input;
  const [row] = await db
    .update(measurements)
    .set({
      ...rest,
      ...(location !== undefined
        ? { latitude: location?.latitude ?? null, longitude: location?.longitude ?? null, locationAccuracyM: location?.accuracyMeters ?? null }
        : {}),
      updatedBy: ctx.auth.userId,
    })
    .where(eq(measurements.id, measurementId))
    .returning();
  return measurementOut(row!);
}

export async function deleteMeasurement(ctx: Ctx, measurementId: string) {
  const [current] = await ctx.deps.db.select().from(measurements).where(eq(measurements.id, measurementId));
  if (!current) throw notFound("Measurement");
  await loadProject(ctx, current.projectId);
  await requirePermission(ctx, "measurement:create");
  await ctx.deps.db.update(measurements).set({ deletedAt: new Date().toISOString() }).where(eq(measurements.id, measurementId));
}

/**
 * CAD/design-platform export. JSON keeps full geometry (points/polygons/depth
 * profiles relative to a site datum); CSV is a flat table for spreadsheets.
 */
export async function exportMeasurements(ctx: Ctx, projectId: string, format: "json" | "csv") {
  const project = await loadProject(ctx, projectId);
  const rows = await listMeasurements(ctx, projectId);
  if (format === "json") {
    return {
      contentType: "application/json",
      fileName: `${project.number}-measurements.json`,
      body: JSON.stringify(
        {
          schema: "pool-pm.measurements/v1",
          project: { id: project.id, number: project.number, name: project.name },
          datum: "Site datum (0,0,0) as defined by the field team; units per measurement",
          exportedAt: new Date().toISOString(),
          measurements: rows.map((m) => ({
            id: m.id,
            category: m.category,
            label: m.label,
            value: m.value,
            unit: m.unit,
            geometry: m.geometry,
            location: m.location,
            notes: m.notes,
            measuredAt: m.measuredAt,
          })),
        },
        null,
        2,
      ),
    };
  }
  const header = ["category", "label", "value", "unit", "latitude", "longitude", "geometry", "notes", "measured_at"];
  const lines = rows.map((m) =>
    [m.category, m.label, m.value, m.unit, m.location?.latitude ?? "", m.location?.longitude ?? "", m.geometry ? JSON.stringify(m.geometry) : "", m.notes ?? "", m.measuredAt]
      .map(csvCell)
      .join(","),
  );
  return { contentType: "text/csv", fileName: `${project.number}-measurements.csv`, body: [header.join(","), ...lines].join("\n") };
}

export function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  // Neutralize spreadsheet formula injection and quote when needed.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
