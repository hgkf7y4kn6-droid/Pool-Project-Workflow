import { createHash } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  evaluateProject,
  findingFingerprint,
  resolveIntelligenceSettings,
  severityAtLeast,
  type Finding,
  type ProjectEvaluation,
} from "@pool/core";
import {
  intelligenceEvaluations,
  intelligenceRecommendationEvents,
  intelligenceRecommendations,
  projectMembers,
  users,
  type DbOrTx,
} from "@pool/database";
import { ACTIVE_RECOMMENDATION_STATUSES, SEVERITIES, type RecommendationStatus, type Severity } from "@pool/types";
import type { Deps } from "../../context";
import { notify } from "../notifications";
import { loadSnapshot } from "./snapshot";

type RecRow = typeof intelligenceRecommendations.$inferSelect;

export interface EvaluationOutcome {
  evaluationId: string;
  evaluation: ProjectEvaluation;
  inputHash: string;
  opened: number;
  updated: number;
  closed: number;
  skipped: boolean;
}

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32);

export async function recordRecommendationEvent(
  db: DbOrTx,
  input: { organizationId: string; recommendationId: string; action: string; fromStatus?: RecommendationStatus | null; toStatus?: RecommendationStatus | null; actorId?: string | null; automationPolicy?: string | null; note?: string | null; metadata?: Record<string, unknown> },
) {
  await db.insert(intelligenceRecommendationEvents).values({
    organizationId: input.organizationId,
    recommendationId: input.recommendationId,
    action: input.action,
    fromStatus: input.fromStatus ?? null,
    toStatus: input.toStatus ?? null,
    actorId: input.actorId ?? null,
    automationPolicy: input.automationPolicy ?? null,
    note: input.note ?? null,
    metadata: input.metadata ?? {},
  });
}

function findingValues(f: Finding) {
  return {
    agent: f.agent,
    ruleKey: f.ruleKey,
    category: f.category,
    fingerprint: hash(findingFingerprint(f)),
    severity: f.severity,
    confidence: f.confidence,
    title: f.title,
    observation: f.observation,
    risk: f.risk,
    recommendedAction: f.recommendedAction,
    responsibleRole: f.responsibleRole,
    suggestedDueDate: f.suggestedDueDate,
    dueRationale: f.dueRationale,
    subjectType: f.subject.type,
    subjectId: f.subject.id,
    stageId: f.stageId,
    evidence: f.evidence,
    impact: f.impact,
    missingData: f.missingData,
    requiresApproval: f.requiresApproval,
    proposedAction: f.proposedAction,
    reevaluateWhen: f.reevaluateWhen,
    expiresAt: f.expiresAt,
  };
}

/**
 * Evaluate a project's rules and reconcile the stored recommendations:
 *
 * - new finding → open recommendation
 * - finding still present → updated in place (status kept; a snooze that has
 *   ended reopens; a dismissal holds until the evidence fingerprint changes)
 * - previously closed finding that recurs → reopened
 * - active recommendation whose condition is gone → resolved by automation
 *
 * Runs under a per-project advisory lock in one transaction, so concurrent
 * triggers can't double-insert and a failure leaves the previous state intact.
 */
