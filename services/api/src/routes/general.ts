import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { savedViews } from "@pool/database";
import { ROLES } from "@pool/types";
import {
  clientSchema,
  documentCreateSchema,
  documentListQuery,
  documentUpdateSchema,
  documentVersionSchema,
  inspectionTemplateSchema,
  inviteUserSchema,
  materialSchema,
  notificationPreferenceSchema,
  paginationQuery,
  propertySchema,
  pushTokenSchema,
  reportQuery,
  searchQuery,
  stageTemplateSchema,
  syncPullSchema,
  syncPushSchema,
  teamSchema,
  updateClientSchema,
  updateOrganizationSchema,
  updatePropertySchema,
  updateUserSchema,
  vendorSchema,
  z,
} from "@pool/validation";
import type { Deps } from "../context";
import { notFound } from "../lib/errors";
import { ok } from "../lib/http";
import { parse } from "../lib/validate";
import { authenticated } from "../plugins/auth";
import { accessibleProjectIds } from "../services/access";
import * as budget from "../services/budget";
import * as clients from "../services/clients";
import { acknowledgeWeatherAlert, companyDashboard } from "../services/dashboard";
import * as documents from "../services/documents";
import * as inspections from "../services/inspections";
import { inbox } from "../services/messages";
import * as notifications from "../services/notifications";
import * as org from "../services/organization";
import { portfolioReport, reportToCsv, reportToPdf, reportToXlsx } from "../services/reports";
import { globalSearch } from "../services/search";
import { pullChanges, pushOperations } from "../services/sync";
import { LIMITS } from "@pool/config";

const id = z.object({ id: z.guid() });

