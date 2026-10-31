import { createHash } from "node:crypto";
import { and, count, eq, gte, inArray } from "drizzle-orm";
import {
  contradictsReadiness,
  filterCitations,
  filterProposedActions,
  knownRecords,
  resolveIntelligenceSettings,
  sanitizeForPrompt,
  type IntelligenceSnapshot,
  type ProjectEvaluation,
} from "@pool/core";
import { agentRuns, intelligenceRecommendations } from "@pool/database";
import { ACTIVE_RECOMMENDATION_STATUSES, type AgentRunKind, type Citation, type EvidenceType } from "@pool/types";
import type { Deps } from "../../context";
import { AppError } from "../../lib/errors";
import { AgentProviderError, type AgentFinding, type AgentRecord, type AgentRequestBase } from "../../adapters/agents/types";
import type { LoadedProject } from "./snapshot";

/** Concurrent agent runs per organization in this process. */
const MAX_CONCURRENT_PER_ORG = 2;
const running = new Map<string, number>();
const MAX_RECORDS = 400;

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32);

type RecRow = typeof intelligenceRecommendations.$inferSelect;

/**
 * Every record an agent may see and cite, as compact sanitized facts. This is
 * the same internal view as the snapshot (no costs or prices).
 */
export function agentRecords(snap: IntelligenceSnapshot): AgentRecord[] {
  const s = (t: string | null | undefined, max = 300) => sanitizeForPrompt(t ?? "", max);
  const stageName = new Map(snap.stages.map((x) => [x.id, x.name]));
  const out: AgentRecord[] = [
    {
      type: "project",
      id: snap.project.id,
      label: s(snap.project.name, 120),
      facts: `status ${snap.project.status}; planned ${snap.project.plannedStartDate ?? "?"} → ${snap.project.plannedCompletionDate ?? "?"}; projected completion ${snap.project.projectedCompletionDate ?? "?"}; last client update ${snap.project.lastClientUpdateAt?.slice(0, 10) ?? "none"}`,
    },
    ...snap.stages.map((x) => ({ type: "stage" as const, id: x.id, label: s(x.name, 80), facts: `${x.status}; planned ${x.plannedStartDate ?? "?"} → ${x.plannedEndDate ?? "?"}` })),
    ...snap.tasks
      .filter((t) => t.status !== "cancelled")
      .map((t) => ({
        type: "task" as const,
        id: t.id,
        label: s(t.title, 120),
        facts: `${t.status}${t.stageId ? `; stage ${stageName.get(t.stageId) ?? ""}` : ""}; planned ${t.plannedStartDate ?? "?"} → ${t.plannedEndDate ?? t.dueDate ?? "?"}; owner ${snap.names[t.assigneeId ?? ""] ?? snap.names[t.crewTeamId ?? ""] ?? snap.names[t.subcontractorId ?? ""] ?? "unassigned"}`,
      })),
    ...snap.inspections.map((i) => ({ type: "inspection" as const, id: i.id, label: `${i.inspectionType.replace(/_/g, " ")} inspection`, facts: `result ${i.result}${i.scheduledFor ? `; scheduled ${i.scheduledFor}` : ""}${i.inspectedAt ? `; inspected ${i.inspectedAt.slice(0, 10)}` : ""}` })),
    ...snap.permits.map((pm) => ({
      type: "permit" as const,
      id: pm.id,
      label: `${pm.permitType.replace(/_/g, " ")} permit${pm.permitNumber ? ` ${s(pm.permitNumber, 80)}` : ""}`,
      facts: `${pm.status.replace(/_/g, " ")}; ${s(pm.jurisdiction, 120)}${pm.issuedOn ? `; issued ${pm.issuedOn}` : ""}${pm.expiresOn ? `; expires ${pm.expiresOn}` : ""}`,
    })),
    ...snap.approvals.map((a) => ({ type: "approval" as const, id: a.id, label: s(a.title, 120), facts: `${a.subjectType} approval ${a.status}${a.dueDate ? `; due ${a.dueDate}` : ""}` })),
    ...snap.changeOrders.map((c) => ({ type: "change_order" as const, id: c.id, label: `Change order #${c.number} ${s(c.title, 100)}`, facts: `${c.status}${c.scheduleImpactDays ? `; schedule impact ${c.scheduleImpactDays} days` : ""}` })),
    ...snap.materials.map((m) => ({
      type: "material" as const,
      id: m.id,
      label: s(m.name, 100),
      facts: `${m.status}${m.vendorName ? `; supplier ${s(m.vendorName, 80)}` : ""}${m.requiredBy ? `; required by ${m.requiredBy}` : ""}${m.expectedDeliveryDate ? `; expected ${m.expectedDeliveryDate}` : ""}${m.deliveryConfirmedAt ? "; delivery confirmed" : ""}`,
    })),
    ...snap.documents.map((d) => ({ type: "document" as const, id: d.id, label: s(d.title, 120), facts: `category ${d.category}` })),
    ...snap.weatherAlerts.map((w) => ({ type: "weather_alert" as const, id: w.id, label: `Forecast ${w.date}`, facts: s(w.summary, 200) })),
    ...snap.recentActivity.map((a) => ({ type: "activity" as const, id: a.id, label: a.createdAt.slice(0, 10), facts: s(a.summary, 200) })),
  ];
  return out.slice(0, MAX_RECORDS);
}

