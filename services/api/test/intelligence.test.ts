import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { addCalendarDays, todayISO } from "@pool/core";
import { agentRuns, communicationDrafts, intelligenceRecommendations, messages, notifications } from "@pool/database";
import { AgentProviderError, type AgentProvider, type AskRequest, type BriefingRequest, type DraftRequest } from "../src/adapters/agents/types";
import { api, createTestApp, login, USERS, type TestApp } from "./helpers";

/*
 * Project intelligence against a real database: authorization, event
 * triggers, recommendation lifecycle, idempotency, tenancy, and the safety
 * checks applied to agent output (with a scripted fake agent provider —
 * no network, no real LLM).
 */

const TZ = "America/Phoenix";
const today = todayISO(TZ);
const day = (n: number) => addCalendarDays(today, n);

type Api = ReturnType<typeof api>;

/** Scripted agent provider: records calls; each kind returns the next queued response. */
class FakeAgents implements AgentProvider {
  readonly id = "crewai" as const;
  calls: { kind: string; req: unknown }[] = [];
  ask: AgentProvider["ask"] = async (req: AskRequest) => {
    this.calls.push({ kind: "ask", req });
    return this.next("ask", req) as never;
  };
  briefing: AgentProvider["briefing"] = async (req: BriefingRequest) => {
    this.calls.push({ kind: "briefing", req });
    return this.next("briefing", req) as never;
  };
  draft: AgentProvider["draft"] = async (req: DraftRequest) => {
    this.calls.push({ kind: "draft", req });
    return this.next("draft", req) as never;
  };
  responders: Record<"ask" | "briefing" | "draft", ((req: never) => unknown)[]> = { ask: [], briefing: [], draft: [] };
  private next(kind: "ask" | "briefing" | "draft", req: unknown) {
    const fn = this.responders[kind].shift();
    if (!fn) throw new AgentProviderError("no scripted response", false);
    return fn(req as never);
  }
}

async function newProject(pm: Api, name: string, startOffset = 1) {
  const crew = (await pm.get("/teams")).body.data.find((x: { name: string }) => x.name === "Crew A");
  const res = await pm.post("/projects", {
    crewTeamId: crew.id,
    name,
    type: "new_construction",
    status: "construction",
    contractAmountCents: 90_000_00,
    estimatedCostCents: 60_000_00,
    plannedStartDate: day(startOffset),
    client: { firstName: "Robin", lastName: "Ames", email: `${name.replace(/\W/g, "").toLowerCase()}@example.test` },
    property: { address: { line1: "1 Test Way", city: "Mesa", region: "AZ", postalCode: "85201", country: "US" } },
  });
  expect(res.status).toBe(201);
  return res.body.data as { id: string; stages: { id: string; key: string }[] };
}

/** Stage status follows its tasks: finish (or start) a stage by completing (or starting) its tasks. */
async function setStage(pm: Api, projectId: string, stageId: string, state: "completed" | "in_progress") {
  const tasks = (await pm.get(`/tasks?projectId=${projectId}&limit=200`)).body.data as { id: string; stageId: string }[];
  for (const task of tasks.filter((x) => x.stageId === stageId)) {
    const res =
      state === "completed"
        ? await pm.post(`/tasks/${task.id}/complete`, { override: true, overrideReason: "Test setup" })
        : await pm.patch(`/tasks/${task.id}`, { status: "in_progress" });
    expect(res.status).toBe(200);
  }
}

const recsFor = async (t: TestApp, projectId: string) =>
  t.container.deps.db.select().from(intelligenceRecommendations).where(eq(intelligenceRecommendations.projectId, projectId));

