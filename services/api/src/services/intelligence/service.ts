import { createHash } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import {
  addCalendarDays,
  diffCalendarDays,
  evaluateProject,
  evaluateStageReadiness,
  findResourceConflicts,
  resolveIntelligenceSettings,
  todayISO,
  type Finding,
  type ProjectEvaluation,
} from "@pool/core";
import {
  agentRuns,
  intelligenceEvaluations,
  intelligenceRecommendations,
  organizations,
  projects,
  tasks,
  teams,
  users,
  vendors,
} from "@pool/database";
import {
  ACTIVE_PROJECT_STATUSES,
  ACTIVE_RECOMMENDATION_STATUSES,
  SEVERITIES,
  type AgentRun,
  type Citation,
  type IntelligenceAnswer,
  type IntelligenceSettings,
  type PortfolioOverview,
  type ProjectBriefing,
  type ProjectIntelligence,
  type Severity,
} from "@pool/types";
import type { intelligenceSettingsSchema, z } from "@pool/validation";
import type { Deps, Ctx } from "../../context";
import { AppError, notFound } from "../../lib/errors";
import { decodeCursor, page } from "../../lib/http";
import { AgentProviderError, askResponseSchema, briefingResponseSchema } from "../../adapters/agents/types";
import { accessibleProjectIds, hasPermission, loadProject, requirePermission } from "../access";
import { activeRecommendations, checkContradiction, checkProposedActions, requestBase, runAgent, validateCitations } from "./agents";
import { evaluateAndPersist, notifyRecommendation, recordRecommendationEvent } from "./evaluator";
import { projectRecommendations, toRecommendation } from "./recommendations";
import { loadSnapshot } from "./snapshot";

/** Reuse a stored evaluation this fresh instead of re-reading the project. */
const EVALUATION_FRESH_MS = 2 * 60_000;
/** Statuses that get proactive scans. */
const SCANNED_STATUSES = [...ACTIVE_PROJECT_STATUSES, "completed", "warranty"] as const;

export function agentProviderId(deps: Deps): ProjectIntelligence["agentProvider"] {
  return deps.agents?.id ?? "none";
}

async function orgSettings(deps: Deps, organizationId: string): Promise<IntelligenceSettings> {
  const [org] = await deps.db.select({ settings: organizations.settings }).from(organizations).where(eq(organizations.id, organizationId));
  return resolveIntelligenceSettings(org?.settings);
}

// ---------------------------------------------------------------------------
// Project intelligence (briefing, readiness, recommendations)
// ---------------------------------------------------------------------------

export async function getProjectIntelligence(ctx: Ctx, projectId: string): Promise<ProjectIntelligence> {
  await loadProject(ctx, projectId);
  await requirePermission(ctx, "intelligence:read");
  const [latest] = await ctx.deps.db
    .select()
    .from(intelligenceEvaluations)
    .where(eq(intelligenceEvaluations.projectId, projectId))
    .orderBy(desc(intelligenceEvaluations.createdAt))
    .limit(1);
  let readiness = latest?.readiness;
  let briefing = latest?.briefing;
  let evaluatedAt = latest?.createdAt ?? null;
  let inputHash = latest?.inputHash ?? null;
  if (!latest || ctx.deps.now().getTime() - Date.parse(latest.createdAt) > EVALUATION_FRESH_MS) {
    const outcome = await evaluateAndPersist(ctx.deps, ctx.auth.organizationId, projectId, { trigger: "view", actorId: ctx.auth.userId });
    if (!outcome) throw notFound("Project");
    readiness = outcome.evaluation.readiness;
    briefing = outcome.evaluation.briefing;
    evaluatedAt = ctx.deps.now().toISOString();
    inputHash = outcome.inputHash;
  }
  const recommendations = await projectRecommendations(ctx, projectId);
  const counts = Object.fromEntries(SEVERITIES.map((s) => [s, recommendations.filter((r) => r.severity === s && r.status !== "snoozed").length])) as Record<Severity, number>;
  return {
    briefing: await withNarrative(ctx.deps, projectId, linkActions(briefing!, recommendations), inputHash),
    readiness: readiness!,
    counts,
    recommendations,
    lastEvaluatedAt: evaluatedAt,
    agentProvider: agentProviderId(ctx.deps),
  };
}

