import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Ctx, Deps } from "../context";
import { unauthorized } from "../lib/errors";
import { verifyAccessToken } from "../lib/tokens";
import { isSessionActive } from "../services/auth";

declare module "fastify" {
  interface FastifyRequest {
    ctx: Ctx;
  }
}

/** Verify the bearer token and attach the request context. */
export async function authenticate(deps: Deps, request: FastifyRequest): Promise<Ctx> {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) throw unauthorized();
  let claims;
  try {
    claims = await verifyAccessToken(header.slice(7), {
      secret: deps.env.JWT_SECRET,
      issuer: deps.env.JWT_ISSUER,
      accessTtlSeconds: deps.env.ACCESS_TOKEN_TTL_SECONDS,
    });
  } catch {
    throw unauthorized("Session expired");
  }
  return {
    deps,
    auth: { userId: claims.sub, organizationId: claims.org, role: claims.role, clientId: claims.cid, sessionId: claims.sid },
    ip: request.ip,
    requestId: request.id,
  };
}

/** Register an encapsulated scope whose routes all require authentication. */
export function authenticated(app: FastifyInstance, deps: Deps, register: (scope: FastifyInstance) => void) {
  app.register(async (scope) => {
    scope.decorateRequest("ctx", null as unknown as Ctx);
    scope.addHook("onRequest", async (request) => {
      request.ctx = await authenticate(deps, request);
    });
    register(scope);
  });
}

/** For sensitive operations, also confirm the session has not been revoked. */
export async function requireLiveSession(ctx: Ctx): Promise<void> {
  if (!(await isSessionActive(ctx.deps, ctx.auth.sessionId))) throw unauthorized("Session revoked");
}
