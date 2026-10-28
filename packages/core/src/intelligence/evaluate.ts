import type { BriefingAction, IntelligenceSettings, ProjectBriefing, ProjectReadiness, ReadinessLabel } from "@pool/types";
import { addCalendarDays } from "../calendar";
import { AnalysisContext, isOpenTask, taskFinish } from "./context";
import { evaluateMilestoneReadiness, evaluateProjectReadiness } from "./readiness";
import { runRules } from "./rules";
import { compareSeverity, maxSeverity } from "./settings";
import type { Finding, IntelligenceSnapshot } from "./snapshot";

/** Categories that describe one root cause when they hit the same task. */
const MERGE_CATEGORIES = new Set(["overdue", "blocked", "assignment"]);

/**
 * Superintendent consolidation: overdue / blocked / unassigned findings about
 * the same task become one recommendation (highest severity wins, the rest is
 * kept as context), so the user gets one coherent item per problem. Distinct
 * problems (a gate, a delivery, a decision) stay separate.
 */
export function consolidateFindings(findings: Finding[]): Finding[] {
  const groups = new Map<string, Finding[]>();
  for (const f of findings) {
    const key = f.subject.type === "task" && MERGE_CATEGORIES.has(f.category) ? `${f.agent}|task|${f.subject.id}` : `single|${f.dedupeKey}`;
    groups.set(key, [...(groups.get(key) ?? []), f]);
  }
  const out: Finding[] = [];
  for (const list of groups.values()) {
    if (list.length === 1) {
      out.push(list[0]!);
      continue;
    }
    list.sort((a, b) => compareSeverity(a.severity, b.severity) || a.ruleKey.localeCompare(b.ruleKey));
    const [primary, ...rest] = list as [Finding, ...Finding[]];
    const seen = new Set(primary.evidence.map((e) => `${e.type}:${e.id}`));
    const evidence = [...primary.evidence];
    for (const r of rest) for (const e of r.evidence) if (!seen.has(`${e.type}:${e.id}`)) (seen.add(`${e.type}:${e.id}`), evidence.push(e));
    const impactSeen = new Set(primary.impact.map((i) => i.id));
    const impact = [...primary.impact, ...rest.flatMap((r) => r.impact).filter((i) => !impactSeen.has(i.id) && impactSeen.add(i.id))];
    out.push({
      ...primary,
      severity: rest.reduce((s, r) => maxSeverity(s, r.severity), primary.severity),
      observation: `${primary.observation} Also: ${rest.map((r) => r.title).join("; ")}.`,
      evidence,
      impact,
      requiresApproval: list.some((f) => f.requiresApproval),
      missingData: list.every((f) => f.missingData),
    });
  }
  return out.sort((a, b) => compareSeverity(a.severity, b.severity) || (a.suggestedDueDate ?? "9999").localeCompare(b.suggestedDueDate ?? "9999") || a.dedupeKey.localeCompare(b.dedupeKey));
}

/** Stable text for change detection: same evidence + severity ⇒ same fingerprint. */
export function findingFingerprint(f: Finding): string {
  return JSON.stringify([f.severity, f.title, f.evidence.map((e) => [e.type, e.id, e.detail]).sort()]);
}

export interface ProjectEvaluation {
  findings: Finding[];
  readiness: ProjectReadiness;
  briefing: ProjectBriefing;
}

const toAction = (f: Finding): BriefingAction => ({
  recommendationId: null,
  text: `${f.title} — ${f.recommendedAction}`,
  severity: f.severity,
  responsibleRole: f.responsibleRole,
  dueDate: f.suggestedDueDate,
});

