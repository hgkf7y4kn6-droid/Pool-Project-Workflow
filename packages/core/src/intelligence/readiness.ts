import type {
  Evidence,
  FactorState,
  IntelligenceSettings,
  MilestoneReadiness,
  ProjectReadiness,
  ReadinessFactor,
  ReadinessFactorKey,
  ReadinessItem,
  ReadinessLabel,
} from "@pool/types";
import { READINESS_FACTOR_LABELS } from "@pool/types";
import { AnalysisContext, isOpenStage, isOpenTask, taskFinish } from "./context";
import type { Finding } from "./snapshot";

type Stage = AnalysisContext["stages"][number];

const WEIGHTS: Record<ReadinessFactorKey, number> = {
  prerequisites: 3,
  permits: 3,
  inspections: 3,
  materials: 2,
  crew: 2,
  decisions: 1.5,
  documentation: 1,
  weather: 1,
  schedule: 1,
};
const STATE_SCORE: Record<Exclude<FactorState, "unknown">, number> = { ready: 100, at_risk: 60, blocked: 0 };
/** A blocked milestone never scores above this, whatever the other factors say. */
export const BLOCKED_SCORE_CAP = 40;
/** Days ahead a forecast is meaningful. */
const FORECAST_HORIZON_DAYS = 10;

function factor(key: ReadinessFactorKey, mandatory: boolean, items: ReadinessItem[], explanation: string, forced?: FactorState): ReadinessFactor {
  let state: FactorState = forced ?? "ready";
  if (!forced) {
    if (items.some((i) => i.state === "blocked")) state = "blocked";
    else if (items.some((i) => i.state === "at_risk")) state = "at_risk";
    else if (items.length && items.every((i) => i.state === "unknown")) state = "unknown";
    else if (items.some((i) => i.state === "unknown")) state = "at_risk";
  }
  return { key, state, mandatory, score: state === "unknown" ? null : STATE_SCORE[state], weight: WEIGHTS[key], explanation, items };
}

const item = (label: string, state: FactorState, evidence: Evidence | null = null, humanVerification = false): ReadinessItem => ({ label, state, evidence, humanVerification });

