import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { evaluateProject, resolveIntelligenceSettings, sanitizeForPrompt, unsupportedClaims, type IntelligenceSnapshot } from "@pool/core";
import { communicationDrafts, intelligenceRecommendations, users } from "@pool/database";
import {
  COMMUNICATION_KIND_LABELS,
  type CommunicationAudience,
  type CommunicationDraft,
  type CommunicationFact,
  type CommunicationKind,
} from "@pool/types";
import type { communicationApproveSchema, communicationDraftCreateSchema, communicationDraftUpdateSchema, communicationRejectSchema, z } from "@pool/validation";
import type { Ctx } from "../../context";
import { badRequest, conflict, notFound, AppError } from "../../lib/errors";
import { AgentProviderError, draftResponseSchema } from "../../adapters/agents/types";
import { loadProject, requirePermission } from "../access";
import { recordActivity } from "../activity";
import { sendMessage } from "../messages";
import { activeRecommendations, requestBase, runAgent } from "./agents";
import { loadSnapshot, type LoadedProject } from "./snapshot";

type DraftRow = typeof communicationDrafts.$inferSelect;

function toDraft(r: DraftRow, createdByName: string | null): CommunicationDraft {
  return {
    id: r.id,
    projectId: r.projectId,
    audience: r.audience,
    kind: r.kind,
    subject: r.subject,
    body: r.body,
    status: r.status,
    source: r.source,
    facts: r.facts,
    unsupportedClaims: r.unsupportedClaims,
    recommendationId: r.recommendationId,
    agentRunId: r.agentRunId,
    postedMessageId: r.postedMessageId,
    createdBy: r.createdBy,
    createdByName,
    approvedBy: r.approvedBy,
    approvedAt: r.approvedAt,
    rejectionReason: r.rejectionReason,
    version: r.version,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

/**
 * Verified facts a message may state, scoped to its audience. Homeowners only
 * hear about client-visible stages, decisions and change orders addressed to
 * them; suppliers only about the material in question; nobody gets costs.
 */
export function buildFacts(snap: IntelligenceSnapshot, audience: CommunicationAudience, kind: CommunicationKind, subject?: { type: string; id: string } | null): CommunicationFact[] {
  const facts: CommunicationFact[] = [];
  const p = snap.project;
  const add = (type: CommunicationFact["type"], id: string, text: string) => facts.push({ type, id, text: sanitizeForPrompt(text, 300) });
  const stages = snap.stages.filter((s) => audience !== "homeowner" || s.clientVisible).sort((a, b) => a.sortOrder - b.sortOrder);
  const stageStart = (s: (typeof stages)[number]) => s.plannedStartDate ?? snap.tasks.filter((t) => t.stageId === s.id && t.plannedStartDate).map((t) => t.plannedStartDate!).sort()[0] ?? null;

  if (audience === "homeowner" || audience === "internal") {
    add("project", p.id, `Project ${p.name}${p.projectedCompletionDate ? `, projected completion ${p.projectedCompletionDate}` : p.plannedCompletionDate ? `, planned completion ${p.plannedCompletionDate}` : ""}.`);
    if (p.plannedCompletionDate && p.projectedCompletionDate && p.projectedCompletionDate !== p.plannedCompletionDate) add("project", p.id, `Completion was planned for ${p.plannedCompletionDate} and is now projected for ${p.projectedCompletionDate}.`);
    const recent = stages.filter((s) => s.status === "completed" && s.actualEndDate && s.actualEndDate >= addDays(snap.today, -14));
    for (const s of recent) add("stage", s.id, `${s.name} was completed on ${s.actualEndDate}.`);
    for (const s of stages.filter((x) => x.status === "in_progress")) add("stage", s.id, `${s.name} is in progress.`);
    for (const s of stages.filter((x) => x.status === "not_started").slice(0, 2)) {
      const start = stageStart(s);
      add("stage", s.id, start ? `${s.name} is planned to start ${start}.` : `${s.name} is next; its start date isn't set yet.`);
    }
    for (const a of snap.approvals.filter((x) => x.status === "pending")) add("approval", a.id, `Waiting on your decision: ${a.title}${a.dueDate ? ` (requested by ${a.dueDate})` : ""}.`);
    for (const c of snap.changeOrders.filter((x) => x.status === "client_review")) add("change_order", c.id, `Change order #${c.number} "${c.title}" is ready for your review in the client portal${c.scheduleImpactDays ? ` and would add ${c.scheduleImpactDays} days to the schedule` : ""}.`);
    if (kind === "weather_delay" || kind === "schedule_change") for (const w of snap.weatherAlerts) add("weather_alert", w.id, `Forecast for ${w.date}: ${w.summary}.`);
  }
  if (audience === "supplier") {
    const mats = subject?.type === "material" ? snap.materials.filter((m) => m.id === subject.id) : snap.materials.filter((m) => m.status === "ordered" || m.status === "planned");
    for (const m of mats) {
      const task = snap.tasks.find((t) => t.id === m.taskId);
      const need = m.requiredBy ?? task?.plannedStartDate ?? null;
      add("material", m.id, `${m.name} for project ${p.number}: ${m.status}${m.orderedAt ? `, ordered ${m.orderedAt}` : ""}${need ? `, needed on site by ${need}` : ""}${m.expectedDeliveryDate ? `, currently expected ${m.expectedDeliveryDate}` : ""}.`);
    }
  }
  if (audience === "subcontractor" || audience === "internal") {
    const horizon = addDays(snap.today, 21);
    for (const t of snap.tasks.filter((x) => (audience === "internal" || x.subcontractorId) && x.status !== "done" && x.status !== "cancelled" && x.plannedStartDate && x.plannedStartDate <= horizon)) {
      add("task", t.id, `"${t.title}" on project ${p.number} is planned ${t.plannedStartDate} to ${t.plannedEndDate ?? t.plannedStartDate}.`);
    }
  }
  return facts.slice(0, 40);
}

function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Deterministic draft used when no agent is configured (or the agent fails): facts only. */
export function templateDraft(loaded: LoadedProject, audience: CommunicationAudience, kind: CommunicationKind, facts: CommunicationFact[]): { subject: string; body: string } {
  const name = loaded.project.name;
  const greeting = audience === "homeowner" ? `Hi${loaded.project.clientName ? ` ${loaded.project.clientName.split(" ")[0]}` : ""},` : "Hello,";
  const intro: Record<CommunicationKind, string> = {
    weekly_update: `Here's this week's update on ${name}.`,
    upcoming_work: `Here's what's coming up next on ${name}.`,
    schedule_change: `We want to let you know about a change to the schedule for ${name}.`,
    decision_reminder: `A quick reminder about a decision we need from you for ${name}.`,
    change_order_explanation: `Here's a summary of the change order waiting for your review on ${name}.`,
    weather_delay: `The forecast may affect upcoming work on ${name}.`,
    milestone_complete: `Good news: we've reached a milestone on ${name}.`,
    walkthrough: `${name} is nearly ready for the final walkthrough.`,
    delivery_follow_up: `We're following up on materials for project ${loaded.project.number}.`,
    subcontractor_confirmation: `Please confirm the upcoming work on project ${loaded.project.number}.`,
    custom: `An update on ${name}.`,
  };
  const ask: Partial<Record<CommunicationKind, string>> = {
    decision_reminder: "Could you make your selection in the client portal, or reply with any questions?",
    delivery_follow_up: "Could you confirm the delivery date, or let us know if anything has changed?",
    subcontractor_confirmation: "Could you confirm your crew is booked for these dates?",
    change_order_explanation: "You can review and sign it in the client portal; we're happy to walk you through it.",
  };
  const lines = [greeting, "", intro[kind], "", ...facts.map((f) => `• ${f.text}`)];
  if (ask[kind]) lines.push("", ask[kind]!);
  lines.push("", audience === "homeowner" ? "Please reach out with any questions.\n\nYour project team" : "Thank you,\nThe project team");
  return { subject: `${COMMUNICATION_KIND_LABELS[kind]} — ${audience === "homeowner" ? name : loaded.project.number}`, body: lines.join("\n") };
}

async function draftWithName(ctx: Ctx, id: string) {
  const [row] = await ctx.deps.db
    .select({ d: communicationDrafts, name: users.fullName })
    .from(communicationDrafts)
    .leftJoin(users, eq(users.id, communicationDrafts.createdBy))
    .where(and(eq(communicationDrafts.id, id), eq(communicationDrafts.organizationId, ctx.auth.organizationId)));
  if (!row) throw notFound("Draft");
  await loadProject(ctx, row.d.projectId);
  return row;
}

export async function listDrafts(ctx: Ctx, projectId: string) {
  await loadProject(ctx, projectId);
  await requirePermission(ctx, "intelligence:read");
  const rows = await ctx.deps.db
    .select({ d: communicationDrafts, name: users.fullName })
    .from(communicationDrafts)
    .leftJoin(users, eq(users.id, communicationDrafts.createdBy))
    .where(eq(communicationDrafts.projectId, projectId))
    .orderBy(desc(communicationDrafts.createdAt))
    .limit(50);
  return rows.map((r) => toDraft(r.d, r.name));
}

export async function getDraft(ctx: Ctx, id: string) {
  await requirePermission(ctx, "intelligence:read");
  const r = await draftWithName(ctx, id);
  return toDraft(r.d, r.name);
}

/**
 * Create a draft from verified facts. With an agent provider the
 * Communication Specialist writes it and every claim is checked against the
 * facts; otherwise (or if the agent fails) a factual template is used.
 * Drafts never leave the app until a person approves them.
 */
export async function createDraft(ctx: Ctx, projectId: string, input: z.infer<typeof communicationDraftCreateSchema>) {
  await loadProject(ctx, projectId);
  await requirePermission(ctx, "intelligence:manage");
  const loaded = await loadSnapshot(ctx.deps, ctx.auth.organizationId, projectId);
  if (!loaded) throw notFound("Project");
  let subject: { type: string; id: string } | null = null;
  if (input.recommendationId) {
    const [rec] = await ctx.deps.db
      .select({ subjectType: intelligenceRecommendations.subjectType, subjectId: intelligenceRecommendations.subjectId })
      .from(intelligenceRecommendations)
      .where(and(eq(intelligenceRecommendations.id, input.recommendationId), eq(intelligenceRecommendations.projectId, projectId)));
    if (!rec) throw badRequest("Unknown recommendation for this project");
    subject = { type: rec.subjectType, id: rec.subjectId };
  }
  const facts = buildFacts(loaded.snapshot, input.audience, input.kind, subject);
  if (!facts.length) throw badRequest("There are no verified project facts for this kind of message yet");

  let source: DraftRow["source"] = "template";
  let text = templateDraft(loaded, input.audience, input.kind, facts);
  let issues: string[] = [];
  let agentRunId: string | null = null;
  const provider = ctx.deps.agents;
  if (provider) {
    const settings = resolveIntelligenceSettings(loaded.organization.settings);
    const evaluation = evaluateProject(loaded.snapshot, settings, ctx.deps.now().toISOString());
    const recs = await activeRecommendations(ctx.deps, projectId);
    const key = `draft:${projectId}:${input.audience}:${input.kind}:${hashText(JSON.stringify([facts, input.guidance ?? ""]))}`;
    try {
      const run = await runAgent(
        ctx.deps,
        provider,
        { organizationId: ctx.auth.organizationId, projectId, kind: "draft", requestedBy: ctx.auth.userId, idempotencyKey: key, input: { facts, guidance: input.guidance }, dailyLimit: settings.dailyAgentRunLimit },
        (runId) => {
          const base = requestBase(loaded, evaluation, recs, runId);
          return provider.draft({
            ...base,
            // Homeowner and vendor drafts see only the scoped facts, never internal records or findings.
            records: input.audience === "internal" ? base.records : [],
            findings: input.audience === "internal" ? base.findings : [],
            kind: "draft",
            draft: { audience: input.audience, kind: input.kind, guidance: input.guidance ? sanitizeForPrompt(input.guidance, 500) : null, facts },
          });
        },
        (raw) => {
          const res = draftResponseSchema.parse(raw);
          return { output: { subject: res.subject, body: res.body, claims: res.claims }, issues: unsupportedClaims(res.body, res.claims.map((c) => ({ text: c.text, factIds: c.fact_ids })), facts) };
        },
      );
      source = "agent";
      text = { subject: String(run.output.subject), body: String(run.output.body) };
      issues = run.issues;
      agentRunId = run.runId;
    } catch (err) {
      if (!(err instanceof AgentProviderError) && !(err instanceof AppError)) throw err;
      issues = [`AI writer unavailable (${err.message}); this draft uses the factual template.`];
    }
  }
  const [row] = await ctx.deps.db
    .insert(communicationDrafts)
    .values({
      organizationId: ctx.auth.organizationId,
      projectId,
      audience: input.audience,
      kind: input.kind,
      subject: text.subject,
      body: text.body,
      source,
      facts,
      unsupportedClaims: issues,
      recommendationId: input.recommendationId ?? null,
      agentRunId,
      createdBy: ctx.auth.userId,
    })
    .returning();
  return getDraft(ctx, row!.id);
}

function hashText(s: string) {
  return createHash("sha256").update(s).digest("hex").slice(0, 32);
}

export async function updateDraft(ctx: Ctx, id: string, input: z.infer<typeof communicationDraftUpdateSchema>) {
  await requirePermission(ctx, "intelligence:manage");
  const { d } = await draftWithName(ctx, id);
  if (d.status !== "draft") throw conflict(`This message is already ${d.status}`);
  const [row] = await ctx.deps.db
    .update(communicationDrafts)
    .set({
      subject: input.subject ?? d.subject,
      body: input.body ?? d.body,
      // A person's edit replaces the generated text; earlier claim checks no longer apply.
      unsupportedClaims: input.body !== undefined && input.body !== d.body ? [] : d.unsupportedClaims,
      version: d.version + 1,
      updatedBy: ctx.auth.userId,
      updatedAt: ctx.deps.now().toISOString(),
    })
    .where(and(eq(communicationDrafts.id, id), eq(communicationDrafts.version, input.version)))
    .returning();
  if (!row) throw conflict("Someone else changed this draft; reload and try again");
  return getDraft(ctx, id);
}

/**
 * Approve a draft. Homeowner drafts are posted to the client message thread
 * (as the approving user, through the normal messages service); other
 * audiences are approved for the user to send themselves — the app never
 * emails suppliers or subcontractors on its own.
 */
export async function approveDraft(ctx: Ctx, id: string, input: z.infer<typeof communicationApproveSchema>) {
  await requirePermission(ctx, "intelligence:approve");
  const { d } = await draftWithName(ctx, id);
  await ctx.deps.db.transaction(async (tx) => {
    const [row] = await tx.select().from(communicationDrafts).where(eq(communicationDrafts.id, id)).for("update");
    if (row!.status === "approved" || row!.status === "posted") return; // idempotent
    if (row!.status !== "draft") throw conflict(`This message is ${row!.status}`);
    if (row!.version !== input.version) throw conflict("The draft changed since you opened it; review the latest version");
    let postedMessageId: string | null = null;
    if (input.post && row!.audience === "homeowner") {
      const message = await sendMessage(ctx, d.projectId, { threadKey: "client", body: `${row!.subject}\n\n${row!.body}`, visibility: "client", attachments: [] }, tx);
      postedMessageId = message.id;
    }
    await tx
      .update(communicationDrafts)
      .set({ status: postedMessageId ? "posted" : "approved", approvedBy: ctx.auth.userId, approvedAt: ctx.deps.now().toISOString(), postedMessageId, updatedBy: ctx.auth.userId, updatedAt: ctx.deps.now().toISOString() })
      .where(eq(communicationDrafts.id, id));
    await recordActivity(ctx, { projectId: d.projectId, action: "communication.approved", entityType: "communication_draft", entityId: id, summary: `approved a ${COMMUNICATION_KIND_LABELS[row!.kind].toLowerCase()} for the ${row!.audience}${postedMessageId ? " and posted it to the client thread" : ""}`, clientVisible: false }, tx);
  });
  return getDraft(ctx, id);
}

export async function rejectDraft(ctx: Ctx, id: string, input: z.infer<typeof communicationRejectSchema>) {
  await requirePermission(ctx, "intelligence:approve");
  const { d } = await draftWithName(ctx, id);
  if (d.status !== "draft") throw conflict(`This message is already ${d.status}`);
  await ctx.deps.db
    .update(communicationDrafts)
    .set({ status: "rejected", rejectionReason: input.reason, updatedBy: ctx.auth.userId, updatedAt: ctx.deps.now().toISOString() })
    .where(and(eq(communicationDrafts.id, id), eq(communicationDrafts.status, "draft")));
  return getDraft(ctx, id);
}