/** Point briefing actions at their stored recommendations so the UI can link them. */
function linkActions(briefing: ProjectBriefing, recs: { id: string; title: string }[]): ProjectBriefing {
  const byTitle = new Map(recs.map((r) => [r.title, r.id]));
  const link = (a: ProjectBriefing["blockers"][number]) => ({ ...a, recommendationId: a.recommendationId ?? byTitle.get(a.text.split(" — ")[0]!) ?? null });
  return { ...briefing, blockers: briefing.blockers.map(link), todayActions: briefing.todayActions.map(link) };
}

/** Attach the latest agent narrative; mark it stale if the project data changed since. */
async function withNarrative(deps: Deps, projectId: string, briefing: ProjectBriefing, inputHash: string | null): Promise<ProjectBriefing> {
  const [run] = await deps.db
    .select({ output: agentRuns.output, finishedAt: agentRuns.finishedAt, key: agentRuns.idempotencyKey })
    .from(agentRuns)
    .where(and(eq(agentRuns.projectId, projectId), eq(agentRuns.kind, "briefing"), eq(agentRuns.status, "succeeded")))
    .orderBy(desc(agentRuns.finishedAt))
    .limit(1);
  if (!run?.output) return briefing;
  const out = run.output as { narrative?: string; priorities?: { text: string; recommendationId: string | null }[] };
  return {
    ...briefing,
    source: "agent",
    narrative: out.narrative ?? null,
    narrativeAt: run.finishedAt,
    narrativeStale: !inputHash || !run.key.endsWith(inputHash),
  };
}

/** Re-run the rules now and queue an agent briefing (if a provider is configured). */
export async function analyzeProject(ctx: Ctx, projectId: string) {
  await loadProject(ctx, projectId);
  await requirePermission(ctx, "intelligence:manage");
  const outcome = await evaluateAndPersist(ctx.deps, ctx.auth.organizationId, projectId, { trigger: "manual", actorId: ctx.auth.userId, force: true });
  if (!outcome) throw notFound("Project");
  let briefingQueued = false;
  if (ctx.deps.agents) {
    await ctx.deps.jobs.enqueue("intelligence.briefing", { organizationId: ctx.auth.organizationId, projectId, requestedBy: ctx.auth.userId }, { jobId: `intel-brief:${projectId}:${outcome.inputHash}` });
    briefingQueued = true;
  }
  return { evaluationId: outcome.evaluationId, opened: outcome.opened, updated: outcome.updated, closed: outcome.closed, briefingQueued, intelligence: await getProjectIntelligence(ctx, projectId) };
}

/**
 * Background job: have the agents write a briefing narrative. Idempotent per
 * (project, input hash): unchanged data reuses the stored narrative. A failed
 * or rejected run leaves the deterministic briefing in place.
 */