/** Readiness of one stage, built only from records in the snapshot. */
export function evaluateMilestoneReadiness(ctx: AnalysisContext, stage: Stage, settings: IntelligenceSettings): MilestoneReadiness {
  const start = ctx.stageStart(stage);
  const daysUntilStart = start ? ctx.daysUntil(start) : null;
  const stageTasks = ctx.stageTasks(stage.id);
  const openTasks = stageTasks.filter(isOpenTask);
  const stageTaskIds = new Set(stageTasks.map((t) => t.id));
  const factors: ReadinessFactor[] = [];
  const idx = ctx.stages.indexOf(stage);

  // --- Prerequisites: earlier stages and explicit predecessor tasks ---------------------
  {
    const items: ReadinessItem[] = [];
    // Stage order alone doesn't block (stages can overlap by design); explicit
    // dependencies below do. A late or open-ended earlier stage is a risk.
    for (const earlier of ctx.stages.slice(0, idx).filter(isOpenStage)) {
      const end = earlier.plannedEndDate;
      const late = !!end && end < ctx.today;
      const onTime = !!(end && start && end < start) && !late;
      items.push(
        item(
          `${earlier.name} ${earlier.status === "in_progress" ? "in progress" : "not started"}${end ? `, planned to finish ${end}` : ", no planned finish"}${late ? " (late)" : ""}`,
          onTime ? "ready" : "at_risk",
          ctx.stageEvidence(earlier),
        ),
      );
    }
    for (const t of stageTasks) {
      for (const d of ctx.predecessors.get(t.id) ?? []) {
        if (stageTaskIds.has(d.predecessorId)) continue;
        const pred = ctx.taskById.get(d.predecessorId);
        if (!pred || !isOpenTask(pred)) continue;
        const finish = taskFinish(pred);
        const late = !finish || !t.plannedStartDate || finish >= t.plannedStartDate || finish < ctx.today;
        items.push(item(`"${pred.title}" must finish before "${t.title}"`, d.type === "FS" && late ? "blocked" : "at_risk", ctx.taskEvidence(pred)));
      }
    }
    const open = items.filter((i) => i.state !== "ready").length;
    factors.push(factor("prerequisites", true, items, open ? `${open} prerequisite${open === 1 ? "" : "s"} need attention` : "Earlier stages and predecessor tasks are complete or on track"));
  }

  // --- Permits ------------------------------------------------------------------------
  const gateIdx = ctx.stageIndex(settings.permitGateFromStage);
  if (gateIdx >= 0 && idx >= gateIdx) {
    const permit = ctx.permitStatus(stage, settings.permitGateFromStage);
    const wide = permit.projectWide;
    const wideState: FactorState = wide.state === "issued" ? "ready" : wide.state === "pending" ? "blocked" : "unknown";
    const items = [
      // Without project-wide records, the permits stage stands in for them.
      ...(wide.source === "stage"
        ? [item(wide.state === "issued" ? "Permit issued" : wide.state === "pending" ? "Permit not yet recorded as issued" : "No permit records in this project", wideState, wide.evidence[0] ?? null, true)]
        : []),
      ...permit.permits.map((x) => item(`${x.evidence.label}: ${x.status.replace(/_/g, " ")}`, x.authorizesWork ? "ready" : "blocked", x.evidence, true)),
    ];
    factors.push(
      factor(
        "permits",
        true,
        items,
        permit.state === "issued"
          ? "Every permit this stage needs is issued and current. Verify the permit card is posted on site."
          : permit.state === "pending"
            ? "This stage needs every project-wide permit, and any permit linked to it, issued and current."
            : "Can't tell whether a permit is issued: there are no project-wide permit records, permits stage or checklist item.",
      ),
    );
  }

  // --- Inspection gates ---------------------------------------------------------------
  const gates = settings.inspectionGates[stage.key] ?? [];
  if (gates.length) {
    const items = gates.map((type) => {
      const latest = ctx.latestInspection(type);
      const label = type.replace(/_/g, " ");
      if (!latest) return item(`${label} inspection not recorded`, "blocked", null, true);
      const ev: Evidence = { type: "inspection", id: latest.id, label: `${label} inspection`, detail: `result ${latest.result}${latest.scheduledFor ? `, scheduled ${latest.scheduledFor}` : ""}` };
      if (latest.result === "pass") return item(`${label} inspection passed`, "ready", ev, true);
      if (latest.result === "pending") {
        const inTime = !!(latest.scheduledFor && start && latest.scheduledFor < start);
        return item(`${label} inspection pending${latest.scheduledFor ? ` (scheduled ${latest.scheduledFor})` : ", not scheduled"}`, inTime ? "at_risk" : "blocked", ev, true);
      }
      return item(`${label} inspection ${latest.result}; corrections and a re-inspection are needed`, "blocked", ev, true);
    });
    factors.push(factor("inspections", true, items, "Required inspections must pass before this work starts. Only the inspector's recorded result counts."));
  }

  // --- Materials ----------------------------------------------------------------------
  const mats = ctx.snap.materials.filter((m) => m.taskId && stageTaskIds.has(m.taskId) && m.status !== "returned");
  if (mats.length) {
    const items = mats.map((m) => {
      const task = m.taskId ? ctx.taskById.get(m.taskId) : undefined;
      const needBy = m.requiredBy ?? task?.plannedStartDate ?? start;
      const ev: Evidence = { type: "material", id: m.id, label: m.name, detail: `status ${m.status}${m.expectedDeliveryDate ? `, expected ${m.expectedDeliveryDate}` : ""}${needBy ? `, needed by ${needBy}` : ""}` };
      if (m.status === "delivered" || m.status === "installed") return item(`${m.name} on site`, "ready", ev);
      if (m.status === "planned") return item(`${m.name} not ordered`, needBy && ctx.daysUntil(needBy) < (m.leadTimeDays ?? settings.defaultLeadTimeDays) ? "blocked" : "at_risk", ev);
      if (m.expectedDeliveryDate && needBy && m.expectedDeliveryDate > needBy) return item(`${m.name} expected ${m.expectedDeliveryDate}, after it's needed (${needBy})`, "blocked", ev);
      if (!m.deliveryConfirmedAt) return item(`${m.name} ordered, delivery not confirmed`, "at_risk", ev);
      return item(`${m.name} ordered, delivery confirmed${m.expectedDeliveryDate ? ` for ${m.expectedDeliveryDate}` : ""}`, "ready", ev);
    });
    factors.push(factor("materials", false, items, "Materials linked to this stage's tasks, against the date each is needed."));
  }

  // --- Crew & subcontractors ----------------------------------------------------------
  {
    const items = openTasks.map((t) => {
      const who = ctx.name(t.assigneeId) ?? ctx.name(t.crewTeamId) ?? ctx.name(t.subcontractorId);
      const assigned = !!(t.assigneeId || t.crewTeamId || t.subcontractorId);
      return item(assigned ? `"${t.title}" assigned${who ? ` to ${who}` : ""}` : `"${t.title}" has no crew, assignee or subcontractor`, assigned ? "ready" : "at_risk", ctx.taskEvidence(t));
    });
    if (!stageTasks.length) factors.push(factor("crew", false, [], "No tasks are planned for this stage yet.", "unknown"));
    else if (items.length) factors.push(factor("crew", false, items, "Every open task needs an owner before work starts."));
  }

  // --- Homeowner decisions ------------------------------------------------------------
  {
    const items: ReadinessItem[] = [];
    for (const a of ctx.snap.approvals.filter((x) => x.status === "pending")) {
      const due = a.dueDate;
      const relevant = !due || !start || due <= start;
      if (!relevant) continue;
      const overdue = !!due && due < ctx.today;
      items.push(item(`${a.title}${due ? ` (due ${due})` : ""}`, overdue ? "blocked" : "at_risk", { type: "approval", id: a.id, label: a.title, detail: `pending${due ? `, due ${due}` : ""}` }));
    }
    for (const co of ctx.snap.changeOrders.filter((c) => (c.status === "client_review" || c.status === "submitted") && c.scheduleImpactDays > 0)) {
      items.push(item(`Change order #${co.number} awaiting a decision (${co.scheduleImpactDays} day schedule impact)`, "at_risk", { type: "change_order", id: co.id, label: `CO #${co.number} ${co.title}`, detail: `status ${co.status}` }));
    }
    factors.push(factor("decisions", false, items, items.length ? "Outstanding decisions that affect this stage." : "No outstanding homeowner decisions."));
  }

  // --- Documentation before work is covered -------------------------------------------
  {
    const concealed = new Set(settings.concealment[stage.key] ?? []);
    const earlierIds = new Set(ctx.stages.slice(0, idx).map((s) => s.id));
    const items: ReadinessItem[] = [];
    for (const c of ctx.snap.checklist.filter((x) => x.requiresPhoto)) {
      const task = ctx.taskById.get(c.taskId);
      if (!task?.stageId || !earlierIds.has(task.stageId)) continue;
      const st = ctx.stageById.get(task.stageId)!;
      const covers = concealed.has(st.key);
      if (c.isChecked && c.hasPhoto) continue;
      items.push(
        item(
          `${st.name}: "${c.label}" ${c.isChecked ? "checked without a photo" : "not done"}${covers ? ` — ${stage.name} will cover this work` : ""}`,
          covers ? "blocked" : "at_risk",
          { type: "checklist_item", id: c.id, label: c.label, detail: `${c.isChecked ? "checked" : "unchecked"}, ${c.hasPhoto ? "photo attached" : "no photo"}` },
          covers,
        ),
      );
    }
    if (items.length || concealed.size) factors.push(factor("documentation", false, items, concealed.size ? `Photos and records for ${[...concealed].join(", ")} must exist before ${stage.name} covers that work.` : "Required photos in earlier stages."));
  }

  // --- Weather -------------------------------------------------------------------------
  const sensitive = openTasks.filter((t) => t.weatherSensitive);
  if (sensitive.length) {
    const ids = new Set(sensitive.map((t) => t.id));
    const alerts = ctx.snap.weatherAlerts.filter((a) => a.taskId && ids.has(a.taskId) && a.date >= ctx.today);
    if (alerts.length) {
      factors.push(
        factor(
          "weather",
          false,
          alerts.map((a) => item(`${a.date}: ${a.summary}`, "at_risk", { type: "weather_alert", id: a.id, label: `Weather ${a.date}`, detail: a.summary })),
          "Forecast warnings for weather-sensitive work. The schedule is never moved automatically.",
        ),
      );
    } else if (daysUntilStart !== null && daysUntilStart <= FORECAST_HORIZON_DAYS) {
      factors.push(factor("weather", false, [], "No forecast warnings for this window.", "ready"));
    } else {
      factors.push(factor("weather", false, [], "Too far out for a reliable forecast.", "unknown"));
    }
  }

  // --- Schedule -------------------------------------------------------------------------
  {
    const items: ReadinessItem[] = [];
    if (!start) items.push(item("No planned start date", "unknown"));
    else if (daysUntilStart! < 0 && stage.status === "not_started") items.push(item(`Planned start ${start} has passed and the stage hasn't started`, "at_risk", ctx.stageEvidence(stage)));
    else items.push(item(`Planned start ${start} (${daysUntilStart} days)`, "ready", ctx.stageEvidence(stage)));
    const undated = openTasks.filter((t) => !t.plannedStartDate);
    if (undated.length) items.push(item(`${undated.length} task${undated.length === 1 ? "" : "s"} without planned dates`, "unknown"));
    const critical = openTasks.filter((t) => ctx.isCritical(t.id));
    const explanation = critical.length ? `${critical.length} of this stage's tasks are on the critical path: any slip moves completion.` : ctx.scheduleNote ?? "This stage has float.";
    factors.push(factor("schedule", false, items, explanation));
  }

  return summarize(stage, start, daysUntilStart, factors, ctx.snap.stageHistory[stage.key] ?? null);
}