export function generalRoutes(app: FastifyInstance, deps: Deps) {
  authenticated(app, deps, (s) => {
    // --- Organization, users, teams, roles -----------------------------------
    s.get("/organizations/current", async (req) => ok(await org.getOrganization(req.ctx)));
    s.patch("/organizations/current", async (req) => ok(await org.updateOrganization(req.ctx, parse(updateOrganizationSchema, req.body))));
    s.get("/users", async (req) => {
      const q = parse(z.object({ role: z.enum(ROLES).optional(), includeInactive: z.coerce.boolean().optional() }), req.query);
      return ok(await org.listUsers(req.ctx, q));
    });
    s.post("/users/invite", async (req, reply) => reply.code(201).send(ok(await org.inviteUser(req.ctx, parse(inviteUserSchema, req.body)))));
    s.patch("/users/:id", async (req) =>
      ok(await org.updateUser(req.ctx, parse(id, req.params).id, parse(updateUserSchema.extend({ defaultHourlyCostCents: z.number().int().min(0).optional() }), req.body))),
    );
    s.get("/teams", async (req) => ok(await org.listTeams(req.ctx)));
    s.post("/teams", async (req, reply) => reply.code(201).send(ok(await org.upsertTeam(req.ctx, parse(teamSchema, req.body)))));
    s.put("/teams/:id", async (req) => ok(await org.upsertTeam(req.ctx, parse(teamSchema, req.body), parse(id, req.params).id)));
    s.get("/roles", async (req) => ok(await org.rolesMatrix(req.ctx)));
    s.put("/roles/:role/permissions", async (req) => {
      const { role } = parse(z.object({ role: z.enum(ROLES) }), req.params);
      const { changes } = parse(z.object({ changes: z.array(z.object({ permission: z.string().max(60), granted: z.boolean().nullable() })).max(100) }), req.body);
      return ok(await org.setRolePermissions(req.ctx, role, changes));
    });
    s.get("/stage-templates", async (req) => ok(await org.listStageTemplates(req.ctx)));
    s.post("/stage-templates", async (req, reply) => reply.code(201).send(ok(await org.upsertStageTemplate(req.ctx, parse(stageTemplateSchema, req.body)))));
    s.put("/stage-templates/:id", async (req) => ok(await org.upsertStageTemplate(req.ctx, parse(stageTemplateSchema, req.body), parse(id, req.params).id)));
    s.delete("/stage-templates/:id", async (req) => {
      await org.deactivateStageTemplate(req.ctx, parse(id, req.params).id);
      return ok({ deactivated: true });
    });
    s.get("/inspection-templates", async (req) => ok(await inspections.listInspectionTemplates(req.ctx)));
    s.post("/inspection-templates", async (req, reply) =>
      reply.code(201).send(ok(await inspections.upsertInspectionTemplate(req.ctx, parse(inspectionTemplateSchema, req.body)))),
    );
    s.put("/inspection-templates/:id", async (req) =>
      ok(await inspections.upsertInspectionTemplate(req.ctx, parse(inspectionTemplateSchema, req.body), parse(id, req.params).id)),
    );
    s.get("/integrations", async (req) => ok(await org.listIntegrations(req.ctx)));

    // --- Clients & properties ------------------------------------------------
    s.get("/clients", async (req) => {
      const q = parse(paginationQuery.extend({ q: z.string().max(200).optional() }), req.query);
      const { items, nextCursor } = await clients.listClients(req.ctx, q);
      return ok(items, { nextCursor });
    });
    s.post("/clients", async (req, reply) => reply.code(201).send(ok(await clients.createClient(req.ctx, parse(clientSchema, req.body)))));
    s.get("/clients/:id", async (req) => ok(await clients.getClient(req.ctx, parse(id, req.params).id)));
    s.patch("/clients/:id", async (req) => ok(await clients.updateClient(req.ctx, parse(id, req.params).id, parse(updateClientSchema, req.body))));
    s.post("/properties", async (req, reply) => reply.code(201).send(ok(await clients.createProperty(req.ctx, parse(propertySchema, req.body)))));
    s.get("/properties/:id", async (req) => ok(await clients.getProperty(req.ctx, parse(id, req.params).id)));
    s.patch("/properties/:id", async (req) => ok(await clients.updateProperty(req.ctx, parse(id, req.params).id, parse(updatePropertySchema, req.body))));

    // --- Vendors & materials -----------------------------------------------
    s.get("/vendors", async (req) => ok(await budget.listVendors(req.ctx, parse(z.object({ kind: z.string().max(20).optional() }), req.query).kind)));
    s.post("/vendors", async (req, reply) => reply.code(201).send(ok(await budget.upsertVendor(req.ctx, parse(vendorSchema, req.body)))));
    s.put("/vendors/:id", async (req) => ok(await budget.upsertVendor(req.ctx, parse(vendorSchema, req.body), parse(id, req.params).id)));
    s.get("/materials", async (req) => ok(await budget.listMaterials(req.ctx, parse(z.object({ q: z.string().max(100).optional() }), req.query).q)));
    s.post("/materials", async (req, reply) => reply.code(201).send(ok(await budget.upsertMaterial(req.ctx, parse(materialSchema, req.body)))));
    s.put("/materials/:id", async (req) => ok(await budget.upsertMaterial(req.ctx, parse(materialSchema, req.body), parse(id, req.params).id)));

    // --- Documents -------------------------------------------------------------
    s.get("/documents", async (req) => {
      const { items, nextCursor } = await documents.listDocuments(req.ctx, parse(documentListQuery, req.query));
      return ok(items, { nextCursor });
    });
    s.post("/documents", async (req, reply) => reply.code(201).send(ok(await documents.createDocument(req.ctx, parse(documentCreateSchema, req.body)))));
    s.get("/documents/:id", async (req) => ok(await documents.getDocument(req.ctx, parse(id, req.params).id)));
    s.patch("/documents/:id", async (req) => ok(await documents.updateDocument(req.ctx, parse(id, req.params).id, parse(documentUpdateSchema, req.body))));
    s.delete("/documents/:id", async (req) => {
      await documents.deleteDocument(req.ctx, parse(id, req.params).id);
      return ok({ deleted: true });
    });
    s.post("/documents/:id/versions", async (req, reply) =>
      reply.code(201).send(ok(await documents.addDocumentVersion(req.ctx, parse(id, req.params).id, parse(documentVersionSchema, req.body)))),
    );
    s.post("/documents/:id/versions/:versionId/complete", async (req) => {
      const p = parse(z.object({ id: z.guid(), versionId: z.guid() }), req.params);
      return ok(await documents.completeDocumentUpload(req.ctx, p.id, p.versionId));
    });

    // --- Notifications ---------------------------------------------------------
    s.get("/notifications", async (req) => {
      const q = parse(z.object({ unreadOnly: z.coerce.boolean().optional(), before: z.string().max(40).optional(), limit: z.coerce.number().int().min(1).max(100).default(30) }), req.query);
      const { items, unread, nextBefore } = await notifications.listNotifications(req.ctx, q);
      return ok(items, { unread, nextCursor: nextBefore });
    });
    s.post("/notifications/read", async (req) => {
      const b = parse(z.object({ ids: z.union([z.array(z.guid()).max(500), z.literal("all")]) }), req.body);
      await notifications.markRead(req.ctx, b.ids);
      return ok({ read: true });
    });
    s.get("/notifications/preferences", async (req) => ok(await notifications.getPreferences(req.ctx)));
    s.put("/notifications/preferences", async (req) => ok(await notifications.setPreferences(req.ctx, parse(notificationPreferenceSchema, req.body))));
    s.post("/push-tokens", async (req, reply) => {
      await notifications.registerPushToken(req.ctx, parse(pushTokenSchema, req.body));
      return reply.code(204).send();
    });
    s.delete("/push-tokens/:token", async (req, reply) => {
      await notifications.unregisterPushToken(req.ctx, parse(z.object({ token: z.string().max(300) }), req.params).token);
      return reply.code(204).send();
    });

    // --- Dashboard, inbox, search, saved views --------------------------------
    s.get("/dashboard", async (req) => ok(await companyDashboard(req.ctx)));
    s.post("/weather-alerts/:id/acknowledge", async (req) => {
      await acknowledgeWeatherAlert(req.ctx, parse(id, req.params).id);
      return ok({ acknowledged: true });
    });
    s.get("/inbox", async (req) => ok(await inbox(req.ctx, await accessibleProjectIds(req.ctx))));
    s.get("/search", async (req) => ok(await globalSearch(req.ctx, parse(searchQuery, req.query))));
    s.get("/views", async (req) => {
      const { scope } = parse(z.object({ scope: z.enum(["projects", "tasks", "documents", "photos"]) }), req.query);
      return ok(await deps.db.select().from(savedViews).where(and(eq(savedViews.userId, req.ctx.auth.userId), eq(savedViews.scope, scope))));
    });
    s.post("/views", async (req, reply) => {
      const b = parse(
        z.object({ scope: z.enum(["projects", "tasks", "documents", "photos"]), name: z.string().trim().min(1).max(80), filters: z.record(z.string(), z.unknown()) }),
        req.body,
      );
      const [row] = await deps.db.insert(savedViews).values({ ...b, userId: req.ctx.auth.userId }).returning();
      return reply.code(201).send(ok(row));
    });
    s.delete("/views/:id", async (req) => {
      const deleted = await deps.db
        .delete(savedViews)
        .where(and(eq(savedViews.id, parse(id, req.params).id), eq(savedViews.userId, req.ctx.auth.userId)))
        .returning();
      if (!deleted.length) throw notFound("View");
      return ok({ deleted: true });
    });

    // --- Reports -----------------------------------------------------------------
    s.get("/reports/portfolio", async (req, reply) => {
      const q = parse(reportQuery, req.query);
      const report = await portfolioReport(req.ctx, q);
      const stamp = report.range.to;
      if (q.format === "csv") {
        return reply.header("Content-Type", "text/csv").header("Content-Disposition", `attachment; filename="portfolio-${stamp}.csv"`).send(reportToCsv(report));
      }
      if (q.format === "xlsx") {
        return reply
          .header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
          .header("Content-Disposition", `attachment; filename="portfolio-${stamp}.xlsx"`)
          .send(await reportToXlsx(report));
      }
      if (q.format === "pdf") {
        return reply.header("Content-Type", "application/pdf").header("Content-Disposition", `attachment; filename="portfolio-${stamp}.pdf"`).send(await reportToPdf(report));
      }
      return ok(report);
    });

    // --- Offline sync ------------------------------------------------------------
    s.post("/sync/push", { bodyLimit: LIMITS.syncPushBytes }, async (req) => ok({ results: await pushOperations(req.ctx, parse(syncPushSchema, req.body)) }));
    s.post("/sync/pull", async (req) => ok(await pullChanges(req.ctx, parse(syncPullSchema, req.body))));
  });
}