export function agentFindings(recs: RecRow[]): AgentFinding[] {
  return recs.map((r) => ({
    id: r.id,
    agent: r.agent,
    severity: r.severity,
    title: r.title,
    observation: r.observation,
    risk: r.risk,
    recommended_action: r.recommendedAction,
    responsible_role: r.responsibleRole,
    due_date: r.suggestedDueDate,
    evidence_ids: r.evidence.map((e) => e.id),
  }));
}

export async function activeRecommendations(deps: Deps, projectId: string): Promise<RecRow[]> {
  return deps.db
    .select()
    .from(intelligenceRecommendations)
    .where(and(eq(intelligenceRecommendations.projectId, projectId), inArray(intelligenceRecommendations.status, [...ACTIVE_RECOMMENDATION_STATUSES])));
}

export function requestBase(loaded: LoadedProject, evaluation: ProjectEvaluation, recs: RecRow[], requestId: string): AgentRequestBase {
  const settings = resolveIntelligenceSettings(loaded.organization.settings);
  const next = evaluation.readiness.nextMilestone;
  return {
    request_id: requestId,
    depth: settings.briefingDepth,
    project: { id: loaded.project.id, name: sanitizeForPrompt(loaded.project.name, 120), number: loaded.project.number, status: loaded.snapshot.project.status, today: loaded.snapshot.today },
    records: agentRecords(loaded.snapshot),
    findings: agentFindings(recs),
    readiness: {
      label: evaluation.readiness.label,
      score: evaluation.readiness.score,
      next_milestone: next
        ? { stage_name: next.stageName, label: next.label, score: next.score, planned_start: next.plannedStartDate, blockers: next.blockers, risks: next.risks, missing_data: next.missingData }
        : null,
    },
  };
}

export interface ValidatedCitations {
  citations: Citation[];
  issues: string[];
}

/** Keep only citations to records that were sent to the agent. */
export function validateCitations(records: AgentRecord[], citations: { type: string; id: string }[]): ValidatedCitations {
  const known = knownRecords(records.map((r) => ({ type: r.type as EvidenceType, id: r.id, label: r.label })));
  const { valid, dropped } = filterCitations(citations, known);
  return { citations: valid, issues: dropped ? [`Dropped ${dropped} citation${dropped === 1 ? "" : "s"} to records that weren't in the data`] : [] };
}

export function checkProposedActions(actions: { type: string }[]): string[] {
  return filterProposedActions(actions).rejected.map((t) => `Rejected proposed action outside the allowlist: ${t}`);
}

export function checkContradiction(text: string, evaluation: ProjectEvaluation): string | null {
  const next = evaluation.readiness.nextMilestone;
  return contradictsReadiness(text, next?.label ?? null, next?.stageName ?? null) ? `The output called ${next!.stageName} ready, but the records show it's blocked` : null;
}

export interface RunOptions {
  organizationId: string;
  projectId: string | null;
  kind: AgentRunKind;
  requestedBy: string | null;
  /** Same key ⇒ reuse the stored result (retries and unchanged inputs). */
  idempotencyKey: string;
  input: unknown;
  dailyLimit: number;
}

export interface RunResult<T> {
  runId: string;
  output: T;
  issues: string[];
  cached: boolean;
}

/**
 * Execute one agent call with an `agent_runs` record: idempotent reuse,
 * per-organization daily cap and concurrency limit, timing, token usage, and
 * a validation step that can reject the output. Failures never touch project
 * data — the caller falls back to the deterministic result.
 */