function summarize(
  stage: Stage,
  start: string | null,
  daysUntilStart: number | null,
  factors: ReadinessFactor[],
  history: MilestoneReadiness["history"],
): MilestoneReadiness {
  const blockers: string[] = [];
  const risks: string[] = [];
  const missingData: string[] = [];
  for (const f of factors) {
    const name = READINESS_FACTOR_LABELS[f.key];
    for (const i of f.items) {
      if (i.state === "blocked") blockers.push(`${name}: ${i.label}`);
      else if (i.state === "at_risk") risks.push(`${name}: ${i.label}`);
      else if (i.state === "unknown") missingData.push(`${name}: ${i.label}`);
    }
    if (f.state === "unknown" && !f.items.length) missingData.push(`${name}: ${f.explanation}`);
  }
  const known = factors.filter((f) => f.score !== null);
  const weight = known.reduce((s, f) => s + f.weight, 0);
  let score = weight ? Math.round(known.reduce((s, f) => s + f.weight * f.score!, 0) / weight) : 0;
  let label: ReadinessLabel;
  if (factors.some((f) => f.state === "blocked")) {
    label = "blocked";
    score = Math.min(score, BLOCKED_SCORE_CAP);
  } else if (factors.some((f) => f.state === "at_risk" || (f.mandatory && f.state === "unknown"))) {
    label = "at_risk";
  } else {
    label = "ready";
  }
  return {
    stageId: stage.id,
    stageKey: stage.key,
    stageName: stage.name,
    plannedStartDate: start,
    daysUntilStart,
    label,
    score,
    factors,
    blockers,
    risks,
    missingData,
    history,
  };
}