/** Deterministic briefing: facts and prioritized actions. An agent may add a narrative on top. */
export function buildBriefing(ctx: AnalysisContext, findings: Finding[], readiness: ProjectReadiness, settings: IntelligenceSettings, generatedAt: string): ProjectBriefing {
  const p = ctx.snap.project;
  const today = ctx.today;
  const horizon = addCalendarDays(today, 7);
  const upcoming = ctx.stages.filter((s) => s.status !== "completed" && s.status !== "skipped").slice(0, 3);
  const blockers = findings.filter((f) => (f.severity === "critical" || f.severity === "high") && !f.missingData).slice(0, 5);
  const todayActions = findings.filter((f) => f.suggestedDueDate !== null && f.suggestedDueDate <= today).slice(0, 6);
  const deadlines: ProjectBriefing["upcomingDeadlines"] = [];
  for (const t of ctx.snap.tasks.filter(isOpenTask)) {
    const d = taskFinish(t);
    if (d && d >= today && d <= horizon) deadlines.push({ type: "task", id: t.id, label: t.title, date: d });
  }
  for (const a of ctx.snap.approvals) if (a.status === "pending" && a.dueDate && a.dueDate >= today && a.dueDate <= horizon) deadlines.push({ type: "approval", id: a.id, label: a.title, date: a.dueDate });
  for (const st of ctx.stages) {
    const start = ctx.stageStart(st);
    if (st.status === "not_started" && start && start >= today && start <= horizon) deadlines.push({ type: "stage", id: st.id, label: `${st.name} starts`, date: start });
  }
  deadlines.sort((a, b) => a.date.localeCompare(b.date));

  const approvalsNeeded: ProjectBriefing["approvalsNeeded"] = ctx.snap.changeOrders
    .filter((c) => c.status === "submitted")
    .map((c) => ({ type: "change_order" as const, id: c.id, label: `Change order #${c.number} ${c.title} needs internal review` }));

  const critical = findings.filter((f) => f.severity === "critical").length;
  const high = findings.filter((f) => f.severity === "high").length;
  const interventionReasons: string[] = [];
  if (critical) interventionReasons.push(`${critical} critical item${critical === 1 ? "" : "s"}`);
  if (high >= 3) interventionReasons.push(`${high} high-priority items`);
  if (readiness.nextMilestone?.label === "blocked" && (readiness.nextMilestone.daysUntilStart ?? Infinity) <= settings.lookaheadDays)
    interventionReasons.push(`${readiness.nextMilestone.stageName} is blocked and starts within ${settings.lookaheadDays} days`);

  const next = readiness.nextMilestone;
  const headline = critical
    ? `${critical} critical issue${critical === 1 ? "" : "s"} need action`
    : next
      ? `${next.stageName} is ${next.label === "ready" ? "ready" : next.label === "blocked" ? "blocked" : "at risk"}${next.plannedStartDate ? ` for ${next.plannedStartDate}` : ""}`
      : findings.length
        ? `${findings.length} open item${findings.length === 1 ? "" : "s"}`
        : "Nothing needs attention";
  const status = `${p.status.replace(/_/g, " ")}; ${ctx.snap.tasks.filter((t) => t.status === "done").length} of ${ctx.snap.tasks.filter((t) => t.status !== "cancelled").length} tasks done${p.projectedCompletionDate ? `; projected completion ${p.projectedCompletionDate}` : ""}.`;

  const readinessByStage = new Map<string, ReadinessLabel>();
  if (next) readinessByStage.set(next.stageId, next.label);
  return {
    projectId: p.id,
    generatedAt,
    source: "rules",
    headline,
    status,
    narrative: null,
    narrativeAt: null,
    narrativeStale: false,
    upcomingMilestones: upcoming.map((s) => ({ stageId: s.id, name: s.name, plannedStartDate: ctx.stageStart(s), readiness: readinessByStage.get(s.id) ?? null })),
    blockers: blockers.map(toAction),
    todayActions: todayActions.map(toAction),
    upcomingDeadlines: deadlines.slice(0, 10),
    recentChanges: ctx.snap.recentActivity.slice(0, 8),
    approvalsNeeded,
    needsIntervention: interventionReasons.length > 0,
    interventionReasons,
  };
}

/** Full deterministic evaluation of one project. */
export function evaluateProject(snapshot: IntelligenceSnapshot, settings: IntelligenceSettings, now: string): ProjectEvaluation {
  const ctx = new AnalysisContext(snapshot);
  const findings = consolidateFindings(runRules(ctx, settings));
  const readiness = evaluateProjectReadiness(ctx, settings, findings, now);
  const briefing = buildBriefing(ctx, findings, readiness, settings, now);
  return { findings, readiness, briefing };
}

/** Readiness for a specific stage ("are we ready for excavation?"). */
export function evaluateStageReadiness(snapshot: IntelligenceSnapshot, settings: IntelligenceSettings, stageKeyOrId: string) {
  const ctx = new AnalysisContext(snapshot);
  const stage = ctx.stages.find((s) => s.id === stageKeyOrId || s.key === stageKeyOrId);
  return stage ? evaluateMilestoneReadiness(ctx, stage, settings) : null;
}
