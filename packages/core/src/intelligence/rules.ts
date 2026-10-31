import type { Evidence, ImpactRef, IntelligenceSettings, ResponsibleRole, Severity } from "@pool/types";
import { ACTIVE_PROJECT_STATUSES } from "@pool/types";
import { addCalendarDays, diffCalendarDays } from "../calendar";
import { findDependencyViolations, findResourceConflicts } from "../schedule";
import { AnalysisContext, isOpenStage, isOpenTask, taskFinish } from "./context";
import type { Finding, IntelligenceSnapshot } from "./snapshot";

type Task = IntelligenceSnapshot["tasks"][number];

/*
 * Deterministic rules. Each rule reads only snapshot records, cites them as
 * evidence and assigns severity from explicit thresholds — never from an
 * LLM. Rules return nothing when the data needed to judge is absent, unless
 * the absence itself is the finding (then `missingData` is true).
 */

const latest = (a: string, b: string) => (a > b ? a : b);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

function make(f: Omit<Finding, "confidence" | "assigneeId" | "stageId" | "impact" | "missingData" | "requiresApproval" | "proposedAction" | "expiresAt"> & Partial<Finding>): Finding {
  return {
    confidence: "high",
    assigneeId: null,
    stageId: null,
    impact: [],
    missingData: false,
    requiresApproval: false,
    proposedAction: null,
    expiresAt: null,
    ...f,
  };
}

function successorsImpact(ctx: AnalysisContext, taskId: string): ImpactRef[] {
  return (ctx.successors.get(taskId) ?? [])
    .map((d) => ctx.taskById.get(d.successorId))
    .filter((t): t is Task => !!t && isOpenTask(t))
    .map((t) => ({ type: "task" as const, id: t.id, label: t.title }));
}

function ownerRole(t: Task): ResponsibleRole {
  return t.assigneeId || t.crewTeamId ? "field_supervisor" : "project_manager";
}

const dueBefore = (ctx: AnalysisContext, date: string | null, daysBefore = 1) => (date ? latest(ctx.today, addCalendarDays(date, -daysBefore)) : ctx.today);

// ---------------------------------------------------------------------------
// Schedule & delay prevention
// ---------------------------------------------------------------------------

