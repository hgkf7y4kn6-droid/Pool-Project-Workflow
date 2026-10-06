import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Deps } from "../context";
import { AppError } from "../lib/errors";
import { parse } from "../lib/validate";
import { LocalStorage } from "../adapters/storage/local";

/**
 * Development-only endpoints backing LocalStorage's signed URLs. In staging
 * and production files go straight to S3/R2 and these routes do not exist.
 */
export function localStorageRoutes(app: FastifyInstance, deps: Deps) {
  if (!(deps.storage instanceof LocalStorage)) return;
  const storage = deps.storage;
  const query = z.object({ exp: z.coerce.number(), sig: z.string().max(200), name: z.string().max(255).optional() });

  app.register(async (scope) => {
    scope.addContentTypeParser("*", { parseAs: "buffer", bodyLimit: 500 * 1024 * 1024 }, (_req, body, done) => done(null, body));
    scope.put("/storage/local/*", async (req, reply) => {
      const key = decodeURI((req.params as { "*": string })["*"]);
      const q = parse(query, req.query);
      const contentType = String(req.headers["content-type"] ?? "");
      if (!storage.verify("PUT", key, q.exp, q.sig, contentType)) throw new AppError("forbidden", "Invalid or expired upload URL");
      await storage.putObject(key, req.body as Buffer, contentType || "application/octet-stream");
      return reply.code(200).send();
    });
  });
  app.get("/storage/local/*", async (req, reply) => {
    const key = decodeURI((req.params as { "*": string })["*"]);
    const q = parse(query, req.query);
    if (!storage.verify("GET", key, q.exp, q.sig)) throw new AppError("forbidden", "Invalid or expired download URL");
    const head = await storage.head(key);
    if (!head) throw new AppError("not_found", "File not found");
    reply.header("Content-Type", head.contentType ?? "application/octet-stream");
    reply.header("Cache-Control", "private, max-age=300");
    if (q.name) reply.header("Content-Disposition", `inline; filename="${q.name.replace(/"/g, "")}"`);
    return reply.send(await storage.getObject(key));
  });
}