export async function evaluateAndPersist(
  deps: Deps,
  organizationId: string,
  projectId: string,
  opts: { trigger: string; actorId?: string | null; force?: boolean },
): Promise<EvaluationOutcome | null> {
  const started = Date.now();
  const loaded = await loadSnapshot(deps, organizationId, projectId);
  if (!loaded) return null;
  const settings = resolveIntelligenceSettings(loaded.organization.settings);
  const nowIso = deps.now().toISOString();
  const evaluation = evaluateProject(loaded.snapshot, settings, nowIso);
  const inputHash = hash({ snapshot: loaded.snapshot, settings });

  const result = await deps.db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`intel:${projectId}`}))`);
    const [last] = await tx
      .select({ id: intelligenceEvaluations.id, inputHash: intelligenceEvaluations.inputHash })
      .from(intelligenceEvaluations)
      .where(eq(intelligenceEvaluations.projectId, projectId))
      .orderBy(desc(intelligenceEvaluations.createdAt))
      .limit(1);
    if (!opts.force && last?.inputHash === inputHash) {
      return { outcome: { evaluationId: last.id, evaluation, inputHash, opened: 0, updated: 0, closed: 0, skipped: true } as EvaluationOutcome, toNotify: [] as { row: RecRow; reason: string }[] };
    }

    const existing = await tx.select().from(intelligenceRecommendations).where(eq(intelligenceRecommendations.projectId, projectId));
    const byKey = new Map(existing.map((r) => [r.dedupeKey, r]));
    const seen = new Set<string>();
    const toNotify: { row: RecRow; reason: string }[] = [];
    let opened = 0;
    let updated = 0;
    let closed = 0;
    const [evalRow] = await tx
      .insert(intelligenceEvaluations)
      .values({
        organizationId,
        projectId,
        trigger: opts.trigger,
        triggeredBy: opts.actorId ?? null,
        inputHash,
        readiness: evaluation.readiness,
        briefing: evaluation.briefing,
        counts: Object.fromEntries(SEVERITIES.map((s) => [s, evaluation.findings.filter((f) => f.severity === s).length])),
        durationMs: 0,
      })
      .returning({ id: intelligenceEvaluations.id });
    const evaluationId = evalRow!.id;

    for (const f of evaluation.findings) {
      seen.add(f.dedupeKey);
      const values = findingValues(f);
      const prev = byKey.get(f.dedupeKey);
      if (!prev) {
        const [row] = await tx
          .insert(intelligenceRecommendations)
          .values({ ...values, organizationId, projectId, dedupeKey: f.dedupeKey, assigneeId: f.assigneeId, status: "open", evaluationId })
          .returning();
        await recordRecommendationEvent(tx, { organizationId, recommendationId: row!.id, action: "detected", toStatus: "open", automationPolicy: `rules:${opts.trigger}` });
        opened += 1;
        toNotify.push({ row: row!, reason: "new" });
        continue;
      }
      const active = (ACTIVE_RECOMMENDATION_STATUSES as readonly string[]).includes(prev.status);
      let status: RecommendationStatus = prev.status;
      let event: { action: string; note: string | null } | null = null;
      // A person's dismissal or resolution holds until the evidence changes;
      // an automatic resolution reopens as soon as the condition recurs.
      const humanClosed = prev.status === "dismissed" || (prev.status === "resolved" && !!prev.resolvedBy);
      if (humanClosed) {
        if (prev.fingerprint !== values.fingerprint) {
          status = "open";
          event = { action: "reopened", note: `The evidence changed since it was ${prev.status}.` };
        }
      } else if (!active) {
        status = "open";
        event = { action: "recurred", note: "The condition was detected again." };
      } else if (prev.status === "snoozed" && prev.snoozedUntil && prev.snoozedUntil <= nowIso) {
        status = "open";
        event = { action: "snooze_ended", note: null };
      }
      if (humanClosed && status === prev.status) {
        await tx.update(intelligenceRecommendations).set({ lastDetectedAt: nowIso, evaluationId }).where(eq(intelligenceRecommendations.id, prev.id));
        continue;
      }
      const severityRaised = SEVERITIES.indexOf(values.severity) < SEVERITIES.indexOf(prev.severity);
      const [row] = await tx
        .update(intelligenceRecommendations)
        .set({
          ...values,
          status,
          snoozedUntil: status === "open" ? null : prev.snoozedUntil,
          resolvedAt: status === "open" ? null : prev.resolvedAt,
          resolvedBy: status === "open" ? null : prev.resolvedBy,
          dismissReason: status === "open" ? null : prev.dismissReason,
          // Keep a human assignment; otherwise follow the rule's suggestion.
          assigneeId: prev.assigneeId ?? f.assigneeId,
          lastDetectedAt: nowIso,
          evaluationId,
          updatedAt: nowIso,
        })
        .where(eq(intelligenceRecommendations.id, prev.id))
        .returning();
      if (event) {
        await recordRecommendationEvent(tx, { organizationId, recommendationId: prev.id, action: event.action, fromStatus: prev.status, toStatus: status, automationPolicy: `rules:${opts.trigger}`, note: event.note });
        toNotify.push({ row: row!, reason: event.action });
        opened += 1;
      } else if (prev.severity !== values.severity) {
        await recordRecommendationEvent(tx, { organizationId, recommendationId: prev.id, action: "severity_changed", fromStatus: prev.status, toStatus: status, automationPolicy: `rules:${opts.trigger}`, note: `${prev.severity} → ${values.severity}` });
        if (severityRaised) toNotify.push({ row: row!, reason: "severity_raised" });
        updated += 1;
      } else if (prev.fingerprint !== values.fingerprint) {
        updated += 1;
      }
    }

    // Conditions no longer detected close automatically; time-boxed ones expire.
    for (const prev of existing) {
      if (seen.has(prev.dedupeKey) || !(ACTIVE_RECOMMENDATION_STATUSES as readonly string[]).includes(prev.status)) continue;
      const expired = !!prev.expiresAt && prev.expiresAt < loaded.snapshot.today;
      const status: RecommendationStatus = expired ? "expired" : "resolved";
      await tx
        .update(intelligenceRecommendations)
        .set({ status, resolvedAt: nowIso, resolvedBy: null, resolutionNote: expired ? "Expired." : "The condition is no longer detected in the project records.", updatedAt: nowIso })
        .where(eq(intelligenceRecommendations.id, prev.id));
      await recordRecommendationEvent(tx, { organizationId, recommendationId: prev.id, action: expired ? "expired" : "auto_resolved", fromStatus: prev.status, toStatus: status, automationPolicy: `rules:${opts.trigger}` });
      closed += 1;
    }

    await tx
      .update(intelligenceEvaluations)
      .set({ opened, updated, closed, durationMs: Date.now() - started })
      .where(eq(intelligenceEvaluations.id, evaluationId));

    return { outcome: { evaluationId, evaluation, inputHash, opened, updated, closed, skipped: false } as EvaluationOutcome, toNotify };
  });
  // Notify after commit, so push delivery never races an uncommitted row.
  const { outcome, toNotify } = result;
  if (outcome.skipped) return outcome;
  for (const { row, reason } of toNotify) {
    if (!severityAtLeast(row.severity, settings.notifyMinSeverity)) continue;
    await notifyRecommendation(deps, deps.db, row, loaded.project, `${reason}:${row.severity}`);
  }
  if (outcome.opened || outcome.closed || outcome.updated) {
    deps.events.publish({ type: "intelligence.updated", organizationId, projectId, entityType: "project", entityId: projectId, internal: true, payload: { opened: outcome.opened, closed: outcome.closed, updated: outcome.updated } });
  }
  return outcome;
}

/**
 * Notify the people responsible: the assignee (if any) and the project
 * manager; critical items also reach admins. The dedupe key makes a retry or
 * re-evaluation a no-op.
 */
export async function notifyRecommendation(
  deps: Deps,
  db: DbOrTx,
  row: RecRow,
  project: { name: string; projectManagerId: string | null },
  dedupeSuffix: string,
  extraRoles: ("admin" | "project_manager")[] = [],
) {
  const recipients = new Set<string>();
  if (row.assigneeId) recipients.add(row.assigneeId);
  if (project.projectManagerId) recipients.add(project.projectManagerId);
  if (row.responsibleRole === "field_supervisor") {
    const sups = await db
      .select({ userId: projectMembers.userId })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, row.projectId), eq(projectMembers.role, "field_supervisor")));
    for (const s of sups) recipients.add(s.userId);
  }
  const roles = new Set<string>(extraRoles);
  if (row.severity === "critical") roles.add("admin");
  if (roles.size) {
    const extra = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.organizationId, row.organizationId), inArray(users.role, [...roles] as ("admin" | "project_manager")[]), eq(users.isActive, true)));
    for (const u of extra) recipients.add(u.id);
  }
  // No recipients when nobody owns the project yet: fall back to admins.
  if (!recipients.size) {
    const admins = await db.select({ id: users.id }).from(users).where(and(eq(users.organizationId, row.organizationId), eq(users.role, "admin"), eq(users.isActive, true)));
    for (const a of admins) recipients.add(a.id);
  }
  await notify(
    deps,
    {
      organizationId: row.organizationId,
      userIds: [...recipients],
      type: "intelligence_alert",
      projectId: row.projectId,
      title: `${row.severity === "critical" ? "Critical" : row.severity === "high" ? "Action needed" : "Heads up"}: ${project.name}`,
      body: row.title,
      data: { recommendationId: row.id, severity: row.severity },
      dedupeKey: `intel:${row.id}:${dedupeSuffix}`,
    },
    db,
  );
}

export const SEVERITY_ORDER: Severity[] = [...SEVERITIES];
