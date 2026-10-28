import type { FastifyInstance } from "fastify";
import {
  communicationApproveSchema,
  communicationDraftCreateSchema,
  communicationDraftUpdateSchema,
  communicationRejectSchema,
  intelligenceAskSchema,
  intelligenceSettingsSchema,
  recommendationAssignSchema,
  recommendationDismissSchema,
  recommendationListQuery,
  recommendationNoteSchema,
  recommendationSnoozeSchema,
  z,
} from "@pool/validation";
import type { Deps } from "../context";
import { ok } from "../lib/http";
import { parse } from "../lib/validate";
import { authenticated } from "../plugins/auth";
import * as drafts from "../services/intelligence/drafts";
import * as recs from "../services/intelligence/recommendations";
import * as intel from "../services/intelligence/service";

const id = z.object({ id: z.guid() });
const projectParam = z.object({ projectId: z.guid() });

/** Project intelligence: briefings, readiness, recommendations, communications. See docs/intelligence.md. */
export function intelligenceRoutes(app: FastifyInstance, deps: Deps) {
  authenticated(app, deps, (s) => {
    s.get("/projects/:projectId/intelligence", async (req) => ok(await intel.getProjectIntelligence(req.ctx, parse(projectParam, req.params).projectId)));
    s.post("/projects/:projectId/intelligence/analyze", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) =>
      ok(await intel.analyzeProject(req.ctx, parse(projectParam, req.params).projectId)),
    );
    s.post("/projects/:projectId/intelligence/ask", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req) =>
      ok(await intel.askIntelligence(req.ctx, parse(projectParam, req.params).projectId, parse(intelligenceAskSchema, req.body).question)),
    );

    s.get("/recommendations", async (req) => {
      const { items, nextCursor } = await recs.listRecommendations(req.ctx, parse(recommendationListQuery, req.query));
      return ok(items, { nextCursor });
    });
    s.get("/recommendations/:id", async (req) => ok(await recs.getRecommendation(req.ctx, parse(id, req.params).id)));
    s.post("/recommendations/:id/acknowledge", async (req) => ok(await recs.acknowledgeRecommendation(req.ctx, parse(id, req.params).id, parse(recommendationNoteSchema, req.body ?? {}))));
    s.post("/recommendations/:id/start", async (req) => ok(await recs.startRecommendation(req.ctx, parse(id, req.params).id, parse(recommendationNoteSchema, req.body ?? {}))));
    s.post("/recommendations/:id/assign", async (req) => ok(await recs.assignRecommendation(req.ctx, parse(id, req.params).id, parse(recommendationAssignSchema, req.body))));
    s.post("/recommendations/:id/snooze", async (req) => ok(await recs.snoozeRecommendation(req.ctx, parse(id, req.params).id, parse(recommendationSnoozeSchema, req.body))));
    s.post("/recommendations/:id/dismiss", async (req) => ok(await recs.dismissRecommendation(req.ctx, parse(id, req.params).id, parse(recommendationDismissSchema, req.body))));
    s.post("/recommendations/:id/resolve", async (req) => ok(await recs.resolveRecommendation(req.ctx, parse(id, req.params).id, parse(recommendationNoteSchema, req.body ?? {}))));
    s.post("/recommendations/:id/reopen", async (req) => ok(await recs.reopenRecommendation(req.ctx, parse(id, req.params).id, parse(recommendationNoteSchema, req.body ?? {}))));
    s.post("/recommendations/:id/approve", async (req) =>
      ok(await recs.approveRecommendation(req.ctx, parse(id, req.params).id, (ctx, projectId, input) => drafts.createDraft(ctx, projectId, parse(communicationDraftCreateSchema, input)))),
    );

    s.get("/projects/:projectId/communications", async (req) => ok(await drafts.listDrafts(req.ctx, parse(projectParam, req.params).projectId)));
    s.post("/projects/:projectId/communications", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) =>
      reply.code(201).send(ok(await drafts.createDraft(req.ctx, parse(projectParam, req.params).projectId, parse(communicationDraftCreateSchema, req.body)))),
    );
    s.get("/communications/:id", async (req) => ok(await drafts.getDraft(req.ctx, parse(id, req.params).id)));
    s.patch("/communications/:id", async (req) => ok(await drafts.updateDraft(req.ctx, parse(id, req.params).id, parse(communicationDraftUpdateSchema, req.body))));
    s.post("/communications/:id/approve", async (req) => ok(await drafts.approveDraft(req.ctx, parse(id, req.params).id, parse(communicationApproveSchema, req.body))));
    s.post("/communications/:id/reject", async (req) => ok(await drafts.rejectDraft(req.ctx, parse(id, req.params).id, parse(communicationRejectSchema, req.body))));

    s.get("/intelligence/portfolio", async (req) => ok(await intel.portfolioOverview(req.ctx)));
    s.get("/intelligence/settings", async (req) => ok(await intel.getIntelligenceSettings(req.ctx)));
    s.patch("/intelligence/settings", async (req) => ok(await intel.updateIntelligenceSettings(req.ctx, parse(intelligenceSettingsSchema, req.body))));
    s.get("/intelligence/runs", async (req) => {
      const q = parse(z.object({ projectId: z.guid().optional(), cursor: z.string().max(200).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }), req.query);
      const { items, nextCursor, usage30d } = await intel.listAgentRuns(req.ctx, q);
      return ok({ items, usage30d }, { nextCursor });
    });
  });
}