export async function generateAgentBriefing(deps: Deps, organizationId: string, projectId: string, requestedBy: string | null): Promise<"succeeded" | "cached" | "skipped" | "failed"> {
  const provider = deps.agents;
  if (!provider) return "skipped";
  const loaded = await loadSnapshot(deps, organizationId, projectId);
  if (!loaded) return "skipped";
  const settings = resolveIntelligenceSettings(loaded.organization.settings);
  const outcome = await evaluateAndPersist(deps, organizationId, projectId, { trigger: "briefing", actorId: requestedBy });
  if (!outcome) return "skipped";
  const evaluation = outcome.evaluation;
  const recs = await activeRecommendations(deps, projectId);
  const recIds = new Set(recs.map((r) => r.id));
  try {
    const run = await runAgent(
      deps,
      provider,
      { organizationId, projectId, kind: "briefing", requestedBy, idempotencyKey: `briefing:${projectId}:${outcome.inputHash}`, input: outcome.inputHash, dailyLimit: settings.dailyAgentRunLimit },
      (runId) => provider.briefing({ ...requestBase(loaded, evaluation, recs, runId), kind: "briefing" }),
      (raw) => {
        const res = briefingResponseSchema.parse(raw); // never trust a provider implementation
        const base = requestBase(loaded, evaluation, recs, "validate");
        const { citations, issues } = validateCitations(base.records, res.citations);
        issues.push(...checkProposedActions(res.proposed_actions));
        const contradiction = checkContradiction(res.narrative, evaluation);
        const priorities = res.priorities.map((p) => ({
          text: p.text,
          recommendationId: p.recommendation_id && recIds.has(p.recommendation_id) ? p.recommendation_id : null,
          citations: validateCitations(base.records, p.citations).citations,
        }));
        return { output: { narrative: res.narrative, priorities, citations }, issues, reject: contradiction ?? undefined };
      },
    );
    return run.cached ? "cached" : "succeeded";
  } catch (err) {
    if (err instanceof AgentProviderError || err instanceof AppError) {
      deps.log.warn({ projectId, err: err.message }, "agent briefing unavailable; deterministic briefing kept");
      if (err instanceof AgentProviderError && err.retryable) throw err; // let the queue retry transient failures
      return "failed";
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Q&A
// ---------------------------------------------------------------------------

/** Deterministic answer from readiness and recommendations, with citations. */
function rulesAnswer(question: string, loaded: NonNullable<Awaited<ReturnType<typeof loadSnapshot>>>, evaluation: ProjectEvaluation, settings: IntelligenceSettings): IntelligenceAnswer {
  const q = question.toLowerCase();
  const stage = loaded.snapshot.stages.find((s) => q.includes(s.name.toLowerCase()) || q.includes(s.key.replace(/_/g, " ")));
  const citations: Citation[] = [];
  const cite = (e: { type: Citation["type"]; id: string; label: string } | null | undefined) => {
    if (e && !citations.some((c) => c.id === e.id && c.type === e.type)) citations.push({ type: e.type, id: e.id, label: e.label });
  };
  const lines: string[] = [];
  const readiness = stage ? evaluateStageReadiness(loaded.snapshot, settings, stage.id) : evaluation.readiness.nextMilestone;
  if (readiness) {
    const label = readiness.label === "ready" ? "ready" : readiness.label === "blocked" ? "not ready — it's blocked" : "at risk";
    lines.push(`${readiness.stageName} is ${label} (readiness ${readiness.score}/100${readiness.plannedStartDate ? `, planned start ${readiness.plannedStartDate}` : ""}).`);
    if (readiness.blockers.length) lines.push(`Blockers: ${readiness.blockers.join("; ")}.`);
    if (readiness.risks.length) lines.push(`Risks: ${readiness.risks.slice(0, 5).join("; ")}.`);
    if (readiness.missingData.length) lines.push(`Missing information: ${readiness.missingData.slice(0, 4).join("; ")}.`);
    for (const f of readiness.factors) for (const i of f.items) if (i.state !== "ready") cite(i.evidence);
  } else {
    lines.push("There's no upcoming stage: every stage has started or finished.");
  }
  const top = evaluation.findings.filter((f: Finding) => !f.missingData).slice(0, 4);
  if (top.length) {
    lines.push(`Most important next actions: ${top.map((f) => `${f.title} — ${f.recommendedAction}`).join(" ")}`);
    for (const f of top) cite(f.evidence[0]);
  }
  return { answer: lines.join("\n"), citations: citations.slice(0, 12), source: "rules", runId: null, warnings: [] };
}

export async function askIntelligence(ctx: Ctx, projectId: string, question: string): Promise<IntelligenceAnswer> {
  await loadProject(ctx, projectId);
  await requirePermission(ctx, "intelligence:read");
  await requirePermission(ctx, "ai:use");
  const loaded = await loadSnapshot(ctx.deps, ctx.auth.organizationId, projectId);
  if (!loaded) throw notFound("Project");
  const settings = resolveIntelligenceSettings(loaded.organization.settings);
  const evaluation = evaluateProject(loaded.snapshot, settings, ctx.deps.now().toISOString());
  const fallback = rulesAnswer(question, loaded, evaluation, settings);
  const provider = ctx.deps.agents;
  if (!provider) return fallback;
  const recs = await activeRecommendations(ctx.deps, projectId);
  try {
    const key = `ask:${projectId}:${createKey([question.trim().toLowerCase(), loaded.snapshot, recs.map((r) => [r.id, r.fingerprint])])}`;
    const run = await runAgent(
      ctx.deps,
      provider,
      { organizationId: ctx.auth.organizationId, projectId, kind: "ask", requestedBy: ctx.auth.userId, idempotencyKey: key, input: question, dailyLimit: settings.dailyAgentRunLimit },
      (runId) => provider.ask({ ...requestBase(loaded, evaluation, recs, runId), kind: "ask", question }),
      (raw) => {
        const res = askResponseSchema.parse(raw);
        const base = requestBase(loaded, evaluation, recs, "validate");
        const { citations, issues } = validateCitations(base.records, res.citations);
        issues.push(...checkProposedActions(res.proposed_actions));
        const contradiction = checkContradiction(res.answer, evaluation);
        return { output: { answer: res.answer, citations }, issues, reject: contradiction ?? undefined };
      },
    );
    return { answer: String(run.output.answer), citations: run.output.citations as Citation[], source: "agent", runId: run.runId, warnings: run.issues };
  } catch (err) {
    if (!(err instanceof AgentProviderError) && !(err instanceof AppError && err.code !== "forbidden")) throw err;
    return { ...fallback, warnings: [`The AI answer wasn't used (${err.message}). This answer comes straight from the project records.`] };
  }
}

function createKey(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32);
}

// ---------------------------------------------------------------------------
// Portfolio
// ---------------------------------------------------------------------------

export async function portfolioOverview(ctx: Ctx): Promise<PortfolioOverview> {
  await requirePermission(ctx, "intelligence:read");
  const ids = await accessibleProjectIds(ctx);
  const active = ids.length
    ? await ctx.deps.db
        .select({ id: projects.id, name: projects.name, number: projects.number, status: projects.status })
        .from(projects)
        .where(and(inArray(projects.id, ids), inArray(projects.status, [...SCANNED_STATUSES]), isNull(projects.archivedAt)))
    : [];
  const projectIds = active.map((p) => p.id);
  if (!projectIds.length) return { projects: [], attention: [], crewConflicts: [], totals: { activeProjects: 0, needsIntervention: 0, atRiskMilestones: 0, overdueDecisions: 0, materialRisks: 0, pendingInspections: 0 } };

  const latestEvals = await ctx.deps.db
    .selectDistinctOn([intelligenceEvaluations.projectId], { projectId: intelligenceEvaluations.projectId, readiness: intelligenceEvaluations.readiness, briefing: intelligenceEvaluations.briefing })
    .from(intelligenceEvaluations)
    .where(inArray(intelligenceEvaluations.projectId, projectIds))
    .orderBy(intelligenceEvaluations.projectId, desc(intelligenceEvaluations.createdAt));
  const evalBy = new Map(latestEvals.map((e) => [e.projectId, e]));
  const recRows = await ctx.deps.db
    .select({ rec: intelligenceRecommendations, assigneeName: users.fullName })
    .from(intelligenceRecommendations)
    .leftJoin(users, eq(users.id, intelligenceRecommendations.assigneeId))
    .where(and(inArray(intelligenceRecommendations.projectId, projectIds), inArray(intelligenceRecommendations.status, [...ACTIVE_RECOMMENDATION_STATUSES])));
  const projectBy = new Map(active.map((p) => [p.id, p]));
  const today = todayISO("UTC", ctx.deps.now());

  const rows = active.map((p) => {
    const recs = recRows.filter((r) => r.rec.projectId === p.id && r.rec.status !== "snoozed");
    const counts = Object.fromEntries(SEVERITIES.map((s) => [s, recs.filter((r) => r.rec.severity === s).length])) as Record<Severity, number>;
    const openHigh = recs.filter((r) => r.rec.severity === "critical" || r.rec.severity === "high").map((r) => diffCalendarDays(r.rec.firstDetectedAt.slice(0, 10), today));
    const ev = evalBy.get(p.id);
    return {
      projectId: p.id,
      name: p.name,
      number: p.number,
      status: p.status,
      readiness: ev?.readiness.nextMilestone?.label ?? ev?.readiness.label ?? null,
      readinessScore: ev?.readiness.score ?? null,
      nextMilestone: ev?.readiness.nextMilestone?.stageName ?? null,
      counts,
      oldestOpenHighDays: openHigh.length ? Math.max(...openHigh) : null,
      needsIntervention: ev?.briefing.needsIntervention ?? counts.critical > 0,
    };
  });
  rows.sort((a, b) => Number(b.needsIntervention) - Number(a.needsIntervention) || b.counts.critical - a.counts.critical || b.counts.high - a.counts.high || a.name.localeCompare(b.name));

  const attention = recRows
    .filter((r) => (r.rec.severity === "critical" || r.rec.severity === "high") && r.rec.status !== "snoozed")
    .sort((a, b) => SEVERITIES.indexOf(a.rec.severity) - SEVERITIES.indexOf(b.rec.severity) || (a.rec.suggestedDueDate ?? "").localeCompare(b.rec.suggestedDueDate ?? ""))
    .slice(0, 25)
    .map((r) => toRecommendation(r.rec, projectBy.get(r.rec.projectId)!, r.assigneeName));

  // Crews and subcontractors booked on overlapping work across projects.
  const settings = await orgSettings(ctx.deps, ctx.auth.organizationId);
  const horizon = addCalendarDays(today, settings.lookaheadDays);
  const upcoming = await ctx.deps.db
    .select({ id: tasks.id, title: tasks.title, projectId: tasks.projectId, status: tasks.status, start: tasks.plannedStartDate, duration: tasks.durationDays, assigneeId: tasks.assigneeId, crewTeamId: tasks.crewTeamId, subcontractorId: tasks.subcontractorId })
    .from(tasks)
    .where(and(inArray(tasks.projectId, projectIds), isNull(tasks.deletedAt), inArray(tasks.status, ["todo", "in_progress", "blocked"]), gte(tasks.plannedStartDate, addCalendarDays(today, -30)), lt(tasks.plannedStartDate, horizon)));
  const byId = new Map(upcoming.map((t) => [t.id, t]));
  const conflicts = findResourceConflicts(
    upcoming.map((t) => ({ id: t.id, durationDays: t.duration, status: t.status, plannedStartDate: t.start, resources: [t.crewTeamId, t.subcontractorId, t.assigneeId].filter((r): r is string => !!r) })),
  ).filter((c) => c.date >= today && c.date <= horizon && new Set(c.taskIds.map((id) => byId.get(id)!.projectId)).size > 1);
  const resourceIds = [...new Set(conflicts.map((c) => c.resource))];
  const names = new Map<string, string>();
  if (resourceIds.length) {
    for (const r of await ctx.deps.db.select({ id: teams.id, name: teams.name }).from(teams).where(inArray(teams.id, resourceIds))) names.set(r.id, r.name);
    for (const r of await ctx.deps.db.select({ id: vendors.id, name: vendors.name }).from(vendors).where(inArray(vendors.id, resourceIds))) names.set(r.id, r.name);
    for (const r of await ctx.deps.db.select({ id: users.id, name: users.fullName }).from(users).where(inArray(users.id, resourceIds))) names.set(r.id, r.name);
  }
  const seenResource = new Set<string>();
  const crewConflicts = conflicts
    .filter((c) => (seenResource.has(c.resource) ? false : (seenResource.add(c.resource), true)))
    .slice(0, 20)
    .map((c) => ({
      resource: c.resource,
      resourceName: names.get(c.resource) ?? "Unknown",
      date: c.date,
      tasks: c.taskIds.map((id) => ({ id, title: byId.get(id)!.title, projectId: byId.get(id)!.projectId, projectName: projectBy.get(byId.get(id)!.projectId)!.name })),
    }));

  const active_ = (cat: string[]) => recRows.filter((r) => cat.includes(r.rec.ruleKey)).length;
  return {
    projects: rows,
    attention,
    crewConflicts,
    totals: {
      activeProjects: rows.length,
      needsIntervention: rows.filter((r) => r.needsIntervention).length,
      atRiskMilestones: rows.filter((r) => r.readiness === "blocked" || r.readiness === "at_risk").length,
      overdueDecisions: active_(["communication.decision_overdue"]),
      materialRisks: active_(["procurement.not_ordered", "procurement.late_delivery", "procurement.delivery_unconfirmed"]),
      pendingInspections: active_(["readiness.inspection_gate", "readiness.inspection_failed", "closeout.final_inspection"]),
    },
  };
}

// ---------------------------------------------------------------------------
// Settings and run history
// ---------------------------------------------------------------------------

export async function getIntelligenceSettings(ctx: Ctx) {
  await requirePermission(ctx, "intelligence:read");
  return { settings: await orgSettings(ctx.deps, ctx.auth.organizationId), agentProvider: agentProviderId(ctx.deps), canConfigure: await hasPermission(ctx, "intelligence:configure") };
}

export async function updateIntelligenceSettings(ctx: Ctx, input: z.infer<typeof intelligenceSettingsSchema>) {
  await requirePermission(ctx, "intelligence:configure");
  await ctx.deps.db.transaction(async (tx) => {
    const [org] = await tx.select({ settings: organizations.settings }).from(organizations).where(eq(organizations.id, ctx.auth.organizationId)).for("update");
    const settings = { ...org!.settings, intelligence: { ...(org!.settings.intelligence ?? {}), ...input } };
    await tx.update(organizations).set({ settings, updatedBy: ctx.auth.userId }).where(eq(organizations.id, ctx.auth.organizationId));
  });
  return getIntelligenceSettings(ctx);
}

export async function listAgentRuns(ctx: Ctx, q: { projectId?: string; cursor?: string; limit: number }) {
  await requirePermission(ctx, "intelligence:configure");
  if (q.projectId) await loadProject(ctx, q.projectId);
  const offset = decodeCursor(q.cursor);
  const rows = await ctx.deps.db
    .select()
    .from(agentRuns)
    .where(and(eq(agentRuns.organizationId, ctx.auth.organizationId), q.projectId ? eq(agentRuns.projectId, q.projectId) : undefined))
    .orderBy(desc(agentRuns.startedAt))
    .limit(q.limit + 1)
    .offset(offset);
  const items: AgentRun[] = rows.map((r) => ({
    id: r.id,
    projectId: r.projectId,
    kind: r.kind,
    provider: r.provider,
    model: r.model,
    status: r.status,
    latencyMs: r.latencyMs,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    error: r.error,
    validationIssues: r.validationIssues,
    requestedBy: r.requestedBy,
    createdAt: r.startedAt,
  }));
  const [usage] = await ctx.deps.db
    .select({ runs: sql<number>`count(*)::int`, inputTokens: sql<number>`coalesce(sum(${agentRuns.inputTokens}),0)::int`, outputTokens: sql<number>`coalesce(sum(${agentRuns.outputTokens}),0)::int`, failed: sql<number>`count(*) filter (where ${agentRuns.status} <> 'succeeded')::int` })
    .from(agentRuns)
    .where(and(eq(agentRuns.organizationId, ctx.auth.organizationId), gte(agentRuns.startedAt, new Date(ctx.deps.now().getTime() - 30 * 86_400_000).toISOString())));
  return { ...page(items, q.limit, offset), usage30d: usage };
}

// ---------------------------------------------------------------------------
// Triggers and scheduled scans
// ---------------------------------------------------------------------------

/** Evaluate every scanned project; optionally queue agent briefings. Then escalate. */
export async function dailyScan(deps: Deps): Promise<{ projects: number; opened: number; closed: number; briefings: number }> {
  if (!deps.env.INTELLIGENCE_ENABLED) return { projects: 0, opened: 0, closed: 0, briefings: 0 };
  const rows = await deps.db
    .select({ id: projects.id, organizationId: projects.organizationId, settings: organizations.settings })
    .from(projects)
    .innerJoin(organizations, eq(organizations.id, projects.organizationId))
    .where(and(inArray(projects.status, [...SCANNED_STATUSES]), isNull(projects.deletedAt), isNull(projects.archivedAt)))
    .orderBy(asc(projects.organizationId));
  let opened = 0;
  let closed = 0;
  let briefings = 0;
  let count = 0;
  for (const p of rows) {
    const settings = resolveIntelligenceSettings(p.settings);
    if (!settings.enabled) continue;
    try {
      const outcome = await evaluateAndPersist(deps, p.organizationId, p.id, { trigger: "daily_scan" });
      count += 1;
      opened += outcome?.opened ?? 0;
      closed += outcome?.closed ?? 0;
      if (outcome && deps.agents && settings.dailyAgentBriefings) {
        await deps.jobs.enqueue("intelligence.briefing", { organizationId: p.organizationId, projectId: p.id, requestedBy: null }, { jobId: `intel-brief:${p.id}:${outcome.inputHash}` });
        briefings += 1;
      }
    } catch (err) {
      deps.log.error({ err, projectId: p.id }, "daily intelligence evaluation failed");
    }
  }
  await escalateStale(deps);
  return { projects: count, opened, closed, briefings };
}

/**
 * Escalation: an unacknowledged high item older than escalateAfterDays, or a
 * critical one older than a day, escalates one level and notifies the
 * project manager and admins (once per level).
 */
export async function escalateStale(deps: Deps): Promise<number> {
  const now = deps.now();
  const candidates = await deps.db
    .select({ rec: intelligenceRecommendations, settings: organizations.settings, projectName: projects.name, projectManagerId: projects.projectManagerId })
    .from(intelligenceRecommendations)
    .innerJoin(organizations, eq(organizations.id, intelligenceRecommendations.organizationId))
    .innerJoin(projects, eq(projects.id, intelligenceRecommendations.projectId))
    .where(and(inArray(intelligenceRecommendations.status, ["open", "escalated"]), inArray(intelligenceRecommendations.severity, ["critical", "high"]), lt(intelligenceRecommendations.escalationLevel, 2)));
  let escalated = 0;
  for (const c of candidates) {
    const settings = resolveIntelligenceSettings(c.settings);
    const ageDays = (now.getTime() - Date.parse(c.rec.firstDetectedAt)) / 86_400_000;
    const threshold = c.rec.severity === "critical" ? 1 : settings.escalateAfterDays;
    const level = c.rec.escalationLevel + 1;
    if (ageDays < threshold * level) continue;
    const [row] = await deps.db
      .update(intelligenceRecommendations)
      .set({ status: "escalated", escalationLevel: level, updatedAt: now.toISOString() })
      .where(and(eq(intelligenceRecommendations.id, c.rec.id), eq(intelligenceRecommendations.escalationLevel, c.rec.escalationLevel)))
      .returning();
    if (!row) continue;
    await recordRecommendationEvent(deps.db, { organizationId: row.organizationId, recommendationId: row.id, action: "escalated", fromStatus: c.rec.status, toStatus: "escalated", automationPolicy: `escalation:level_${level}`, note: `Open ${Math.floor(ageDays)} days without acknowledgement` });
    await notifyRecommendation(deps, deps.db, row, { name: c.projectName, projectManagerId: c.projectManagerId }, `escalated:${level}`, ["admin", "project_manager"]);
    escalated += 1;
  }
  return escalated;
}

/** Weekly housekeeping: retention for runs, closed recommendations and old evaluations. */
export async function weeklyReview(deps: Deps): Promise<{ runs: number; recommendations: number; evaluations: number }> {
  const now = deps.now().getTime();
  const days = (n: number) => new Date(now - n * 86_400_000).toISOString();
  const runs = await deps.db.delete(agentRuns).where(lt(agentRuns.startedAt, days(90))).returning({ id: agentRuns.id });
  const recs = await deps.db
    .delete(intelligenceRecommendations)
    .where(and(inArray(intelligenceRecommendations.status, ["resolved", "dismissed", "superseded", "expired"]), lt(intelligenceRecommendations.updatedAt, days(365))))
    .returning({ id: intelligenceRecommendations.id });
  const evals = await deps.db
    .delete(intelligenceEvaluations)
    .where(
      and(
        lt(intelligenceEvaluations.createdAt, days(90)),
        sql`${intelligenceEvaluations.id} not in (select distinct on (project_id) id from intelligence_evaluations order by project_id, created_at desc)`,
      ),
    )
    .returning({ id: intelligenceEvaluations.id });
  return { runs: runs.length, recommendations: recs.length, evaluations: evals.length };
}