describe("project intelligence (rules only)", () => {
  let t: TestApp;
  let pm: Api;
  let admin: Api;
  let client: Api;
  let worker: Api;
  let project: Awaited<ReturnType<typeof newProject>>;
  let superId: string;

  beforeAll(async () => {
    t = await createTestApp();
    pm = api(t.app, await login(t.app, USERS.pm));
    admin = api(t.app, await login(t.app, USERS.admin));
    client = api(t.app, await login(t.app, USERS.client));
    worker = api(t.app, await login(t.app, USERS.worker));
    superId = (await pm.get("/users?role=field_supervisor")).body.data[0].id;
    project = await newProject(pm, "Intelligence Test Pool");
    await t.jobs.drain();
  });
  afterAll(async () => t.close());

  it("returns a briefing, readiness and evidence-linked recommendations", async () => {
    const res = await pm.get(`/projects/${project.id}/intelligence`);
    expect(res.status).toBe(200);
    const intel = res.body.data;
    expect(intel.agentProvider).toBe("none");
    expect(intel.briefing.source).toBe("rules");
    expect(intel.readiness.nextMilestone).toBeTruthy();
    expect(["ready", "at_risk", "blocked"]).toContain(intel.readiness.nextMilestone.label);
    expect(intel.recommendations.length).toBeGreaterThan(0);
    // Every piece of evidence points at a real record in this project.
    const db = t.container.deps.db;
    for (const r of intel.recommendations) {
      expect(r.projectId).toBe(project.id);
      expect(r.evidence.length).toBeGreaterThan(0);
      for (const e of r.evidence) {
        const table = { task: "tasks", stage: "project_stages", project: "projects", checklist_item: "checklist_items", dependency: "task_dependencies", inspection: "inspections", approval: "approvals", material: "material_usage", document: "documents", change_order: "change_orders", weather_alert: "weather_alerts" }[e.type as string];
        expect(table, e.type).toBeTruthy();
        const found = await db.execute(sql`select 1 from ${sql.identifier(table!)} where id = ${e.id}`);
        expect(found.rows.length, `${e.type} ${e.id}`).toBe(1);
      }
    }
  });

  it("doesn't raise gate alerts for work beyond the lookahead", async () => {
    const recs = await recsFor(t, project.id);
    expect(recs.some((r) => r.ruleKey === "readiness.permit_gate")).toBe(false);
  });

  it("blocks excavation while the permit isn't issued (scenario 1)", async () => {
    const other = await newProject(pm, "Permit Pending Pool");
    for (const key of ["contract", "design"]) await setStage(pm, other.id, other.stages.find((s) => s.key === key)!.id, "completed");
    await setStage(pm, other.id, other.stages.find((s) => s.key === "permits")!.id, "in_progress");
    await t.jobs.drain();
    const intel = (await pm.get(`/projects/${other.id}/intelligence`)).body.data;
    expect(intel.readiness.nextMilestone.stageKey).toBe("excavation");
    expect(intel.readiness.nextMilestone.label).toBe("blocked");
    expect(intel.readiness.nextMilestone.score).toBeLessThanOrEqual(40);
    const permit = intel.recommendations.find((r: { ruleKey: string }) => r.ruleKey === "readiness.permit_gate");
    expect(permit).toBeTruthy();
    expect(permit.evidence.some((e: { type: string }) => e.type === "stage")).toBe(true);
  });

  it("enforces capability and row-level access", async () => {
    const whitfield = (await pm.get("/projects?q=Whitfield")).body.data[0];
    // The homeowner can see their project, but not its intelligence.
    expect((await client.get(`/projects/${whitfield.id}`)).status).toBe(200);
    expect((await client.get(`/projects/${whitfield.id}/intelligence`)).status).toBe(403);
    // …and someone else's project doesn't exist for them.
    expect((await client.get(`/projects/${project.id}/intelligence`)).status).toBe(404);
    expect((await worker.get(`/projects/${whitfield.id}/intelligence`)).status).toBe(403);
    expect((await client.get("/recommendations")).status).toBe(403);
    const rec = (await recsFor(t, project.id))[0]!;
    expect((await client.post(`/recommendations/${rec.id}/acknowledge`)).status).toBe(403);
    expect((await client.get("/intelligence/portfolio")).status).toBe(403);
    expect((await pm.patch("/intelligence/settings", { lookaheadDays: 21 })).status).toBe(403);
  });

  it("isolates tenants: another company sees nothing and gets 404s", async () => {
    const reg = await t.app.inject({ method: "POST", url: "/auth/register", payload: { organizationName: "Other Pools", fullName: "Olive Other", email: "olive@other.test", password: "Secret12345" } });
    expect(reg.statusCode).toBe(201);
    const other = api(t.app, reg.json().data.tokens.accessToken);
    const list = await other.get("/recommendations");
    expect(list.status).toBe(200);
    expect(list.body.data).toEqual([]);
    const rec = (await recsFor(t, project.id))[0]!;
    expect((await other.get(`/recommendations/${rec.id}`)).status).toBe(404);
    expect((await other.get(`/projects/${project.id}/intelligence`)).status).toBe(404);
    expect((await other.post(`/recommendations/${rec.id}/dismiss`, { reason: "other", note: "x" })).status).toBe(404);
  });

  it("re-evaluates on events and auto-resolves when the condition clears", async () => {
    const task = await pm.post(`/projects/${project.id}/tasks`, { title: "Locate irrigation lines", plannedStartDate: day(1), durationDays: 1 });
    expect(task.status).toBe(201);
    await t.jobs.drain();
    const rec = (await recsFor(t, project.id)).find((r) => r.dedupeKey === `schedule.unassigned:${task.body.data.id}`);
    expect(rec?.status).toBe("open");
    expect(rec?.severity).toBe("high");

    expect((await pm.patch(`/tasks/${task.body.data.id}`, { assigneeId: superId })).status).toBe(200);
    await t.jobs.drain();
    const after = (await recsFor(t, project.id)).find((r) => r.id === rec!.id)!;
    expect(after.status).toBe("resolved");
    expect(after.resolvedBy).toBeNull();
    const detail = (await pm.get(`/recommendations/${rec!.id}`)).body.data;
    expect(detail.history[0].action).toBe("auto_resolved");
    expect(detail.history[0].automationPolicy).toMatch(/^rules:/);
    expect(detail.history.at(-1).action).toBe("detected");
  });

  it("requires a reason to dismiss, then suppresses the item until its evidence changes", async () => {
    const task = await pm.post(`/projects/${project.id}/tasks`, { title: "Order spa cover", plannedStartDate: day(1), durationDays: 1 });
    await t.jobs.drain();
    const rec = (await recsFor(t, project.id)).find((r) => r.dedupeKey === `schedule.unassigned:${task.body.data.id}`)!;
    expect((await pm.post(`/recommendations/${rec.id}/dismiss`, { reason: "already_handled" })).status).toBe(400);
    const dismissed = await pm.post(`/recommendations/${rec.id}/dismiss`, { reason: "already_handled", note: "Office is handling it" });
    expect(dismissed.status).toBe(200);
    expect(dismissed.body.data.status).toBe("dismissed");

    expect((await pm.post(`/projects/${project.id}/intelligence/analyze`)).status).toBe(200);
    const rows = (await recsFor(t, project.id)).filter((r) => r.dedupeKey === rec.dedupeKey);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("dismissed");

    // New evidence (the start moves into the critical window) reopens it.
    await pm.patch(`/tasks/${task.body.data.id}`, { plannedStartDate: day(0), plannedEndDate: day(0) });
    await t.jobs.drain();
    await pm.post(`/projects/${project.id}/intelligence/analyze`);
    const reopened = (await recsFor(t, project.id)).find((r) => r.id === rec.id)!;
    expect(reopened.status).toBe("open");
  });

  it("supports acknowledge, assign, snooze, resolve and reopen with history", async () => {
    const rec = (await recsFor(t, project.id)).find((r) => r.status === "open")!;
    expect((await pm.post(`/recommendations/${rec.id}/acknowledge`)).body.data.status).toBe("acknowledged");
    const assigned = await pm.post(`/recommendations/${rec.id}/assign`, { assigneeId: superId });
    expect(assigned.body.data.assigneeName).toBeTruthy();
    const clientId = (await admin.get("/users?role=client")).body.data[0].id;
    expect((await pm.post(`/recommendations/${rec.id}/assign`, { assigneeId: clientId })).status).toBe(400);
    const snoozed = await pm.post(`/recommendations/${rec.id}/snooze`, { days: 3 });
    expect(snoozed.body.data.status).toBe("snoozed");
    expect((await pm.post(`/recommendations/${rec.id}/resolve`, { note: "Done" })).body.data.status).toBe("resolved");
    expect((await pm.post(`/recommendations/${rec.id}/resolve`)).status).toBe(409);
    const reopened = await pm.post(`/recommendations/${rec.id}/reopen`);
    expect(reopened.body.data.status).toBe("open");
    const actions = (await pm.get(`/recommendations/${rec.id}`)).body.data.history.map((h: { action: string; actorId: string | null }) => h.action);
    expect(actions.slice(0, 5)).toEqual(["reopened", "resolved", "snoozed", "assigned", "acknowledged"]);
  });

  it("never duplicates notifications across repeated evaluations", async () => {
    const db = t.container.deps.db;
    const countAlerts = async () => (await db.select({ id: notifications.id }).from(notifications).where(and(eq(notifications.type, "intelligence_alert"), eq(notifications.projectId, project.id)))).length;
    await pm.post(`/projects/${project.id}/intelligence/analyze`);
    await t.jobs.drain();
    const before = await countAlerts();
    expect(before).toBeGreaterThan(0);
    await pm.post(`/projects/${project.id}/intelligence/analyze`);
    await pm.post(`/projects/${project.id}/intelligence/analyze`);
    await t.jobs.drain();
    expect(await countAlerts()).toBe(before);
  });

  it("flags a late equipment delivery from the material delivery fields (scenario 3)", async () => {
    const material = (await pm.get("/materials")).body.data[0];
    const tasks = (await pm.get(`/tasks?projectId=${project.id}&limit=100`)).body.data as { id: string; plannedStartDate: string | null; status: string }[];
    const target = tasks.filter((x) => x.plannedStartDate && x.status === "todo").sort((a, b) => a.plannedStartDate!.localeCompare(b.plannedStartDate!))[2]!;
    const usage = await pm.post(`/projects/${project.id}/materials`, {
      materialId: material.id,
      taskId: target.id,
      quantityPlanned: 1,
      status: "ordered",
      orderedAt: today,
      expectedDeliveryDate: addCalendarDays(target.plannedStartDate!, 5),
      deliveryConfirmedAt: new Date().toISOString(),
    });
    expect(usage.status).toBe(201);
    await t.jobs.drain();
    const rec = (await recsFor(t, project.id)).find((r) => r.dedupeKey === `procurement.late_delivery:${usage.body.data.id}`);
    expect(rec?.status).toBe("open");
    expect(["high", "critical"]).toContain(rec?.severity);
    expect(rec?.proposedAction).toEqual({ type: "draft_message", audience: "supplier", kind: "delivery_follow_up" });
  });

  it("approves a proposed action exactly once, even when approved concurrently", async () => {
    const approval = await pm.post(`/projects/${project.id}/approvals`, { subjectType: "design", title: "Waterline tile selection", dueDate: day(-2) });
    expect(approval.status).toBe(201);
    await t.jobs.drain();
    const rec = (await recsFor(t, project.id)).find((r) => r.dedupeKey === `communication.decision_overdue:${approval.body.data.id}`)!;
    expect(rec.severity).toBe("high");
    const [a, b] = await Promise.all([pm.post(`/recommendations/${rec.id}/approve`), pm.post(`/recommendations/${rec.id}/approve`)]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.data.actionResult).toEqual(b.body.data.actionResult);
    expect(a.body.data.actionResult.entityType).toBe("communication_draft");
    const linked = await t.container.deps.db.select().from(communicationDrafts).where(and(eq(communicationDrafts.recommendationId, rec.id), eq(communicationDrafts.id, a.body.data.actionResult.entityId)));
    expect(linked).toHaveLength(1);
    expect(linked[0]!.facts.some((f) => f.id === approval.body.data.id)).toBe(true);
    // A third approval is a no-op.
    expect((await pm.post(`/recommendations/${rec.id}/approve`)).body.data.actionResult).toEqual(a.body.data.actionResult);
    // Field supervisors can't approve.
    const sup = api(t.app, await login(t.app, USERS.super));
    expect((await sup.post(`/recommendations/${rec.id}/approve`)).status).toBe(403);
  });

  it("drafts homeowner messages from verified facts and posts them once on approval", async () => {
    const created = await pm.post(`/projects/${project.id}/communications`, { audience: "homeowner", kind: "weekly_update" });
    expect(created.status).toBe(201);
    const draft = created.body.data;
    expect(draft.source).toBe("template");
    expect(draft.status).toBe("draft");
    expect(draft.facts.length).toBeGreaterThan(0);
    expect(draft.body).not.toMatch(/\$\s?\d/);

    const edited = await pm.patch(`/communications/${draft.id}`, { body: `${draft.body}\n\nP.S. The gate code is unchanged.`, version: draft.version });
    expect(edited.body.data.version).toBe(draft.version + 1);
    expect((await pm.post(`/communications/${draft.id}/approve`, { version: draft.version })).status).toBe(409);

    const approved = await pm.post(`/communications/${draft.id}/approve`, { version: draft.version + 1 });
    expect(approved.status).toBe(200);
    expect(approved.body.data.status).toBe("posted");
    const again = await pm.post(`/communications/${draft.id}/approve`, { version: draft.version + 1 });
    expect(again.body.data.postedMessageId).toBe(approved.body.data.postedMessageId);
    const posted = await t.container.deps.db.select().from(messages).where(eq(messages.id, approved.body.data.postedMessageId));
    expect(posted).toHaveLength(1);
    expect(posted[0]!.visibility).toBe("client");
    expect(posted[0]!.body).toContain("gate code");
    expect((await pm.patch(`/communications/${draft.id}`, { body: "late edit", version: draft.version + 1 })).status).toBe(409);
  });

  it("lists recommendations with filters and pagination", async () => {
    const all = await pm.get(`/recommendations?projectId=${project.id}&status=active&limit=2`);
    expect(all.status).toBe(200);
    expect(all.body.data.length).toBeLessThanOrEqual(2);
    if (all.body.meta?.nextCursor) {
      const next = await pm.get(`/recommendations?projectId=${project.id}&status=active&limit=2&cursor=${all.body.meta.nextCursor}`);
      expect(next.body.data[0].id).not.toBe(all.body.data[0].id);
    }
    const high = await pm.get(`/recommendations?severity=critical,high`);
    expect(high.body.data.every((r: { severity: string }) => r.severity === "critical" || r.severity === "high")).toBe(true);
    expect((await pm.get(`/recommendations?severity=urgent`)).status).toBe(422);
  });

  it("builds the portfolio view across accessible projects", async () => {
    const res = await pm.get("/intelligence/portfolio");
    expect(res.status).toBe(200);
    const row = res.body.data.projects.find((p: { projectId: string }) => p.projectId === project.id);
    expect(row).toBeTruthy();
    expect(res.body.data.totals.activeProjects).toBeGreaterThan(0);
  });

  it("lets admins tune thresholds", async () => {
    const res = await admin.patch("/intelligence/settings", { lookaheadDays: 21, notifyMinSeverity: "critical" });
    expect(res.status).toBe(200);
    expect(res.body.data.settings.lookaheadDays).toBe(21);
    expect(res.body.data.settings.criticalWindowDays).toBe(2);
    expect((await admin.patch("/intelligence/settings", { lookaheadDays: 1 })).status).toBe(422);
    await admin.patch("/intelligence/settings", { lookaheadDays: 14, notifyMinSeverity: "high" });
  });
});

