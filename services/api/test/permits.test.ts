import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { addCalendarDays, todayISO } from "@pool/core";
import { activityLogs, intelligenceRecommendations } from "@pool/database";
import { api, createTestApp, login, USERS, type TestApp } from "./helpers";

/*
 * Permits against a real database: CRUD, date rules, references that must
 * stay inside the project, capability and tenancy checks, and the permit
 * gate in project intelligence reading the permit records.
 */

const TZ = "America/Phoenix";
const today = todayISO(TZ);
const day = (n: number) => addCalendarDays(today, n);

type Api = ReturnType<typeof api>;
type Project = { id: string; stages: { id: string; key: string }[] };

let t: TestApp;
let pm: Api;
let worker: Api;
let client: Api;
let sub: Api;
let project: Project;
let whitfieldId: string;

async function newProject(name: string): Promise<Project> {
  const crew = (await pm.get("/teams")).body.data.find((x: { name: string }) => x.name === "Crew A");
  const res = await pm.post("/projects", {
    crewTeamId: crew.id,
    name,
    type: "new_construction",
    status: "construction",
    contractAmountCents: 90_000_00,
    estimatedCostCents: 60_000_00,
    plannedStartDate: day(1),
    client: { firstName: "Perry", lastName: "Mitt", email: `${name.replace(/\W/g, "").toLowerCase()}@example.test` },
    property: { address: { line1: "9 Permit Ln", city: "Mesa", region: "AZ", postalCode: "85201", country: "US" } },
  });
  expect(res.status).toBe(201);
  return res.body.data;
}

beforeAll(async () => {
  t = await createTestApp();
  pm = api(t.app, await login(t.app, USERS.pm));
  worker = api(t.app, await login(t.app, USERS.worker));
  client = api(t.app, await login(t.app, USERS.client));
  sub = api(t.app, await login(t.app, USERS.sub));
  whitfieldId = (await pm.get("/projects?q=Whitfield")).body.data[0].id;
  project = await newProject("Permit CRUD Pool");
});
afterAll(async () => t.close());

describe("permits", () => {
  let permitId: string;

  it("creates a permit and stamps the date that goes with its status", async () => {
    const stageId = project.stages.find((s) => s.key === "permits")!.id;
    const res = await pm.post(`/projects/${project.id}/permits`, { stageId, permitType: "building", jurisdiction: "City of Mesa", status: "submitted" });
    expect(res.status).toBe(201);
    const p = res.body.data;
    permitId = p.id;
    expect(p).toMatchObject({ projectId: project.id, stageId, status: "submitted", effectiveStatus: "submitted", submittedOn: today, issuedOn: null, version: 1 });
    expect(p).not.toHaveProperty("changeSeq");

    const activity = await t.container.deps.db.select().from(activityLogs).where(and(eq(activityLogs.entityId, permitId), eq(activityLogs.action, "permit.recorded")));
    expect(activity).toHaveLength(1);
    expect(activity[0]!.clientVisible).toBe(false);
  });

  it("accepts a client-generated id", async () => {
    const id = crypto.randomUUID();
    const res = await pm.post(`/projects/${project.id}/permits`, { id, permitType: "electrical", jurisdiction: "City of Mesa" });
    expect(res.status).toBe(201);
    expect(res.body.data.id).toBe(id);
    expect(res.body.data.status).toBe("draft");
    expect((await pm.del(`/permits/${id}`)).status).toBe(200);
  });

  it("updates status, records the change and reports expiry", async () => {
    const res = await pm.patch(`/permits/${permitId}`, { status: "issued", permitNumber: "BP-77", submittedOn: day(-40), issuedOn: day(-30), expiresOn: day(-1) });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: "issued", effectiveStatus: "expired", permitNumber: "BP-77", submittedOn: day(-40), version: 2 });
    const changed = await t.container.deps.db.select().from(activityLogs).where(and(eq(activityLogs.entityId, permitId), eq(activityLogs.action, "permit.status_changed")));
    expect(changed[0]!.metadata).toEqual({ from: "submitted", to: "issued" });
  });

  it("rejects bad input", async () => {
    // Dates are checked against the stored ones: issued before submitted, expiring before issued.
    const early = await pm.patch(`/permits/${permitId}`, { issuedOn: day(-60) });
    expect(early.status).toBe(400);
    expect(early.body.error.message).toMatch(/before the submitted date/);
    expect((await pm.patch(`/permits/${permitId}`, { expiresOn: day(-31) })).status).toBe(400);
    expect((await pm.patch(`/permits/${permitId}`, { finaledOn: day(1) })).status).toBe(400);
    expect((await pm.post(`/projects/${project.id}/permits`, { permitType: "Building Permit", jurisdiction: "Mesa" })).status).toBe(422);
    expect((await pm.post(`/projects/${project.id}/permits`, { permitType: "building", jurisdiction: "Mesa", issuedOn: "06/01/2026" })).status).toBe(422);
  });

  it("only links stages and documents from the same project", async () => {
    const whitfield = (await pm.get(`/projects/${whitfieldId}`)).body.data;
    const foreignStage = whitfield.stages[0].id;
    const res = await pm.patch(`/permits/${permitId}`, { stageId: foreignStage });
    expect(res.status).toBe(400);
    expect(res.body.error.details).toHaveProperty("stageId");
    expect((await pm.patch(`/permits/${permitId}`, { documentId: crypto.randomUUID() })).status).toBe(400);
  });

  it("lets field staff read but not manage, and keeps permits from clients and subcontractors", async () => {
    const created = await pm.post(`/projects/${whitfieldId}/permits`, { permitType: "pool_barrier", jurisdiction: "City of Scottsdale", status: "issued" });
    expect(created.status).toBe(201);
    const list = await worker.get(`/projects/${whitfieldId}/permits`);
    expect(list.status).toBe(200);
    expect(list.body.data.map((p: { id: string }) => p.id)).toContain(created.body.data.id);
    expect((await worker.post(`/projects/${whitfieldId}/permits`, { permitType: "building", jurisdiction: "x" })).status).toBe(403);
    expect((await worker.patch(`/permits/${created.body.data.id}`, { status: "finaled" })).status).toBe(403);
    expect((await client.get(`/projects/${whitfieldId}/permits`)).status).toBe(403);
    expect((await client.get(`/permits/${created.body.data.id}`)).status).toBe(403);
    expect((await sub.get(`/projects/${whitfieldId}/permits`)).status).toBe(403);
    // A project the client can't see doesn't exist for them.
    expect((await client.get(`/projects/${project.id}/permits`)).status).toBe(404);
    expect((await client.get(`/permits/${permitId}`)).status).toBe(404);
  });

  it("isolates tenants", async () => {
    const reg = await t.app.inject({ method: "POST", url: "/auth/register", payload: { organizationName: "Permit Rivals", fullName: "Rita Rival", email: "rita@rival.test", password: "Secret12345" } });
    expect(reg.statusCode).toBe(201);
    const other = api(t.app, reg.json().data.tokens.accessToken);
    expect((await other.get(`/permits/${permitId}`)).status).toBe(404);
    expect((await other.patch(`/permits/${permitId}`, { status: "withdrawn" })).status).toBe(404);
    expect((await other.del(`/permits/${permitId}`)).status).toBe(404);
    expect((await other.get(`/projects/${project.id}/permits`)).status).toBe(404);
    expect((await other.post(`/projects/${project.id}/permits`, { permitType: "building", jurisdiction: "x" })).status).toBe(404);
  });

  it("soft-deletes", async () => {
    const created = await pm.post(`/projects/${project.id}/permits`, { permitType: "grading", jurisdiction: "City of Mesa" });
    expect((await pm.del(`/permits/${created.body.data.id}`)).status).toBe(200);
    expect((await pm.get(`/permits/${created.body.data.id}`)).status).toBe(404);
    const ids = (await pm.get(`/projects/${project.id}/permits`)).body.data.map((p: { id: string }) => p.id);
    expect(ids).toEqual([permitId]);
  });
});

