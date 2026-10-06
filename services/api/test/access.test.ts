import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, createTestApp, login, USERS, type TestApp } from "./helpers";

let t: TestApp;
let pm: ReturnType<typeof api>;
let whitfieldId: string;

beforeAll(async () => {
  t = await createTestApp();
  pm = api(t.app, await login(t.app, USERS.pm));
  const list = await pm.get("/projects?q=Whitfield");
  whitfieldId = list.body.data[0].id;
});
afterAll(async () => t.close());

describe("role-based and row-level access", () => {
  it("shows the PM all of their projects with internal financials", async () => {
    const res = await pm.get("/projects");
    expect(res.body.data.map((p: { name: string }) => p.name)).toEqual(
      expect.arrayContaining(["Whitfield Backyard Oasis", "Ortiz Pool Renovation", "Shah Spa Addition", "Becker Equipment Upgrade", "Garcia Lap Pool"]),
    );
    expect(res.body.data[0]).toHaveProperty("estimatedCostCents");
    const budget = await pm.get(`/projects/${whitfieldId}/budget`);
    expect(budget.status).toBe(200);
    expect(budget.body.data.summary.contractAmountCents).toBe(96_500_00);
  });

  it("limits clients to their own project and redacts internal data", async () => {
    const client = api(t.app, await login(t.app, USERS.client));
    const res = await client.get("/projects");
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe(whitfieldId);
    expect(res.body.data[0]).not.toHaveProperty("estimatedCostCents");
    expect((await client.get(`/projects/${whitfieldId}/budget`)).status).toBe(403);
    expect((await client.get(`/projects/${whitfieldId}/expenses`)).status).toBe(403);
    // Internal messages never reach the client.
    const msgs = await client.get(`/projects/${whitfieldId}/messages`);
    expect(msgs.body.data.every((m: { visibility: string }) => m.visibility === "client")).toBe(true);
    // Change orders: no internal cost.
    const cos = await client.get(`/projects/${whitfieldId}/change-orders`);
    expect(cos.body.data.length).toBeGreaterThan(0);
    expect(cos.body.data[0]).not.toHaveProperty("costCents");
    // Other projects look like they do not exist.
    const others = await pm.get("/projects?q=Ortiz");
    expect((await client.get(`/projects/${others.body.data[0].id}`)).status).toBe(404);
  });

  it("restricts subcontractors to tasks assigned to them", async () => {
    const sub = api(t.app, await login(t.app, USERS.sub));
    const tasks = await sub.get(`/tasks?projectId=${whitfieldId}`);
    expect(tasks.body.data.length).toBeGreaterThan(0);
    expect(tasks.body.data.every((x: { title: string }) => ["Tile", "Coping"].includes(x.title))).toBe(true);
    expect((await sub.get(`/projects/${whitfieldId}/budget`)).status).toBe(403);
  });

  it("prevents field workers from management actions", async () => {
    const worker = api(t.app, await login(t.app, USERS.worker));
    const create = await worker.post("/projects", { name: "x", type: "repair", clientId: crypto.randomUUID(), propertyId: crypto.randomUUID() });
    expect(create.status).toBe(403);
    expect((await worker.get(`/projects/${whitfieldId}/budget`)).status).toBe(403);
    const schedule = await worker.get(`/projects/${whitfieldId}/schedule`);
    expect(schedule.status).toBe(200);
  });

  it("isolates organizations completely", async () => {
    const res = await t.app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { organizationName: "Other Co", fullName: "Other Admin", email: "admin@other.test", password: "Secret12345" },
    });
    const other = api(t.app, res.json().data.tokens.accessToken);
    expect((await other.get(`/projects/${whitfieldId}`)).status).toBe(404);
    expect((await other.get(`/projects/${whitfieldId}/schedule`)).status).toBe(404);
  });
});
