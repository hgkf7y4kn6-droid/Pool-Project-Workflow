import type { FastifyInstance } from "fastify";
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  magicLinkRequestSchema,
  magicLinkVerifySchema,
  mfaConfirmSchema,
  mfaVerifySchema,
  passwordSchema,
  refreshSchema,
  registerSchema,
  resetPasswordSchema,
  z,
} from "@pool/validation";
import type { Deps } from "../context";
import { ok } from "../lib/http";
import { parse } from "../lib/validate";
import { authenticated, requireLiveSession } from "../plugins/auth";
import * as auth from "../services/auth";

export function authRoutes(app: FastifyInstance, deps: Deps) {
  const meta = (req: { ip: string; headers: Record<string, unknown> }) => ({
    ip: req.ip,
    userAgent: String(req.headers["user-agent"] ?? ""),
    deviceName: req.headers["x-device-name"] ? String(req.headers["x-device-name"]) : undefined,
  });
  // Stricter rate limit on credential endpoints.
  const strict = { config: { rateLimit: { max: deps.env.AUTH_RATE_LIMIT_MAX, timeWindow: "1 minute" } } };

  app.post("/auth/register", strict, async (req, reply) => reply.code(201).send(ok(await auth.register(deps, parse(registerSchema, req.body), meta(req)))));
  app.post("/auth/login", strict, async (req) => ok(await auth.login(deps, parse(loginSchema, req.body), meta(req))));
  app.post("/auth/mfa/verify", strict, async (req) => {
    const b = parse(mfaVerifySchema, req.body);
    return ok(await auth.verifyMfa(deps, b.ticket, b.code, meta(req)));
  });
  app.post("/auth/refresh", strict, async (req) => ok(await auth.refresh(deps, parse(refreshSchema, req.body).refreshToken)));
  app.post("/auth/password/forgot", strict, async (req, reply) => {
    await auth.forgotPassword(deps, parse(forgotPasswordSchema, req.body).email);
    return reply.code(202).send(ok({ sent: true }));
  });
  app.post("/auth/password/reset", strict, async (req) => {
    const b = parse(resetPasswordSchema, req.body);
    await auth.resetPassword(deps, b.token, b.password);
    return ok({ reset: true });
  });
  app.post("/auth/magic-link", strict, async (req, reply) => {
    await auth.requestMagicLink(deps, parse(magicLinkRequestSchema, req.body).email);
    return reply.code(202).send(ok({ sent: true }));
  });
  app.post("/auth/magic-link/verify", strict, async (req) => ok(await auth.verifyMagicLink(deps, parse(magicLinkVerifySchema, req.body).token, meta(req))));
  app.post("/auth/invite/accept", strict, async (req) => {
    const b = parse(z.object({ token: z.string().min(20), password: passwordSchema }), req.body);
    return ok(await auth.acceptInvite(deps, b.token, b.password, meta(req)));
  });
  app.post("/auth/oauth/:provider", strict, async (req) => {
    const { provider } = parse(z.object({ provider: z.enum(["google", "apple"]) }), req.params);
    const { idToken } = parse(z.object({ idToken: z.string().min(20).max(5000) }), req.body);
    return ok(await auth.oauthLogin(deps, provider, idToken, meta(req)));
  });
  app.get("/auth/providers", async () => ok({ oauth: deps.oauth.enabledProviders(), magicLink: true, mfa: true }));

  authenticated(app, deps, (s) => {
    s.get("/auth/me", async (req) => ok(await auth.me(req.ctx)));
    s.post("/auth/logout", async (req) => {
      await auth.logout(req.ctx);
      return ok({ loggedOut: true });
    });
    s.post("/auth/password/change", async (req) => {
      await requireLiveSession(req.ctx);
      const b = parse(changePasswordSchema, req.body);
      await auth.changePassword(req.ctx, b.currentPassword, b.newPassword);
      return ok({ changed: true });
    });
    s.get("/auth/sessions", async (req) => ok(await auth.listSessions(req.ctx)));
    s.delete("/auth/sessions/:id", async (req) => {
      await auth.revokeSession(req.ctx, parse(z.object({ id: z.guid() }), req.params).id);
      return ok({ revoked: true });
    });
    s.post("/auth/mfa/setup", async (req) => {
      await requireLiveSession(req.ctx);
      return ok(await auth.mfaSetup(req.ctx));
    });
    s.post("/auth/mfa/confirm", async (req) => {
      await auth.mfaConfirm(req.ctx, parse(mfaConfirmSchema, req.body).code, true);
      return ok({ mfaEnabled: true });
    });
    s.post("/auth/mfa/disable", async (req) => {
      await requireLiveSession(req.ctx);
      await auth.mfaConfirm(req.ctx, parse(mfaConfirmSchema, req.body).code, false);
      return ok({ mfaEnabled: false });
    });
  });
}