export async function runAgent<R extends { model?: string | null; usage?: { input_tokens: number | null; output_tokens: number | null } }, T extends Record<string, unknown>>(
  deps: Deps,
  provider: { id: string },
  opts: RunOptions,
  call: (runId: string) => Promise<R>,
  validate: (response: R) => { output: T; issues: string[]; reject?: string },
): Promise<RunResult<T>> {
  const db = deps.db;
  const inputHash = hash(opts.input);
  const [existing] = await db
    .select()
    .from(agentRuns)
    .where(and(eq(agentRuns.organizationId, opts.organizationId), eq(agentRuns.idempotencyKey, opts.idempotencyKey)));
  if (existing?.status === "succeeded" && existing.output) {
    return { runId: existing.id, output: existing.output as T, issues: existing.validationIssues, cached: true };
  }
  if (existing?.status === "running" && Date.now() - Date.parse(existing.startedAt) < deps.env.INTELLIGENCE_AGENT_TIMEOUT_MS * 2) {
    throw new AppError("conflict", "This analysis is already running");
  }

  const since = new Date(deps.now());
  since.setUTCHours(0, 0, 0, 0);
  const [{ n }] = (await db
    .select({ n: count() })
    .from(agentRuns)
    .where(and(eq(agentRuns.organizationId, opts.organizationId), gte(agentRuns.startedAt, since.toISOString())))) as [{ n: number }];
  if (n >= opts.dailyLimit) throw new AppError("rate_limited", "The daily AI analysis limit for your company has been reached");

  const inFlight = running.get(opts.organizationId) ?? 0;
  if (inFlight >= MAX_CONCURRENT_PER_ORG) throw new AppError("rate_limited", "Other analyses are running; try again in a minute");
  running.set(opts.organizationId, inFlight + 1);

  let runId: string;
  if (existing) {
    runId = existing.id;
    await db.update(agentRuns).set({ status: "running", startedAt: deps.now().toISOString(), finishedAt: null, error: null, provider: provider.id, inputHash }).where(eq(agentRuns.id, runId));
  } else {
    const [row] = await db
      .insert(agentRuns)
      .values({ organizationId: opts.organizationId, projectId: opts.projectId, kind: opts.kind, provider: provider.id, status: "running", idempotencyKey: opts.idempotencyKey, inputHash, requestedBy: opts.requestedBy })
      .onConflictDoNothing()
      .returning({ id: agentRuns.id });
    if (!row) {
      running.set(opts.organizationId, (running.get(opts.organizationId) ?? 1) - 1);
      throw new AppError("conflict", "This analysis is already running");
    }
    runId = row.id;
  }

  const started = Date.now();
  try {
    const response = await call(runId);
    let validated: ReturnType<typeof validate>;
    try {
      validated = validate(response);
    } catch {
      throw new AgentProviderError("The agent returned output that doesn't match the contract", false, "invalid_output");
    }
    const { output, issues, reject } = validated;
    const finished = { finishedAt: deps.now().toISOString(), latencyMs: Date.now() - started, model: response.model ?? null, inputTokens: response.usage?.input_tokens ?? null, outputTokens: response.usage?.output_tokens ?? null };
    if (reject) {
      await db.update(agentRuns).set({ ...finished, status: "rejected", error: reject, validationIssues: [reject, ...issues] }).where(eq(agentRuns.id, runId));
      deps.log.warn({ runId, kind: opts.kind, reject }, "agent output rejected");
      throw new AgentProviderError(reject, false, "invalid_output");
    }
    await db.update(agentRuns).set({ ...finished, status: "succeeded", output, validationIssues: issues }).where(eq(agentRuns.id, runId));
    deps.log.info({ runId, kind: opts.kind, provider: provider.id, latencyMs: finished.latencyMs, inputTokens: finished.inputTokens, outputTokens: finished.outputTokens }, "agent run succeeded");
    return { runId, output, issues, cached: false };
  } catch (err) {
    // Rejections were already recorded above (the status guard skips them); record every other failure.
    const message = err instanceof AgentProviderError ? err.message : "The agent run failed";
    await db
      .update(agentRuns)
      .set({ status: err instanceof AgentProviderError && err.kind === "invalid_output" ? "rejected" : "failed", error: message, finishedAt: deps.now().toISOString(), latencyMs: Date.now() - started })
      .where(and(eq(agentRuns.id, runId), eq(agentRuns.status, "running")));
    deps.log.warn({ runId, kind: opts.kind, err: message }, "agent run failed");
    throw err instanceof AgentProviderError ? err : new AgentProviderError(message, true);
  } finally {
    running.set(opts.organizationId, Math.max(0, (running.get(opts.organizationId) ?? 1) - 1));
  }
}