describe("permit gate in project intelligence", () => {
  it("blocks on a pending permit record and auto-resolves once it's issued", async () => {
    const p = await newProject("Permit Gate Pool");
    // Complete every stage before excavation, including the permits stage: the
    // permit record alone must hold the gate closed.
    const tasks = (await pm.get(`/tasks?projectId=${p.id}&limit=200`)).body.data as { id: string; stageId: string }[];
    for (const key of ["contract", "design", "permits"]) {
      const stageId = p.stages.find((s) => s.key === key)!.id;
      for (const task of tasks.filter((x) => x.stageId === stageId)) {
        expect((await pm.post(`/tasks/${task.id}/complete`, { override: true, overrideReason: "Test setup" })).status).toBe(200);
      }
    }
    const permit = (await pm.post(`/projects/${p.id}/permits`, { permitType: "building", jurisdiction: "City of Mesa", status: "submitted" })).body.data;
    await t.jobs.drain();

    let intel = (await pm.get(`/projects/${p.id}/intelligence`)).body.data;
    expect(intel.readiness.nextMilestone.stageKey).toBe("excavation");
    expect(intel.readiness.nextMilestone.label).toBe("blocked");
    const factor = intel.readiness.nextMilestone.factors.find((f: { key: string }) => f.key === "permits");
    expect(factor.items[0].evidence).toMatchObject({ type: "permit", id: permit.id });
    const gate = intel.recommendations.find((r: { ruleKey: string; stageId: string }) => r.ruleKey === "readiness.permit_gate" && r.stageId === p.stages.find((s) => s.key === "excavation")!.id);
    expect(gate).toBeTruthy();
    expect(gate.evidence.map((e: { type: string; id: string }) => `${e.type}:${e.id}`)).toContain(`permit:${permit.id}`);

    expect((await pm.patch(`/permits/${permit.id}`, { status: "issued", expiresOn: day(180) })).status).toBe(200);
    await t.jobs.drain();
    const [after] = await t.container.deps.db.select().from(intelligenceRecommendations).where(eq(intelligenceRecommendations.id, gate.id));
    expect(after!.status).toBe("resolved");
    intel = (await pm.get(`/projects/${p.id}/intelligence`)).body.data;
    expect(intel.readiness.nextMilestone.factors.find((f: { key: string }) => f.key === "permits").state).toBe("ready");
  });
});