function scheduleRules(ctx: AnalysisContext, s: IntelligenceSettings): Finding[] {
  const out: Finding[] = [];
  const { today } = ctx;
  const flaggedPairs = new Set<string>();

  for (const t of ctx.snap.tasks.filter(isOpenTask)) {
    const finish = taskFinish(t);
    const impact = successorsImpact(ctx, t.id);
    const critical = ctx.isCritical(t.id);
    const soonSuccessor = impact.some((i) => {
      const st = ctx.taskById.get(i.id)?.plannedStartDate;
      return !!st && ctx.daysUntil(st) <= s.lookaheadDays;
    });

    if (finish && finish < today) {
      const days = diffCalendarDays(finish, today);
      const severity: Severity = critical && days > s.criticalOverdueDays ? "critical" : critical || t.isMilestone || soonSuccessor ? "high" : "medium";
      out.push(
        make({
          ruleKey: "schedule.task_overdue",
          agent: "schedule",
          category: "overdue",
          dedupeKey: `schedule.task_overdue:${t.id}`,
          severity,
          title: `"${t.title}" is ${plural(days, "day")} overdue`,
          observation: `Planned to finish ${finish}; status is ${t.status}.${critical ? " The task is on the critical path." : ""}`,
          risk: impact.length ? `${plural(impact.length, "dependent task")} can't start until it's done${critical ? "; completion moves day for day" : ""}.` : "The stage finishes late if it isn't closed out.",
          recommendedAction: "Confirm the real finish date with the assignee and either complete the task or re-plan the remaining work in the schedule.",
          responsibleRole: ownerRole(t),
          assigneeId: t.assigneeId,
          suggestedDueDate: today,
          dueRationale: "Already past its planned finish.",
          subject: { type: "task", id: t.id },
          stageId: t.stageId,
          evidence: [ctx.taskEvidence(t)],
          impact,
          reevaluateWhen: "The task is completed or its planned finish changes.",
        }),
      );
    }

    if (t.status === "blocked") {
      const startsSoon = !!t.plannedStartDate && ctx.daysUntil(t.plannedStartDate) <= s.lookaheadDays;
      out.push(
        make({
          ruleKey: "schedule.task_blocked",
          agent: "schedule",
          category: "blocked",
          dedupeKey: `schedule.task_blocked:${t.id}`,
          severity: soonSuccessor || startsSoon || critical ? "high" : "medium",
          title: `"${t.title}" is blocked`,
          observation: `The task is marked blocked${t.plannedStartDate ? ` (planned start ${t.plannedStartDate})` : ""}.`,
          risk: impact.length ? `Holds up ${plural(impact.length, "dependent task")}.` : "Work can't progress on this task.",
          recommendedAction: "Record what is blocking it in a task note and assign someone to clear it, or re-sequence the work.",
          responsibleRole: "project_manager",
          assigneeId: t.assigneeId,
          suggestedDueDate: dueBefore(ctx, t.plannedStartDate),
          dueRationale: t.plannedStartDate ? "Clear it before the planned start." : "Blocked work should be triaged today.",
          subject: { type: "task", id: t.id },
          stageId: t.stageId,
          evidence: [ctx.taskEvidence(t)],
          impact,
          reevaluateWhen: "The task status changes from blocked.",
        }),
      );
    }

    // Unassigned upcoming work.
    if (t.plannedStartDate && !t.assigneeId && !t.crewTeamId && !t.subcontractorId) {
      const d = ctx.daysUntil(t.plannedStartDate);
      if (d >= 0 && d <= s.lookaheadDays) {
        out.push(
          make({
            ruleKey: "schedule.unassigned",
            agent: "schedule",
            category: "assignment",
            dedupeKey: `schedule.unassigned:${t.id}`,
            severity: d <= s.criticalWindowDays ? "high" : "medium",
            title: `No one is assigned to "${t.title}"`,
            observation: `Starts ${t.plannedStartDate} (in ${plural(d, "day")}) with no assignee, crew or subcontractor.`,
            risk: "Unowned work tends to start late or not at all.",
            recommendedAction: "Assign a crew, team member or subcontractor and confirm their availability.",
            responsibleRole: "project_manager",
            suggestedDueDate: dueBefore(ctx, t.plannedStartDate, 2),
            dueRationale: "Two days before the planned start, to allow confirmation.",
            subject: { type: "task", id: t.id },
            stageId: t.stageId,
            evidence: [ctx.taskEvidence(t, `starts ${t.plannedStartDate}, unassigned`)],
            reevaluateWhen: "Someone is assigned or the start date moves.",
          }),
        );
      }
    }

    // Predecessors that won't be finished in time.
    if (t.plannedStartDate) {
      const d = ctx.daysUntil(t.plannedStartDate);
      if (d <= s.lookaheadDays && t.status === "todo") {
        for (const dep of ctx.predecessors.get(t.id) ?? []) {
          const pred = ctx.taskById.get(dep.predecessorId);
          if (!pred || !isOpenTask(pred)) continue;
          const pFinish = taskFinish(pred);
          const notInTime = dep.type === "FS" ? !pFinish || pFinish >= t.plannedStartDate || pFinish < today : dep.type === "SS" ? pred.status === "todo" && (!pred.plannedStartDate || pred.plannedStartDate > t.plannedStartDate) : false;
          if (!notInTime) continue;
          flaggedPairs.add(`${pred.id}>${t.id}`);
          const predCritical = ctx.isCritical(pred.id);
          out.push(
            make({
              ruleKey: "schedule.predecessor_incomplete",
              agent: "schedule",
              category: "dependency",
              dedupeKey: `schedule.predecessor_incomplete:${pred.id}:${t.id}`,
              severity: d <= s.criticalWindowDays && (predCritical || ctx.isCritical(t.id)) ? "critical" : "high",
              title: `"${t.title}" starts before "${pred.title}" is finished`,
              observation: `"${t.title}" is planned to start ${t.plannedStartDate}; its ${dep.type} predecessor "${pred.title}" is ${pred.status}${pFinish ? ` and planned to finish ${pFinish}` : " with no planned finish"}.`,
              risk: "Starting out of sequence causes rework, or the crew arrives and can't work.",
              recommendedAction: `Finish "${pred.title}" before ${t.plannedStartDate}, or move "${t.title}" in the schedule.`,
              responsibleRole: "project_manager",
              assigneeId: pred.assigneeId,
              suggestedDueDate: dueBefore(ctx, t.plannedStartDate),
              dueRationale: "The day before the dependent work is planned to start.",
              subject: { type: "task", id: t.id },
              stageId: t.stageId,
              evidence: [ctx.taskEvidence(t), ctx.taskEvidence(pred), { type: "dependency", id: dep.id, label: `${pred.title} → ${t.title}`, detail: `${dep.type}${dep.lagDays ? ` +${dep.lagDays}d` : ""}` }],
              impact: [{ type: "task", id: t.id, label: t.title }, ...successorsImpact(ctx, t.id)],
              reevaluateWhen: "The predecessor is completed or either date changes.",
            }),
          );
        }
      }
    }
  }

  // Planned dates that violate dependencies (manual edits), not already flagged above.
  for (const v of findDependencyViolations(
    ctx.snap.tasks.map((t) => ({ id: t.id, durationDays: t.durationDays, status: t.status, plannedStartDate: t.plannedStartDate, actualStartDate: t.actualStartDate, actualEndDate: t.actualEndDate })),
    ctx.snap.dependencies,
  )) {
    if (flaggedPairs.has(`${v.predecessorId}>${v.successorId}`)) continue;
    const pred = ctx.taskById.get(v.predecessorId)!;
    const succ = ctx.taskById.get(v.successorId)!;
    if (!isOpenTask(succ)) continue;
    const soon = !!succ.plannedStartDate && ctx.daysUntil(succ.plannedStartDate) <= s.lookaheadDays;
    out.push(
      make({
        ruleKey: "schedule.dependency_violation",
        agent: "schedule",
        category: "dependency",
        dedupeKey: `schedule.dependency_violation:${v.predecessorId}:${v.successorId}`,
        severity: soon ? "high" : "medium",
        title: `"${succ.title}" is planned too early for its dependency`,
        observation: `The ${v.type} dependency on "${pred.title}" requires "${succ.title}" to move ${plural(v.requiredShiftDays, "working day")} later.`,
        risk: "The plan shown to crews and the client can't be met as drawn.",
        recommendedAction: "Recalculate the schedule or adjust the dependency so the plan is consistent.",
        responsibleRole: "project_manager",
        suggestedDueDate: dueBefore(ctx, succ.plannedStartDate, 3),
        dueRationale: "Fix the plan before crews are booked.",
        subject: { type: "task", id: succ.id },
        stageId: succ.stageId,
        evidence: [ctx.taskEvidence(pred), ctx.taskEvidence(succ)],
        impact: successorsImpact(ctx, succ.id),
        reevaluateWhen: "Either task's dates or the dependency change.",
      }),
    );
  }

  // Double-booked people/crews within the lookahead.
  const horizon = addCalendarDays(today, s.lookaheadDays);
  const conflicts = findResourceConflicts(
    ctx.snap.tasks
      .filter((t) => isOpenTask(t) && t.plannedStartDate && t.plannedStartDate <= horizon)
      .map((t) => ({ id: t.id, durationDays: t.durationDays, status: t.status, plannedStartDate: t.plannedStartDate, resources: [t.assigneeId, t.crewTeamId, t.subcontractorId].filter((r): r is string => !!r) })),
  ).filter((c) => c.date >= today && c.date <= horizon);
  const byResource = new Map<string, typeof conflicts>();
  for (const c of conflicts) byResource.set(c.resource, [...(byResource.get(c.resource) ?? []), c]);
  for (const [resource, list] of byResource) {
    const first = list[0]!;
    const taskIds = [...new Set(list.flatMap((c) => c.taskIds))];
    const tasks = taskIds.map((id) => ctx.taskById.get(id)!);
    const who = ctx.name(resource) ?? "A crew member";
    const isSub = tasks.some((t) => t.subcontractorId === resource);
    out.push(
      make({
        ruleKey: "schedule.resource_conflict",
        agent: isSub ? "procurement" : "schedule",
        category: "resources",
        dedupeKey: `schedule.resource_conflict:${resource}:${taskIds.sort().join(",")}`,
        severity: ctx.daysUntil(first.date) <= s.criticalWindowDays ? "high" : "medium",
        title: `${who} is double-booked from ${first.date}`,
        observation: `${who} is assigned to ${plural(tasks.length, "overlapping task")} on ${plural(list.length, "day")}: ${tasks.map((t) => `"${t.title}"`).join(", ")}.`,
        risk: "One of the tasks will slip unless it's resourced differently.",
        recommendedAction: "Reassign one task or stagger the dates.",
        responsibleRole: "project_manager",
        suggestedDueDate: dueBefore(ctx, first.date, 2),
        dueRationale: "Resolve before the first overlapping day.",
        subject: { type: "task", id: tasks[0]!.id },
        stageId: tasks[0]!.stageId,
        evidence: tasks.map((t) => ctx.taskEvidence(t)),
        reevaluateWhen: "Assignments or dates change.",
      }),
    );
  }

  // Tasks in the next stage with no dates (missing data, not a failure).
  const nextStage = ctx.stages.find((st) => st.status === "not_started");
  if (nextStage) {
    const undated = ctx.stageTasks(nextStage.id).filter((t) => isOpenTask(t) && !t.plannedStartDate);
    if (undated.length) {
      out.push(
        make({
          ruleKey: "schedule.missing_dates",
          agent: "schedule",
          category: "missing_data",
          dedupeKey: `schedule.missing_dates:${nextStage.id}`,
          severity: "low",
          confidence: "medium",
          missingData: true,
          title: `${nextStage.name} has ${plural(undated.length, "task")} without dates`,
          observation: undated.map((t) => `"${t.title}"`).join(", ") + " have no planned start.",
          risk: "Undated work can't be checked for conflicts, materials or readiness.",
          recommendedAction: "Add planned dates or recalculate the schedule from the stage plan.",
          responsibleRole: "project_manager",
          suggestedDueDate: dueBefore(ctx, ctx.stageStart(nextStage), 5),
          dueRationale: "Dates are needed before the stage can be prepared.",
          subject: { type: "stage", id: nextStage.id },
          stageId: nextStage.id,
          evidence: undated.map((t) => ctx.taskEvidence(t, "no planned dates")),
          reevaluateWhen: "Dates are added.",
        }),
      );
    }
  }

  // Projected completion slipping past the plan.
  const p = ctx.snap.project;
  if (p.plannedCompletionDate && p.projectedCompletionDate && p.projectedCompletionDate > p.plannedCompletionDate && !p.actualCompletionDate) {
    const slip = diffCalendarDays(p.plannedCompletionDate, p.projectedCompletionDate);
    out.push(
      make({
        ruleKey: "schedule.completion_slip",
        agent: "schedule",
        category: "milestone_risk",
        dedupeKey: `schedule.completion_slip:${p.id}`,
        severity: slip > s.slipDaysHigh ? "high" : "medium",
        title: `Completion is projected ${plural(slip, "day")} late`,
        observation: `Planned completion ${p.plannedCompletionDate}; the schedule now projects ${p.projectedCompletionDate}.`,
        risk: "The contract completion date and the homeowner's expectations are at risk.",
        recommendedAction: "Review critical-path tasks for recovery options (resequencing, added crew) and tell the homeowner if the date will move.",
        responsibleRole: "project_manager",
        suggestedDueDate: addCalendarDays(today, 2),
        dueRationale: "Recovery options shrink the longer a slip goes unaddressed.",
        subject: { type: "project", id: p.id },
        evidence: [{ type: "project", id: p.id, label: p.name, detail: `planned ${p.plannedCompletionDate}, projected ${p.projectedCompletionDate}` }],
        proposedAction: { type: "draft_message", audience: "homeowner", kind: "schedule_change" },
        requiresApproval: true,
        reevaluateWhen: "The projected completion date changes.",
      }),
    );
  }

  // Weather warnings on weather-sensitive work (never reschedules).
  for (const a of ctx.snap.weatherAlerts) {
    if (!a.taskId || a.date < today) continue;
    const t = ctx.taskById.get(a.taskId);
    if (!t || !isOpenTask(t)) continue;
    out.push(
      make({
        ruleKey: "schedule.weather_risk",
        agent: "schedule",
        category: "weather",
        dedupeKey: `schedule.weather_risk:${a.id}`,
        severity: ctx.isCritical(t.id) ? "high" : "medium",
        confidence: "medium",
        title: `Weather risk for "${t.title}" on ${a.date}`,
        observation: a.summary,
        risk: "Weather-sensitive work may need to stop or be redone.",
        recommendedAction: "Review the forecast with the crew lead and decide whether to proceed, protect the work or reschedule. The app won't move dates automatically.",
        responsibleRole: "field_supervisor",
        assigneeId: t.assigneeId,
        suggestedDueDate: dueBefore(ctx, a.date),
        dueRationale: "Decide the day before so the crew can be told.",
        subject: { type: "task", id: t.id },
        stageId: t.stageId,
        evidence: [ctx.taskEvidence(t), { type: "weather_alert", id: a.id, label: `Forecast ${a.date}`, detail: a.summary }],
        proposedAction: { type: "draft_message", audience: "homeowner", kind: "weather_delay" },
        requiresApproval: true,
        reevaluateWhen: "The forecast changes or the date passes.",
        expiresAt: addCalendarDays(a.date, 1),
      }),
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// Readiness & quality
// ---------------------------------------------------------------------------

function windowSeverity(days: number | null, s: IntelligenceSettings): Severity {
  if (days === null) return "medium";
  if (days <= s.criticalWindowDays) return "critical";
  if (days <= s.attentionWindowDays) return "high";
  return "medium";
}

function readinessRules(ctx: AnalysisContext, s: IntelligenceSettings): Finding[] {
  const out: Finding[] = [];
  const upcoming = ctx.stages.filter((st) => {
    if (st.status !== "not_started") return false;
    const start = ctx.stageStart(st);
    return st === ctx.stages.find((x) => x.status === "not_started") || (!!start && ctx.daysUntil(start) <= s.lookaheadDays);
  });

  const gateIdx = ctx.stageIndex(s.permitGateFromStage);
  const permit = ctx.permitStatus();
  for (const st of upcoming) {
    const start = ctx.stageStart(st);
    const days = start ? ctx.daysUntil(start) : null;
    const idx = ctx.stages.indexOf(st);

    if (gateIdx >= 0 && idx >= gateIdx && permit.state !== "issued") {
      const unknown = permit.state === "unknown";
      const fromRecords = permit.source === "permits";
      const blocking = permit.permits.filter((x) => !x.authorizesWork);
      out.push(
        make({
          ruleKey: "readiness.permit_gate",
          agent: "readiness",
          category: "permit",
          dedupeKey: `readiness.permit_gate:${st.id}`,
          severity: unknown ? "medium" : windowSeverity(days, s),
          confidence: unknown ? "low" : "high",
          missingData: unknown,
          title: unknown ? `Can't confirm a permit for ${st.name}` : `${st.name} needs an issued permit`,
          observation: unknown
            ? "There are no permit records, permits stage or permit-issued checklist item in this project, so issuance can't be checked."
            : fromRecords
              ? `${st.name}${start ? ` is planned to start ${start}` : " is next"}, but ${blocking.map((x) => `the ${x.evidence.label} is ${x.status.replace(/_/g, " ")}`).join("; ")}.`
              : `${st.name}${start ? ` is planned to start ${start}` : " is next"}, but the permit isn't recorded as issued.`,
          risk: "Starting permitted work without an issued permit can mean a stop-work order, fines or tear-out.",
          recommendedAction: unknown
            ? "Add the project's permits so readiness can be tracked."
            : fromRecords
              ? "Confirm status with the jurisdiction and record the issued permit (or withdraw one that no longer applies) before work starts; hold the start date until then."
              : "Confirm permit status with the jurisdiction and mark it issued in the permits stage before work starts; hold the start date until then.",
          responsibleRole: "office",
          suggestedDueDate: dueBefore(ctx, start, 2),
          dueRationale: "Permit status must be confirmed before mobilizing.",
          subject: { type: "stage", id: st.id },
          stageId: st.id,
          evidence: [ctx.stageEvidence(st), ...permit.evidence],
          requiresApproval: false,
          reevaluateWhen: fromRecords ? "A permit is recorded as issued, or withdrawn." : "A permit is added, or the permits stage or its issued checklist item is completed.",
        }),
      );
    }

    for (const type of s.inspectionGates[st.key] ?? []) {
      const insp = ctx.latestInspection(type);
      if (insp?.result === "pass") continue;
      const label = type.replace(/_/g, " ");
      const pendingInTime = insp?.result === "pending" && !!insp.scheduledFor && !!start && insp.scheduledFor < start;
      out.push(
        make({
          ruleKey: "readiness.inspection_gate",
          agent: "readiness",
          category: "inspection",
          dedupeKey: `readiness.inspection_gate:${st.id}:${type}`,
          severity: pendingInTime ? (days !== null && days <= s.criticalWindowDays ? "high" : "medium") : windowSeverity(days, s),
          title: `${st.name} needs a passed ${label} inspection`,
          observation: insp
            ? `The latest ${label} inspection is ${insp.result}${insp.scheduledFor ? ` (scheduled ${insp.scheduledFor})` : ""}.`
            : `No ${label} inspection is recorded and ${st.name} ${start ? `starts ${start}` : "is next"}.`,
          risk: "Work done before a required inspection passes may have to be removed, and the inspection can't be done once the work is covered.",
          recommendedAction: insp?.result === "fail" || insp?.result === "partial" ? "Complete the corrective work and book a re-inspection; a qualified inspector must record the pass." : "Schedule the inspection and hold the start until a qualified inspector records a pass.",
          responsibleRole: "field_supervisor",
          suggestedDueDate: dueBefore(ctx, start, 2),
          dueRationale: "Inspections need lead time to book.",
          subject: insp ? { type: "inspection", id: insp.id } : { type: "stage", id: st.id },
          stageId: st.id,
          evidence: [ctx.stageEvidence(st), ...(insp ? [{ type: "inspection" as const, id: insp.id, label: `${label} inspection`, detail: `result ${insp.result}` }] : [])],
          reevaluateWhen: "An inspection of this type is recorded or the stage date moves.",
        }),
      );
    }

    // Concealment: photo documentation before work is covered.
    const concealed = new Set(s.concealment[st.key] ?? []);
    if (concealed.size && days !== null && days <= s.lookaheadDays) {
      const missing = ctx.snap.checklist.filter((c) => {
        if (!c.requiresPhoto || (c.isChecked && c.hasPhoto)) return false;
        const task = ctx.taskById.get(c.taskId);
        const stage = task?.stageId ? ctx.stageById.get(task.stageId) : undefined;
        return !!stage && concealed.has(stage.key);
      });
      if (missing.length) {
        out.push(
          make({
            ruleKey: "readiness.concealment",
            agent: "readiness",
            category: "quality",
            dedupeKey: `readiness.concealment:${st.id}`,
            severity: windowSeverity(days, s),
            title: `Photo records missing before ${st.name} covers earlier work`,
            observation: `${plural(missing.length, "required photo item")} ${missing.length === 1 ? "is" : "are"} incomplete: ${missing
              .slice(0, 5)
              .map((c) => `"${c.label}"`)
              .join(", ")}${missing.length > 5 ? "…" : ""}.`,
            risk: "Once covered, the work can't be documented or re-inspected without demolition.",
            recommendedAction: "Capture the photos and complete the checklist items, and have a qualified person verify the work before it's covered.",
            responsibleRole: "field_supervisor",
            suggestedDueDate: dueBefore(ctx, start, 1),
            dueRationale: "Must be done before the covering work starts.",
            subject: { type: "stage", id: st.id },
            stageId: st.id,
            evidence: missing.map((c) => ({ type: "checklist_item" as const, id: c.id, label: c.label, detail: `${c.isChecked ? "checked" : "unchecked"}, ${c.hasPhoto ? "photo" : "no photo"}` })),
            reevaluateWhen: "The photos are attached and items checked.",
          }),
        );
      }
    }
  }

  // Issued permits that have expired or will expire before the work is done.
  const finished = ["completed", "warranty", "cancelled"].includes(ctx.snap.project.status);
  for (const pm of finished ? [] : ctx.snap.permits) {
    if (pm.status !== "issued" || !pm.expiresOn) continue;
    const days = ctx.daysUntil(pm.expiresOn);
    if (days > s.permitExpiryWarnDays) continue;
    const expired = days < 0;
    const label = ctx.permitLabel(pm);
    out.push(
      make({
        ruleKey: "readiness.permit_expiry",
        agent: "readiness",
        category: "permit",
        dedupeKey: `readiness.permit_expiry:${pm.id}:${expired ? "expired" : "expiring"}`,
        severity: expired ? "high" : "medium",
        title: expired ? `The ${label} has expired` : `The ${label} expires ${pm.expiresOn}`,
        observation: expired
          ? `The permit expired on ${pm.expiresOn} and the project isn't finished.`
          : `The permit expires in ${plural(days, "day")} (${pm.expiresOn}) and the project isn't finished.`,
        risk: "Work under an expired permit can be stopped, and the remaining inspections may need a renewed permit.",
        recommendedAction: "Ask the jurisdiction about an extension or renewal and record the new expiry date.",
        responsibleRole: "office",
        suggestedDueDate: expired ? ctx.today : addCalendarDays(pm.expiresOn, -Math.min(5, days)),
        dueRationale: "Renewals need to be filed before the permit lapses.",
        subject: { type: "permit", id: pm.id },
        stageId: pm.stageId,
        evidence: [ctx.permitEvidence(pm)],
        reevaluateWhen: "The permit's expiry date or status changes.",
      }),
    );
  }

  // Failed inspections without a later pass.
  const types = [...new Set(ctx.snap.inspections.map((i) => i.inspectionType))];
  for (const type of types) {
    const insp = ctx.latestInspection(type)!;
    if (insp.result !== "fail" && insp.result !== "partial") continue;
    const corrective = ctx.snap.tasks.filter((t) => t.sourceInspectionId === insp.id);
    const open = corrective.filter(isOpenTask);
    out.push(
      make({
        ruleKey: "readiness.inspection_failed",
        agent: "readiness",
        category: "inspection",
        dedupeKey: `readiness.inspection_failed:${insp.id}`,
        severity: "high",
        title: `${type.replace(/_/g, " ")} inspection ${insp.result === "fail" ? "failed" : "partially passed"}`,
        observation: `${plural(open.length, "corrective task")} open of ${corrective.length}.`,
        risk: "Later stages can't proceed until the inspection passes.",
        recommendedAction: open.length ? "Complete the corrective tasks, then book a re-inspection." : "Book the re-inspection; a qualified inspector must record the pass.",
        responsibleRole: "field_supervisor",
        suggestedDueDate: addCalendarDays(ctx.today, 3),
        dueRationale: "Re-inspections usually need a few days' notice.",
        subject: { type: "inspection", id: insp.id },
        stageId: insp.stageId,
        evidence: [{ type: "inspection", id: insp.id, label: `${type} inspection`, detail: `result ${insp.result}` }, ...open.map((t) => ctx.taskEvidence(t))],
        impact: open.map((t) => ({ type: "task" as const, id: t.id, label: t.title })),
        reevaluateWhen: "A passing inspection of this type is recorded.",
      }),
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// Procurement & subcontractors
// ---------------------------------------------------------------------------

function procurementRules(ctx: AnalysisContext, s: IntelligenceSettings): Finding[] {
  const out: Finding[] = [];
  for (const m of ctx.snap.materials) {
    if (m.status === "delivered" || m.status === "installed" || m.status === "returned") continue;
    const task = m.taskId ? ctx.taskById.get(m.taskId) : undefined;
    if (task && !isOpenTask(task)) continue;
    const needBy = m.requiredBy ?? task?.plannedStartDate ?? null;
    const ev: Evidence = { type: "material", id: m.id, label: m.name, detail: `status ${m.status}${m.orderedAt ? `, ordered ${m.orderedAt}` : ""}${m.expectedDeliveryDate ? `, expected ${m.expectedDeliveryDate}` : ""}${m.deliveryConfirmedAt ? ", confirmed" : ""}` };
    const evidence = task ? [ev, ctx.taskEvidence(task)] : [ev];
    const impact = task ? [{ type: "task" as const, id: task.id, label: task.title }] : [];
    const critical = task ? ctx.isCritical(task.id) : false;

    if (!needBy) {
      if (m.status === "planned") {
        out.push(
          make({
            ruleKey: "procurement.no_required_date",
            agent: "procurement",
            category: "missing_data",
            dedupeKey: `procurement.no_required_date:${m.id}`,
            severity: "low",
            confidence: "medium",
            missingData: true,
            title: `${m.name} has no required-by date`,
            observation: "It isn't linked to a dated task and has no required-by date, so ordering can't be timed.",
            risk: "Long-lead items can be ordered too late.",
            recommendedAction: "Link it to the task that installs it or set a required-by date.",
            responsibleRole: "project_manager",
            suggestedDueDate: addCalendarDays(ctx.today, 7),
            dueRationale: "Routine data clean-up.",
            subject: { type: "material", id: m.id },
            evidence,
            reevaluateWhen: "A date is added.",
          }),
        );
      }
      continue;
    }
    const daysToNeed = ctx.daysUntil(needBy);
    const lead = m.leadTimeDays ?? s.defaultLeadTimeDays;

    if (m.status === "planned") {
      const orderBy = addCalendarDays(needBy, -lead);
      const daysToOrder = ctx.daysUntil(orderBy);
      if (daysToOrder <= 3) {
        out.push(
          make({
            ruleKey: "procurement.not_ordered",
            agent: "procurement",
            category: "materials",
            dedupeKey: `procurement.not_ordered:${m.id}`,
            severity: daysToOrder <= 0 ? (daysToNeed <= s.criticalWindowDays && critical ? "critical" : "high") : "medium",
            confidence: m.leadTimeDays === null ? "medium" : "high",
            title: daysToOrder <= 0 ? `${m.name} should already be ordered` : `Order ${m.name} by ${orderBy}`,
            observation: `Needed by ${needBy}${task ? ` for "${task.title}"` : ""}; lead time ${plural(lead, "day")}${m.leadTimeDays === null ? " (default — no lead time recorded)" : ""}; not ordered.`,
            risk: "The installing task will wait on delivery.",
            recommendedAction: `Place the order${m.vendorName ? ` with ${m.vendorName}` : ""} and record the expected delivery date.`,
            responsibleRole: "project_manager",
            suggestedDueDate: latest(ctx.today, orderBy),
            dueRationale: `Lead time of ${plural(lead, "day")} before ${needBy}.`,
            subject: { type: "material", id: m.id },
            stageId: task?.stageId ?? null,
            evidence,
            impact,
            reevaluateWhen: "The material is marked ordered or the need date changes.",
          }),
        );
      }
      continue;
    }

    // Ordered.
    if (m.expectedDeliveryDate && m.expectedDeliveryDate > needBy) {
      out.push(
        make({
          ruleKey: "procurement.late_delivery",
          agent: "procurement",
          category: "materials",
          dedupeKey: `procurement.late_delivery:${m.id}`,
          severity: critical && daysToNeed <= s.lookaheadDays ? "critical" : "high",
          title: `${m.name} arrives after it's needed`,
          observation: `Expected ${m.expectedDeliveryDate}; needed by ${needBy}${task ? ` for "${task.title}"` : ""}.`,
          risk: `"${task?.title ?? "The installing work"}" will slip by at least ${plural(diffCalendarDays(needBy, m.expectedDeliveryDate), "day")}.`,
          recommendedAction: "Ask the supplier to expedite, source an alternative, or re-sequence the work that needs it.",
          responsibleRole: "project_manager",
          suggestedDueDate: ctx.today,
          dueRationale: "The delivery date already conflicts with the plan.",
          subject: { type: "material", id: m.id },
          stageId: task?.stageId ?? null,
          evidence,
          impact,
          proposedAction: { type: "draft_message", audience: "supplier", kind: "delivery_follow_up" },
          requiresApproval: true,
          reevaluateWhen: "The expected delivery or need date changes.",
        }),
      );
    } else if (!m.deliveryConfirmedAt && daysToNeed <= s.deliveryConfirmDays) {
      out.push(
        make({
          ruleKey: "procurement.delivery_unconfirmed",
          agent: "procurement",
          category: "materials",
          dedupeKey: `procurement.delivery_unconfirmed:${m.id}`,
          severity: daysToNeed <= s.criticalWindowDays ? "high" : "medium",
          missingData: !m.expectedDeliveryDate,
          title: `Confirm delivery of ${m.name}`,
          observation: `Ordered${m.orderedAt ? ` ${m.orderedAt}` : ""}; needed by ${needBy}; ${m.expectedDeliveryDate ? `expected ${m.expectedDeliveryDate} but not confirmed` : "no expected delivery date recorded"}.`,
          risk: "An unconfirmed delivery is the most common cause of a crew standing idle.",
          recommendedAction: `Confirm the delivery date${m.vendorName ? ` with ${m.vendorName}` : ""} and record it.`,
          responsibleRole: "project_manager",
          suggestedDueDate: dueBefore(ctx, needBy, 3),
          dueRationale: "Three days' notice leaves time to react.",
          subject: { type: "material", id: m.id },
          stageId: task?.stageId ?? null,
          evidence,
          impact,
          proposedAction: { type: "draft_message", audience: "supplier", kind: "delivery_follow_up" },
          requiresApproval: true,
          reevaluateWhen: "Delivery is confirmed or the material is delivered.",
        }),
      );
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Homeowner communication
// ---------------------------------------------------------------------------

function communicationRules(ctx: AnalysisContext, s: IntelligenceSettings): Finding[] {
  const out: Finding[] = [];
  const { today } = ctx;
  const p = ctx.snap.project;
  for (const a of ctx.snap.approvals.filter((x) => x.status === "pending")) {
    const ev: Evidence = { type: "approval", id: a.id, label: a.title, detail: `pending since ${a.createdAt.slice(0, 10)}${a.dueDate ? `, due ${a.dueDate}` : ""}` };
    if (a.dueDate && a.dueDate < today) {
      const days = diffCalendarDays(a.dueDate, today);
      out.push(
        make({
          ruleKey: "communication.decision_overdue",
          agent: "communication",
          category: "decision",
          dedupeKey: `communication.decision_overdue:${a.id}`,
          severity: "high",
          title: `Homeowner decision overdue: ${a.title}`,
          observation: `Due ${a.dueDate} (${plural(days, "day")} ago); still pending.`,
          risk: "Work that depends on the decision can't be scheduled or ordered.",
          recommendedAction: "Contact the homeowner, explain what the decision holds up, and agree a new date.",
          responsibleRole: "project_manager",
          suggestedDueDate: today,
          dueRationale: "Already overdue.",
          subject: { type: "approval", id: a.id },
          evidence: [ev],
          proposedAction: { type: "draft_message", audience: "homeowner", kind: "decision_reminder" },
          requiresApproval: true,
          reevaluateWhen: "The approval is decided.",
        }),
      );
    } else if (a.dueDate && diffCalendarDays(today, a.dueDate) <= s.decisionDueSoonDays) {
      out.push(
        make({
          ruleKey: "communication.decision_due_soon",
          agent: "communication",
          category: "decision",
          dedupeKey: `communication.decision_due_soon:${a.id}`,
          severity: "medium",
          title: `Homeowner decision due ${a.dueDate}: ${a.title}`,
          observation: "Pending approval coming due.",
          risk: "A missed decision date delays dependent work.",
          recommendedAction: "Send a friendly reminder with what's needed and why.",
          responsibleRole: "project_manager",
          suggestedDueDate: today,
          dueRationale: `Due within ${plural(s.decisionDueSoonDays, "day")}.`,
          subject: { type: "approval", id: a.id },
          evidence: [ev],
          proposedAction: { type: "draft_message", audience: "homeowner", kind: "decision_reminder" },
          requiresApproval: true,
          reevaluateWhen: "The approval is decided.",
          expiresAt: a.dueDate,
        }),
      );
    }
  }

  for (const co of ctx.snap.changeOrders.filter((c) => c.status === "client_review")) {
    if (!co.submittedAt) continue;
    const waited = diffCalendarDays(co.submittedAt.slice(0, 10), today);
    if (waited < s.changeOrderWaitDays) continue;
    out.push(
      make({
        ruleKey: "communication.change_order_waiting",
        agent: "communication",
        category: "change_order",
        dedupeKey: `communication.change_order_waiting:${co.id}`,
        severity: co.scheduleImpactDays > 0 ? "high" : "medium",
        title: `Change order #${co.number} waiting on the homeowner for ${plural(waited, "day")}`,
        observation: `"${co.title}" has been in client review since ${co.submittedAt.slice(0, 10)}${co.scheduleImpactDays ? `; schedule impact ${plural(co.scheduleImpactDays, "day")}` : ""}.`,
        risk: "Unapproved changes can't be scheduled or ordered, and the work around them stalls.",
        recommendedAction: "Follow up with the homeowner and offer to walk through the change order.",
        responsibleRole: "project_manager",
        suggestedDueDate: today,
        dueRationale: `Waiting longer than ${plural(s.changeOrderWaitDays, "day")}.`,
        subject: { type: "change_order", id: co.id },
        evidence: [{ type: "change_order", id: co.id, label: `CO #${co.number} ${co.title}`, detail: `client review since ${co.submittedAt.slice(0, 10)}` }],
        proposedAction: { type: "draft_message", audience: "homeowner", kind: "change_order_explanation" },
        requiresApproval: true,
        reevaluateWhen: "The change order is decided.",
      }),
    );
  }

  if (ACTIVE_PROJECT_STATUSES.includes(p.status)) {
    const since = p.lastClientUpdateAt ?? p.createdAt;
    const days = diffCalendarDays(since.slice(0, 10), today);
    if (days >= s.clientUpdateDays) {
      out.push(
        make({
          ruleKey: "communication.client_update_due",
          agent: "communication",
          category: "client_update",
          dedupeKey: `communication.client_update_due:${p.id}`,
          severity: days >= s.clientUpdateDays * 2 ? "medium" : "low",
          title: `The homeowner hasn't had an update in ${plural(days, "day")}`,
          observation: p.lastClientUpdateAt ? `Last client-visible update ${p.lastClientUpdateAt.slice(0, 10)}.` : "No client-visible update has been recorded on this project.",
          risk: "Silence during construction drives anxious calls and erodes trust.",
          recommendedAction: "Send a short progress update: what's done, what's next, and anything you need from them.",
          responsibleRole: "project_manager",
          suggestedDueDate: today,
          dueRationale: `Updates are expected every ${plural(s.clientUpdateDays, "day")}.`,
          subject: { type: "project", id: p.id },
          evidence: [{ type: "project", id: p.id, label: p.name, detail: `last client update ${p.lastClientUpdateAt?.slice(0, 10) ?? "never"}` }],
          proposedAction: { type: "draft_message", audience: "homeowner", kind: "weekly_update" },
          requiresApproval: true,
          reevaluateWhen: "A client-visible message or update is posted.",
        }),
      );
    }
    if (p.lastScheduleChangeAt && (!p.lastClientUpdateAt || p.lastScheduleChangeAt > p.lastClientUpdateAt)) {
      out.push(
        make({
          ruleKey: "communication.schedule_change_uncommunicated",
          agent: "communication",
          category: "client_update",
          dedupeKey: `communication.schedule_change_uncommunicated:${p.id}`,
          severity: "medium",
          title: "A schedule change hasn't been shared with the homeowner",
          observation: `The schedule changed ${p.lastScheduleChangeAt.slice(0, 10)}; no client-visible update since.`,
          risk: "The homeowner may be planning around dates that no longer hold.",
          recommendedAction: "Explain the change, its cause and the new dates in a client update.",
          responsibleRole: "project_manager",
          suggestedDueDate: today,
          dueRationale: "Changes should be communicated promptly.",
          subject: { type: "project", id: p.id },
          evidence: [{ type: "project", id: p.id, label: p.name, detail: `schedule changed ${p.lastScheduleChangeAt.slice(0, 10)}` }],
          proposedAction: { type: "draft_message", audience: "homeowner", kind: "schedule_change" },
          requiresApproval: true,
          reevaluateWhen: "A client-visible update is posted.",
        }),
      );
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Closeout & warranty
// ---------------------------------------------------------------------------

const CLOSEOUT_STATUSES = ["inspection", "client_approval", "completed", "warranty"];

function closeoutRules(ctx: AnalysisContext): Finding[] {
  const out: Finding[] = [];
  const p = ctx.snap.project;
  const nextKey = ctx.stages.find(isOpenStage)?.key;
  const inCloseout = CLOSEOUT_STATUSES.includes(p.status) || nextKey === "walkthrough" || nextKey === "completion";
  if (!inCloseout) return out;
  const projectEv: Evidence = { type: "project", id: p.id, label: p.name, detail: `status ${p.status}` };

  const open = ctx.snap.tasks.filter(isOpenTask);
  if (open.length && (p.status === "client_approval" || p.status === "completed" || p.status === "warranty")) {
    out.push(
      make({
        ruleKey: "closeout.punch_open",
        agent: "closeout",
        category: "punch_list",
        dedupeKey: `closeout.punch_open:${p.id}`,
        severity: p.status === "client_approval" ? "medium" : "high",
        title: `${plural(open.length, "open task")} at closeout`,
        observation: open
          .slice(0, 6)
          .map((t) => `"${t.title}"`)
          .join(", ") + (open.length > 6 ? "…" : ""),
        risk: "Handover with open items leads to call-backs and delayed final payment.",
        recommendedAction: "Walk the punch list with the crew lead, finish or cancel each item, and confirm with the homeowner.",
        responsibleRole: "field_supervisor",
        suggestedDueDate: addCalendarDays(ctx.today, 3),
        dueRationale: "Close out before the final walkthrough.",
        subject: { type: "project", id: p.id },
        evidence: [projectEv, ...open.slice(0, 10).map((t) => ctx.taskEvidence(t))],
        reevaluateWhen: "Open tasks are completed or cancelled.",
      }),
    );
  }
  const final = ctx.latestInspection("final");
  if (final?.result !== "pass" && (p.status === "client_approval" || p.status === "completed")) {
    out.push(
      make({
        ruleKey: "closeout.final_inspection",
        agent: "closeout",
        category: "inspection",
        dedupeKey: `closeout.final_inspection:${p.id}`,
        severity: "high",
        title: "No passed final inspection on record",
        observation: final ? `The latest final inspection is ${final.result}.` : "No final inspection has been recorded.",
        risk: "Handing over without a passed final inspection exposes the homeowner and the company.",
        recommendedAction: "Book the final inspection; a qualified inspector must record the result.",
        responsibleRole: "field_supervisor",
        suggestedDueDate: addCalendarDays(ctx.today, 3),
        dueRationale: "Required before handover.",
        subject: final ? { type: "inspection", id: final.id } : { type: "project", id: p.id },
        evidence: final ? [projectEv, { type: "inspection", id: final.id, label: "Final inspection", detail: `result ${final.result}` }] : [projectEv],
        reevaluateWhen: "A passing final inspection is recorded.",
      }),
    );
  }
  const walkthrough = ctx.snap.approvals.find((a) => a.subjectType === "walkthrough" && a.status === "approved");
  if (!walkthrough && (p.status === "completed" || p.status === "client_approval")) {
    const pending = ctx.snap.approvals.find((a) => a.subjectType === "walkthrough" && a.status === "pending");
    out.push(
      make({
        ruleKey: "closeout.walkthrough_signoff",
        agent: "closeout",
        category: "handover",
        dedupeKey: `closeout.walkthrough_signoff:${p.id}`,
        severity: "medium",
        title: pending ? "Walkthrough sign-off is pending" : "No walkthrough sign-off requested",
        observation: pending ? `"${pending.title}" is awaiting the homeowner.` : "There's no walkthrough approval on this project.",
        risk: "Without a signed walkthrough, punch items and handover are disputed later.",
        recommendedAction: pending ? "Remind the homeowner to sign off after the walkthrough." : "Schedule the final walkthrough and request the homeowner's sign-off in the app.",
        responsibleRole: "project_manager",
        suggestedDueDate: addCalendarDays(ctx.today, 5),
        dueRationale: "Sign-off closes the project.",
        subject: pending ? { type: "approval", id: pending.id } : { type: "project", id: p.id },
        evidence: pending ? [projectEv, { type: "approval", id: pending.id, label: pending.title, detail: "pending" }] : [projectEv],
        proposedAction: pending ? { type: "draft_message", audience: "homeowner", kind: "walkthrough" } : { type: "request_approval", title: "Final walkthrough sign-off", subjectType: "walkthrough", dueDate: addCalendarDays(ctx.today, 7) },
        requiresApproval: true,
        reevaluateWhen: "The walkthrough approval is decided.",
      }),
    );
  }
  const manuals = ctx.snap.documents.filter((d) => d.category === "manual");
  const warranty = ctx.snap.documents.filter((d) => d.category === "warranty");
  if ((!manuals.length || !warranty.length) && p.status !== "inspection") {
    const missing = [!manuals.length ? "equipment manuals" : null, !warranty.length ? "warranty documents" : null].filter(Boolean).join(" and ");
    out.push(
      make({
        ruleKey: "closeout.documents_missing",
        agent: "closeout",
        category: "handover",
        dedupeKey: `closeout.documents_missing:${p.id}`,
        severity: "medium",
        title: `Handover package is missing ${missing}`,
        observation: `Documents on file: ${manuals.length} manual(s), ${warranty.length} warranty document(s).`,
        risk: "The homeowner can't maintain the equipment or claim warranty without them.",
        recommendedAction: `Upload the ${missing} for the installed equipment and share them with the homeowner.`,
        responsibleRole: "office",
        suggestedDueDate: addCalendarDays(ctx.today, 5),
        dueRationale: "Part of the handover package.",
        subject: { type: "project", id: p.id },
        evidence: [projectEv, ...[...manuals, ...warranty].map((d) => ({ type: "document" as const, id: d.id, label: d.title, detail: d.category }))],
        reevaluateWhen: "Manuals and warranty documents are uploaded.",
      }),
    );
  }
  if (p.status === "warranty" && p.actualCompletionDate) {
    const elevenMonths = addCalendarDays(p.actualCompletionDate, 335);
    const days = ctx.daysUntil(elevenMonths);
    if (days >= 0 && days <= 30) {
      out.push(
        make({
          ruleKey: "closeout.warranty_check",
          agent: "closeout",
          category: "warranty",
          dedupeKey: `closeout.warranty_check:${p.id}`,
          severity: "low",
          title: "Schedule the 11-month warranty visit",
          observation: `Completed ${p.actualCompletionDate}; the first-year warranty period ends soon.`,
          risk: "Issues found after the warranty period become disputes.",
          recommendedAction: "Book a warranty walkthrough with the homeowner and log any items as tasks.",
          responsibleRole: "project_manager",
          suggestedDueDate: elevenMonths,
          dueRationale: "Visit before the first-year warranty ends.",
          subject: { type: "project", id: p.id },
          evidence: [projectEv],
          reevaluateWhen: "Monthly.",
          expiresAt: addCalendarDays(p.actualCompletionDate, 365),
        }),
      );
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Superintendent: project-level oversight
// ---------------------------------------------------------------------------

function superintendentRules(ctx: AnalysisContext, s: IntelligenceSettings): Finding[] {
  const p = ctx.snap.project;
  if (!ACTIVE_PROJECT_STATUSES.includes(p.status)) return [];
  const last = p.lastActivityAt ?? p.createdAt;
  const days = diffCalendarDays(last.slice(0, 10), ctx.today);
  if (days < s.inactivityDays) return [];
  return [
    make({
      ruleKey: "superintendent.inactive",
      agent: "superintendent",
      category: "inactivity",
      dedupeKey: `superintendent.inactive:${p.id}`,
      severity: "medium",
      title: `No activity on this project for ${plural(days, "day")}`,
      observation: `The last recorded activity was ${last.slice(0, 10)} while the project is ${p.status}.`,
      risk: "An active project going quiet usually means work stopped or isn't being recorded.",
      recommendedAction: "Check in with the crew lead and record today's status, or put the project on hold.",
      responsibleRole: "project_manager",
      suggestedDueDate: ctx.today,
      dueRationale: `No activity for over ${plural(s.inactivityDays, "day")}.`,
      subject: { type: "project", id: p.id },
      evidence: [{ type: "project", id: p.id, label: p.name, detail: `last activity ${last.slice(0, 10)}` }],
      reevaluateWhen: "Any activity is recorded.",
    }),
  ];
}

/** Run every rule over a snapshot. */
export function runRules(ctx: AnalysisContext, settings: IntelligenceSettings): Finding[] {
  return [
    ...superintendentRules(ctx, settings),
    ...scheduleRules(ctx, settings),
    ...readinessRules(ctx, settings),
    ...procurementRules(ctx, settings),
    ...communicationRules(ctx, settings),
    ...closeoutRules(ctx),
  ];
}