describe("project intelligence with an agent provider", () => {
  let t: TestApp;
  let pm: Api;
  let project: Awaited<ReturnType<typeof newProject>>;
  const fake = new FakeAgents();

  beforeAll(async () => {
    t = await createTestApp({ agents: fake });
    pm = api(t.app, await login(t.app, USERS.pm));
    project = await newProject(pm, "Agent Test Pool", 2);
    // Contract and design done, permits still open: excavation is next and blocked.
    for (const key of ["contract", "design"]) await setStage(pm, project.id, project.stages.find((s) => s.key === key)!.id, "completed");
    await setStage(pm, project.id, project.stages.find((s) => s.key === "permits")!.id, "in_progress");
    await t.jobs.drain();
  });
  afterAll(async () => t.close());

  it("keeps only valid citations and rejects disallowed actions (scenarios 10 & 11)", async () => {
    fake.responders.ask.push((req: AskRequest) => ({
      answer: "Excavation can't start until the permit is issued. Confirm permit status with the city today.",
      citations: [
        { type: "stage", id: req.records.find((r) => r.type === "stage")!.id },
        { type: "task", id: "00000000-0000-4000-8000-000000000000" },
        { type: "invoice", id: "x" },
      ],
      proposed_actions: [{ type: "approve_change_order", id: "co" }, { type: "draft_message", audience: "homeowner", kind: "weekly_update" }],
      model: "fake-model",
      usage: { input_tokens: 1200, output_tokens: 90 },
    }));
    const res = await pm.post(`/projects/${project.id}/intelligence/ask`, { question: "Are we ready for excavation?" });
    expect(res.status).toBe(200);
    const answer = res.body.data;
    expect(answer.source).toBe("agent");
    expect(answer.citations).toHaveLength(1);
    expect(answer.citations[0].type).toBe("stage");
    expect(answer.warnings.join(" ")).toMatch(/Dropped 2 citations/);
    expect(answer.warnings.join(" ")).toMatch(/approve_change_order/);
    const [run] = await t.container.deps.db.select().from(agentRuns).where(eq(agentRuns.id, answer.runId));
    expect(run!.status).toBe("succeeded");
    expect(run!.inputTokens).toBe(1200);
    expect(run!.output).not.toHaveProperty("proposed_actions");

    // The agent got no costs or prices.
    const sent = JSON.stringify(fake.calls.at(-1)!.req);
    expect(sent).not.toMatch(/9000000|contractAmount|estimatedCost|priceCents|costCents/);
  });

  it("reuses the stored result for an identical question on unchanged data (idempotency)", async () => {
    const callsBefore = fake.calls.length;
    const res = await pm.post(`/projects/${project.id}/intelligence/ask`, { question: "Are we ready for excavation?" });
    expect(res.body.data.source).toBe("agent");
    expect(fake.calls.length).toBe(callsBefore);
  });

  it("rejects an answer that contradicts the deterministic readiness and falls back to the records", async () => {
    fake.responders.ask.push(() => ({ answer: "Great news: Excavation is ready to go this week.", citations: [], model: "fake-model" }));
    const res = await pm.post(`/projects/${project.id}/intelligence/ask`, { question: "Can we dig this week?" });
    expect(res.status).toBe(200);
    expect(res.body.data.source).toBe("rules");
    expect(res.body.data.answer).toMatch(/Excavation is not ready/);
    expect(res.body.data.warnings[0]).toMatch(/wasn't used/);
    const rejected = await t.container.deps.db.select().from(agentRuns).where(and(eq(agentRuns.projectId, project.id), eq(agentRuns.status, "rejected")));
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.validationIssues[0]).toMatch(/blocked/);
  });

  it("falls back safely when the agent service fails, without touching project data", async () => {
    const before = (await recsFor(t, project.id)).map((r) => [r.id, r.status, r.severity]);
    fake.responders.ask.push(() => {
      throw new AgentProviderError("The agent service timed out", false, "timeout");
    });
    const res = await pm.post(`/projects/${project.id}/intelligence/ask`, { question: "What should happen next?" });
    expect(res.status).toBe(200);
    expect(res.body.data.source).toBe("rules");
    expect(res.body.data.citations.length).toBeGreaterThan(0);
    const failed = await t.container.deps.db.select().from(agentRuns).where(and(eq(agentRuns.projectId, project.id), eq(agentRuns.status, "failed")));
    expect(failed).toHaveLength(1);
    expect(failed[0]!.error).toBe("The agent service timed out");
    expect((await recsFor(t, project.id)).map((r) => [r.id, r.status, r.severity])).toEqual(before);
  });

  it("generates the agent briefing in the background and attaches it", async () => {
    fake.responders.briefing.push((req: BriefingRequest) => ({
      narrative: "Excavation is blocked until the permit is issued; confirm it with the city today. Everything else is on track.",
      priorities: [{ text: "Confirm the permit", recommendation_id: req.findings[0]?.id ?? null, citations: [{ type: "stage", id: req.records.find((r) => r.type === "stage")!.id }] }],
      citations: [],
      model: "fake-model",
    }));
    const res = await pm.post(`/projects/${project.id}/intelligence/analyze`);
    expect(res.status).toBe(200);
    expect(res.body.data.briefingQueued).toBe(true);
    await t.jobs.drain();
    const intel = (await pm.get(`/projects/${project.id}/intelligence`)).body.data;
    expect(intel.agentProvider).toBe("crewai");
    expect(intel.briefing.source).toBe("agent");
    expect(intel.briefing.narrative).toMatch(/permit/);
    expect(intel.briefing.narrativeStale).toBe(false);
  });

  it("flags unsupported claims in agent-written drafts and keeps them as drafts", async () => {
    fake.responders.draft.push((req: DraftRequest) => ({
      subject: "Your pool this week",
      body: `Hi Robin, excavation starts soon. Your pool will be finished ${day(30)} and the upgrade is $4,500.`,
      claims: [
        { text: "Excavation starts soon", fact_ids: [req.draft.facts[0]!.id] },
        { text: `Finished ${day(30)}`, fact_ids: [] },
      ],
      model: "fake-model",
    }));
    const res = await pm.post(`/projects/${project.id}/communications`, { audience: "homeowner", kind: "weekly_update" });
    expect(res.status).toBe(201);
    const draft = res.body.data;
    expect(draft.source).toBe("agent");
    expect(draft.status).toBe("draft");
    expect(draft.unsupportedClaims).toEqual(expect.arrayContaining([`Finished ${day(30)}`, '"$4,500" doesn\'t appear in the project records']));
    // Homeowner drafts never receive internal records or findings.
    const req = fake.calls.at(-1)!.req as DraftRequest;
    expect(req.records).toEqual([]);
    expect(req.findings).toEqual([]);
  });
});
