import type { FastifyInstance } from "fastify";
import type { Deps, Ctx } from "../context";
import { accessibleProjectIds, isInternal } from "../services/access";
import { authenticate } from "../plugins/auth";
import type { RealtimeEvent } from "../adapters/realtime";

/**
 * WebSocket endpoint: GET /realtime?token=<access token>.
 * Pushes change hints (task updated, new message, notification…) to users
 * who can see the project. Clients re-fetch or run a sync on receipt; basic
 * field work never depends on this connection.
 */
export function realtimeRoutes(app: FastifyInstance, deps: Deps) {
  app.get("/realtime", { websocket: true }, async (socket, req) => {
    let ctx: Ctx;
    try {
      const token = (req.query as { token?: string }).token;
      if (token) req.headers.authorization = `Bearer ${token}`;
      ctx = await authenticate(deps, req);
    } catch {
      socket.close(4401, "unauthorized");
      return;
    }
    let visible = new Set(await accessibleProjectIds(ctx));
    const refresh = setInterval(async () => {
      visible = new Set(await accessibleProjectIds(ctx).catch(() => [...visible]));
    }, 60_000);
    const internal = isInternal(ctx);

    const unsubscribe = deps.events.subscribe((event: RealtimeEvent) => {
      if (event.organizationId !== ctx.auth.organizationId) return;
      if (event.userIds && !event.userIds.includes(ctx.auth.userId)) return;
      if (event.internal && !internal) return;
      if (event.projectId && !visible.has(event.projectId)) {
        // A newly created project the user just gained access to.
        if (event.type !== "project.created") return;
      }
      socket.send(JSON.stringify(event));
    });
    const ping = setInterval(() => socket.ping(), 25_000);
    socket.send(JSON.stringify({ type: "ready", at: new Date().toISOString() }));
    socket.on("close", () => {
      unsubscribe();
      clearInterval(ping);
      clearInterval(refresh);
    });
  });
}
