import { and, eq, gte, inArray, isNull, lte, notInArray } from "drizzle-orm";
import { addCalendarDays, evaluateWeatherRisks, todayISO } from "@pool/core";
import { organizations, projectStages, projects, properties, tasks, weatherAlerts } from "@pool/database";
import { ACTIVE_PROJECT_STATUSES } from "@pool/types";
import type { Ctx, Deps } from "../context";
import { AppError } from "../lib/errors";
import { loadProject } from "./access";
import { notify, projectStakeholders } from "./notifications";

const FORECAST_DAYS = 7;

async function weatherSensitiveWork(deps: Deps, projectId: string, from: string, to: string) {
  return deps.db
    .select({ id: tasks.id, title: tasks.title, plannedStartDate: tasks.plannedStartDate, plannedEndDate: tasks.plannedEndDate, stageKey: projectStages.key, assigneeId: tasks.assigneeId })
    .from(tasks)
    .leftJoin(projectStages, eq(projectStages.id, tasks.stageId))
    .where(
      and(
        eq(tasks.projectId, projectId),
        isNull(tasks.deletedAt),
        eq(tasks.weatherSensitive, true),
        notInArray(tasks.status, ["done", "cancelled"]),
        lte(tasks.plannedStartDate, to),
        gte(tasks.plannedEndDate, from),
      ),
    );
}

/**
 * Current conditions, a 7-day forecast for the project's property (address
 * captured once at project creation) and warnings for weather-sensitive work.
 * Warnings never move the schedule; the UI offers a preview first.
 */
export async function projectWeather(ctx: Ctx, projectId: string) {
  const project = await loadProject(ctx, projectId);
  const [property] = await ctx.deps.db.select().from(properties).where(eq(properties.id, project.propertyId));
  if (property?.latitude == null || property.longitude == null) {
    throw new AppError("precondition_failed", "Add the property's location to see weather");
  }
  const [org] = await ctx.deps.db.select().from(organizations).where(eq(organizations.id, ctx.auth.organizationId));
  let report;
  try {
    report = await ctx.deps.weather.getForecast(property.latitude, property.longitude, FORECAST_DAYS);
  } catch (error) {
    ctx.deps.log.warn({ err: error }, "weather provider failed");
    throw new AppError("service_unavailable", "Weather is temporarily unavailable");
  }
  const today = todayISO(org?.timezone);
  const work = await weatherSensitiveWork(ctx.deps, projectId, today, addCalendarDays(today, FORECAST_DAYS));
  const warnings = evaluateWeatherRisks(
    work.filter((w) => w.plannedStartDate && w.plannedEndDate) as { id: string; title: string; plannedStartDate: string; plannedEndDate: string; stageKey: string | null }[],
    report.daily,
    org?.settings.weather,
  );
  return { ...report, warnings };
}

/**
 * Worker job: check every active project's weather-sensitive work, store
 * deduplicated alerts and notify the PM/supervisor and assignees.
 */
export async function scanWeather(deps: Deps): Promise<{ projects: number; alerts: number }> {
  const rows = await deps.db
    .select({ id: projects.id, name: projects.name, organizationId: projects.organizationId, latitude: properties.latitude, longitude: properties.longitude, settings: organizations.settings, timezone: organizations.timezone })
    .from(projects)
    .innerJoin(properties, eq(properties.id, projects.propertyId))
    .innerJoin(organizations, eq(organizations.id, projects.organizationId))
    .where(and(inArray(projects.status, [...ACTIVE_PROJECT_STATUSES]), isNull(projects.archivedAt), isNull(projects.deletedAt)));
  let alertCount = 0;
  for (const p of rows) {
    if (p.latitude == null || p.longitude == null) continue;
    const today = todayISO(p.timezone);
    const work = (await weatherSensitiveWork(deps, p.id, today, addCalendarDays(today, FORECAST_DAYS))).filter(
      (w) => w.plannedStartDate && w.plannedEndDate,
    );
    if (!work.length) continue;
    let report;
    try {
      report = await deps.weather.getForecast(p.latitude, p.longitude, FORECAST_DAYS);
    } catch (error) {
      deps.log.warn({ err: error, projectId: p.id }, "weather scan failed for project");
      continue;
    }
    const warnings = evaluateWeatherRisks(work as never, report.daily, p.settings.weather);
    for (const w of warnings) {
      if (w.severity === "advisory") continue;
      const [inserted] = await deps.db
        .insert(weatherAlerts)
        .values({ projectId: p.id, taskId: w.taskId, forDate: w.date, severity: w.severity, message: w.message, reasons: w.reasons })
        .onConflictDoUpdate({
          target: [weatherAlerts.projectId, weatherAlerts.taskId, weatherAlerts.forDate],
          set: { severity: w.severity, message: w.message, reasons: w.reasons },
        })
        .returning();
      if (!inserted) continue;
      alertCount += 1;
      const assignee = work.find((x) => x.id === w.taskId)?.assigneeId;
      await notify(deps, {
        organizationId: p.organizationId,
        userIds: [...(await projectStakeholders(deps.db, p.id, ["project_manager", "field_supervisor"])), ...(assignee ? [assignee] : [])],
        type: "weather_warning",
        projectId: p.id,
        title: `Weather warning: ${p.name}`,
        body: w.message,
        data: { taskId: w.taskId, date: w.date },
        dedupeKey: `weather:${w.taskId}:${w.date}:${w.severity}`,
      });
    }
  }
  return { projects: rows.length, alerts: alertCount };
}
