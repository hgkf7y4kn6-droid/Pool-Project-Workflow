import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { totpCode } from "../src/lib/totp";
import { api, createTestApp, login, USERS, type TestApp } from "./helpers";

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => t.close());

describe("authentication", () => {
  it("logs in with email/password and returns the session user", async () => {
    const res = await t.app.inject({ method: "POST", url: "/auth/login", payload: { email: "PM@BlueLagoon.test", password: "PoolDemo2026!" } });
    expect(res.statusCode).toBe(200);
    const body = res.json().data;
    expect(body.mfaRequired).toBe(false);
    expect(body.user).toMatchObject({ email: USERS.pm, role: "project_manager" });
    expect(body.tokens.accessToken).toBeTruthy();
    expect(body.tokens.refreshToken).toBeTruthy();
  });

  it("rejects bad credentials with a uniform error", async () => {
    const wrong = await t.app.inject({ method: "POST", url: "/auth/login", payload: { email: USERS.pm, password: "nope-nope-1" } });
    const unknown = await t.app.inject({ method: "POST", url: "/auth/login", payload: { email: "ghost@x.test", password: "nope-nope-1" } });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json().error.message).toBe(unknown.json().error.message);
  });

  it("validates input and reports field errors", async () => {
    const res = await t.app.inject({ method: "POST", url: "/auth/login", payload: { email: "not-an-email" } });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("validation_failed");
    expect(res.json().error.details).toHaveProperty("email");
  });

  it("requires a bearer token on protected routes", async () => {
    const res = await t.app.inject({ method: "GET", url: "/projects" });
    expect(res.statusCode).toBe(401);
    const bad = await t.app.inject({ method: "GET", url: "/projects", headers: { authorization: "Bearer garbage" } });
    expect(bad.statusCode).toBe(401);
  });

  it("rotates refresh tokens and revokes the session on reuse", async () => {
    const res = await t.app.inject({ method: "POST", url: "/auth/login", payload: { email: USERS.worker, password: "PoolDemo2026!" } });
    const first = res.json().data.tokens.refreshToken;
    const r1 = await t.app.inject({ method: "POST", url: "/auth/refresh", payload: { refreshToken: first } });
    expect(r1.statusCode).toBe(200);
    const second = r1.json().data.refreshToken;
    expect(second).not.toBe(first);
    // Replaying the old token is treated as theft: the whole session dies.
    const replay = await t.app.inject({ method: "POST", url: "/auth/refresh", payload: { refreshToken: first } });
    expect(replay.statusCode).toBe(401);
    const afterReuse = await t.app.inject({ method: "POST", url: "/auth/refresh", payload: { refreshToken: second } });
    expect(afterReuse.statusCode).toBe(401);
  });

  it("registers a new organization with default templates", async () => {
    const res = await t.app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { organizationName: "Aqua Builders", fullName: "Kim Owner", email: "owner@aqua.test", password: "Secret12345" },
    });
    expect(res.statusCode).toBe(201);
    const token = res.json().data.tokens.accessToken;
    const templates = await api(t.app, token).get("/stage-templates");
    expect(templates.body.data).toHaveLength(17);
    // Tenancy isolation: the new org cannot see the demo org's projects.
    const projects = await api(t.app, token).get("/projects");
    expect(projects.body.data).toHaveLength(0);
  });

  it("supports password reset by emailed token", async () => {
    await t.app.inject({ method: "POST", url: "/auth/password/forgot", payload: { email: USERS.worker2 } });
    const mail = t.mailer.outbox.at(-1)!;
    expect(mail.to).toBe(USERS.worker2);
    const token = decodeURIComponent(/token=([^\s]+)/.exec(mail.text)![1]!);
    const reset = await t.app.inject({ method: "POST", url: "/auth/password/reset", payload: { token, password: "NewPassword99" } });
    expect(reset.statusCode).toBe(200);
    await login(t.app, USERS.worker2, "NewPassword99");
    const reuse = await t.app.inject({ method: "POST", url: "/auth/password/reset", payload: { token, password: "Another12345" } });
    expect(reuse.statusCode).toBe(401);
  });

  it("enrolls TOTP MFA and requires it at login", async () => {
    const token = await login(t.app, USERS.designer);
    const setup = await api(t.app, token).post("/auth/mfa/setup");
    const secret = setup.body.data.secret as string;
    expect(setup.body.data.otpauthUrl).toContain("otpauth://totp/");
    expect((await api(t.app, token).post("/auth/mfa/confirm", { code: "000000" })).status).toBe(400);
    expect((await api(t.app, token).post("/auth/mfa/confirm", { code: totpCode(secret) })).status).toBe(200);

    const step1 = await t.app.inject({ method: "POST", url: "/auth/login", payload: { email: USERS.designer, password: "PoolDemo2026!" } });
    expect(step1.json().data).toMatchObject({ mfaRequired: true });
    const ticket = step1.json().data.mfaTicket;
    const bad = await t.app.inject({ method: "POST", url: "/auth/mfa/verify", payload: { ticket, code: "123456" } });
    expect(bad.statusCode).toBe(401);
    const step1b = await t.app.inject({ method: "POST", url: "/auth/login", payload: { email: USERS.designer, password: "PoolDemo2026!" } });
    const ok = await t.app.inject({ method: "POST", url: "/auth/mfa/verify", payload: { ticket: step1b.json().data.mfaTicket, code: totpCode(secret) } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data.tokens.accessToken).toBeTruthy();
  });
});