/** The next stage that hasn't started (the milestone the team is preparing for). */
export function nextMilestoneStage(ctx: AnalysisContext): Stage | null {
  return ctx.stages.find((s) => s.status === "not_started") ?? null;
}

/**
 * Project-level readiness: the next milestone's readiness, held down by open
 * critical/high findings. Every contribution is listed in `explanation`.
 */
export function evaluateProjectReadiness(ctx: AnalysisContext, settings: IntelligenceSettings, findings: Finding[], evaluatedAt: string): ProjectReadiness {
  const stage = nextMilestoneStage(ctx);
  const next = stage ? evaluateMilestoneReadiness(ctx, stage, settings) : null;
  const critical = findings.filter((f) => f.severity === "critical").length;
  const high = findings.filter((f) => f.severity === "high").length;
  const explanation: string[] = [];
  let score = next ? next.score : 100;
  let label: ReadinessLabel = next ? next.label : "no_upcoming_milestone";
  if (next) explanation.push(`${next.stageName}: ${next.label.replace("_", " ")} (${next.score})`);
  else explanation.push("No upcoming stage: every stage has started or finished");
  if (critical) {
    score = Math.min(score, BLOCKED_SCORE_CAP);
    label = "blocked";
    explanation.push(`${critical} critical item${critical === 1 ? "" : "s"} open`);
  }
  if (high) {
    score = Math.max(0, score - 10 * Math.min(high, 4));
    if (label === "ready" || label === "no_upcoming_milestone") label = "at_risk";
    explanation.push(`${high} high-priority item${high === 1 ? "" : "s"} open (−${10 * Math.min(high, 4)})`);
  }
  return { label, score, explanation, nextMilestone: next, evaluatedAt };
}
