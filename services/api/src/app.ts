import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import type { ApiErrorBody } from "@pool/types";
import type { Deps } from "./context";
import { AppError } from "./lib/errors";
import { ok } from "./lib/http";
import { authRoutes } from "./routes/auth";
import { generalRoutes } from "./routes/general";
import { projectRoutes } from "./routes/projects";
import { realtimeRoutes } from "./routes/realtime";
import { localStorageRoutes } from "./routes/storage";

export async function buildApp(deps: Deps): Promise<FastifyInstance> {
  const app = Fastify({
    loggerInstance: deps.log as unknown as FastifyBaseLogger,
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024,
    genReqId: () => crypto.randomUUID(),
  });

  await app.register(helmet, { contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: "cross-origin" } });
  await app.register(cors, {
    origin: deps.env.CORS_ORIGINS.split(",").map((o) => o.trim()),
    credentials: false,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"],
  });
  await app.register(rateLimit, {
    max: deps.env.RATE_LIMIT_MAX,
    timeWindow: "1 minute",
    // Authenticated traffic is limited per user, anonymous per IP.
    keyGenerator: (req) => {
      const auth = req.headers.authorization;
      return auth ? `tok:${auth.slice(-24)}` : `ip:${req.ip}`;
    },
    errorResponseBuilder: (_req, context) => ({
      statusCode: 429,
      error: { code: "rate_limited", message: `Too many requests. Try again in ${Math.ceil(context.ttl / 1000)}s.` },
    }),
  });
  await app.register(websocket);

  app.setErrorHandler((rawError, request, reply) => {
    const error = rawError as Error & { statusCode?: number };
    const requestId = request.id;
    if (error instanceof AppError) {
      const body: ApiErrorBody & { error: { extra?: unknown } } = {
        error: { code: error.code, message: error.message, details: error.details, requestId, ...(error.extra ? { extra: error.extra } : {}) },
      };
      return reply.code(error.statusCode).send(body);
    }
    const status = error.statusCode;
    if (status === 429) return reply.code(429).send({ error: { code: "rate_limited", message: error.message, requestId } });
    if (status && status >= 400 && status < 500) {
      return reply.code(status).send({ error: { code: "bad_request", message: error.message, requestId } });
    }
    request.log.error({ err: error }, "unhandled error");
    return reply.code(500).send({ error: { code: "internal_error", message: "Something went wrong", requestId } });
  });
  app.setNotFoundHandler((request, reply) =>
    reply.code(404).send({ error: { code: "not_found", message: `Route ${request.method} ${request.url} not found`, requestId: request.id } }),
  );

  app.get("/health", { config: { rateLimit: false } }, async () => ok({ status: "ok", time: new Date().toISOString() }));
  app.get("/health/ready", { config: { rateLimit: false } }, async (_req, reply) => {
    try {
      await deps.db.execute(sql`select 1`);
      return ok({ status: "ready" });
    } catch {
      return reply.code(503).send({ error: { code: "service_unavailable", message: "Database unavailable" } });
    }
  });

  authRoutes(app, deps);
  projectRoutes(app, deps);
  generalRoutes(app, deps);
  realtimeRoutes(app, deps);
  localStorageRoutes(app, deps);
  return app;
}
