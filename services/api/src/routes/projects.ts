import type { FastifyInstance } from "fastify";
import {
  addProjectMemberSchema,
  approvalDecisionSchema,
  approvalRequestSchema,
  budgetItemSchema,
  changeOrderSchema,
  changeOrderTransitionSchema,
  checklistItemInput,
  checklistToggleSchema,
  completeTaskSchema,
  createProjectSchema,
  createTaskSchema,
  dependencySchema,
  designModelSchema,
  designProjectSchema,
  patchOf,
  expenseSchema,
  inspectionSchema,
  isoDate,
  laborEntrySchema,
  materialUsageSchema,
  measurementSchema,
  messageSchema,
  paymentSchema,
  photoCreateSchema,
  photoUpdateSchema,
  projectListQuery,
  scheduleShiftSchema,
  taskListQuery,
  taskNoteSchema,
  updateBudgetSchema,
  updateChangeOrderSchema,
  updateInspectionSchema,
  updateMeasurementSchema,
  updatePaymentSchema,
  updateProjectSchema,
  updateStageSchema,
  updateTaskSchema,
  z,
} from "@pool/validation";
import { PHOTO_KINDS } from "@pool/types";
import type { Deps } from "../context";
import { ok } from "../lib/http";
import { parse } from "../lib/validate";
import { authenticated } from "../plugins/auth";
import { aiAskSchema, askProjectAssistant } from "../services/ai";
import * as approvals from "../services/approvals";
import * as budget from "../services/budget";
import * as changeOrders from "../services/change-orders";
import * as clientsSvc from "../services/clients";
import { projectActivity } from "../services/dashboard";
import * as designs from "../services/designs";
import * as inspections from "../services/inspections";
import * as measurements from "../services/measurements";
import * as messages from "../services/messages";
import * as payments from "../services/payments";
import * as photos from "../services/photos";
import * as projects from "../services/projects";
import * as schedule from "../services/schedule";
import * as tasks from "../services/tasks";
import { projectWeather } from "../services/weather";

const id = z.object({ id: z.guid() });
const projectParam = z.object({ projectId: z.guid() });
const pageQuery = z.object({ before: z.string().max(40).optional(), limit: z.coerce.number().int().min(1).max(200).default(50) });

/** Project-scoped resources: /projects/:projectId/... plus task and change-order endpoints. */
export function projectRoutes(app: FastifyInstance, deps: Deps) {
  authenticated(app, deps, (s) => {
    // --- Projects -----------------------------------------------------------
    s.get("/projects", async (req) => {
      const { items, nextCursor } = await projects.listProjects(req.ctx, parse(projectListQuery, req.query));
      return ok(items, { nextCursor });
    });
    s.post("/projects", async (req, reply) => reply.code(201).send(ok(await projects.createProject(req.ctx, parse(createProjectSchema, req.body)))));
    s.get("/projects/:projectId", async (req) => ok(await projects.getProject(req.ctx, parse(projectParam, req.params).projectId)));
    s.patch("/projects/:projectId", async (req) =>
      ok(await projects.updateProject(req.ctx, parse(projectParam, req.params).projectId, parse(updateProjectSchema, req.body))),
    );
    s.post("/projects/:projectId/archive", async (req) => ok(await projects.setArchived(req.ctx, parse(projectParam, req.params).projectId, true)));
    s.post("/projects/:projectId/unarchive", async (req) => ok(await projects.setArchived(req.ctx, parse(projectParam, req.params).projectId, false)));
    s.get("/projects/:projectId/dashboard", async (req) => ok(await projects.projectDashboard(req.ctx, parse(projectParam, req.params).projectId)));
    s.post("/projects/:projectId/members", async (req) =>
      ok(await projects.addMember(req.ctx, parse(projectParam, req.params).projectId, parse(addProjectMemberSchema, req.body))),
    );
    s.delete("/projects/:projectId/members/:userId", async (req) => {
      const p = parse(z.object({ projectId: z.guid(), userId: z.guid() }), req.params);
      await projects.removeMember(req.ctx, p.projectId, p.userId);
      return ok({ removed: true });
    });
    s.patch("/projects/:projectId/stages/:stageId", async (req) => {
      const p = parse(z.object({ projectId: z.guid(), stageId: z.guid() }), req.params);
      return ok(await projects.updateStage(req.ctx, p.projectId, p.stageId, parse(updateStageSchema, req.body)));
    });
    s.get("/projects/:projectId/property", async (req) => ok(await clientsSvc.projectProperty(req.ctx, parse(projectParam, req.params).projectId)));
    s.get("/projects/:projectId/activity", async (req) => {
      const q = parse(pageQuery, req.query);
      const { items, nextBefore } = await projectActivity(req.ctx, parse(projectParam, req.params).projectId, q);
      return ok(items, { nextCursor: nextBefore });
    });
    s.get("/projects/:projectId/weather", async (req) => ok(await projectWeather(req.ctx, parse(projectParam, req.params).projectId)));

    // --- Schedule -----------------------------------------------------------
    s.get("/projects/:projectId/schedule", async (req) => ok(await schedule.getProjectSchedule(req.ctx, parse(projectParam, req.params).projectId)));
    s.post("/projects/:projectId/schedule/shift", async (req) =>
      ok(await schedule.shiftSchedule(req.ctx, parse(projectParam, req.params).projectId, parse(scheduleShiftSchema, req.body))),
    );
    s.post("/projects/:projectId/dependencies", async (req, reply) =>
      reply.code(201).send(ok(await schedule.addDependency(req.ctx, parse(projectParam, req.params).projectId, parse(dependencySchema, req.body)))),
    );
    s.delete("/projects/:projectId/dependencies/:id", async (req) => {
      const p = parse(z.object({ projectId: z.guid(), id: z.guid() }), req.params);
      await schedule.removeDependency(req.ctx, p.projectId, p.id);
      return ok({ removed: true });
    });
    s.get("/projects/:projectId/baselines", async (req) => ok(await schedule.listBaselines(req.ctx, parse(projectParam, req.params).projectId)));
    s.post("/projects/:projectId/baselines", async (req, reply) => {
      const { name } = parse(z.object({ name: z.string().trim().min(1).max(120) }), req.body);
      return reply.code(201).send(ok(await schedule.saveBaseline(req.ctx, parse(projectParam, req.params).projectId, name)));
    });
    s.get("/schedule/calendar", async (req) => {
      const q = parse(
        z.object({ from: isoDate, to: isoDate, assigneeId: z.union([z.guid(), z.literal("me")]).optional(), crewTeamId: z.guid().optional(), projectId: z.guid().optional() }),
        req.query,
      );
      return ok(await schedule.calendarFeed(req.ctx, q));
    });

    // --- Tasks --------------------------------------------------------------
    s.get("/tasks", async (req) => {
      const { items, nextCursor } = await tasks.listTasks(req.ctx, parse(taskListQuery, req.query));
      return ok(items, { nextCursor });
    });
    s.post("/projects/:projectId/tasks", async (req, reply) =>
      reply.code(201).send(ok(await tasks.createTask(req.ctx, parse(projectParam, req.params).projectId, parse(createTaskSchema, req.body)))),
    );
    s.get("/tasks/:id", async (req) => ok(await tasks.getTask(req.ctx, parse(id, req.params).id)));
    s.patch("/tasks/:id", async (req) => ok(await tasks.updateTask(req.ctx, parse(id, req.params).id, parse(updateTaskSchema, req.body))));
    s.post("/tasks/:id/complete", async (req) => ok(await tasks.completeTask(req.ctx, parse(id, req.params).id, parse(completeTaskSchema, req.body))));
    s.delete("/tasks/:id", async (req) => {
      await tasks.deleteTask(req.ctx, parse(id, req.params).id);
      return ok({ deleted: true });
    });
    s.post("/tasks/:id/checklist", async (req, reply) =>
      reply.code(201).send(ok(await tasks.addChecklistItem(req.ctx, parse(id, req.params).id, parse(checklistItemInput, req.body)))),
    );
    s.patch("/checklist-items/:id", async (req) => {
      const b = parse(checklistToggleSchema, req.body);
      return ok(await tasks.toggleChecklistItem(req.ctx, parse(id, req.params).id, b.isChecked, b.expectedVersion));
    });
    s.delete("/checklist-items/:id", async (req) => {
      await tasks.deleteChecklistItem(req.ctx, parse(id, req.params).id);
      return ok({ deleted: true });
    });
    s.post("/tasks/:id/notes", async (req, reply) =>
      reply.code(201).send(ok(await tasks.addTaskNote(req.ctx, parse(id, req.params).id, parse(taskNoteSchema, req.body)))),
    );

    // --- Budget, expenses, labor, materials ---------------------------------
    s.get("/projects/:projectId/budget", async (req) => ok(await budget.getBudget(req.ctx, parse(projectParam, req.params).projectId)));
    s.patch("/projects/:projectId/budget", async (req) =>
      ok(await budget.updateBudget(req.ctx, parse(projectParam, req.params).projectId, parse(updateBudgetSchema, req.body))),
    );
    s.post("/projects/:projectId/budget/items", async (req, reply) =>
      reply.code(201).send(ok(await budget.upsertBudgetItem(req.ctx, parse(projectParam, req.params).projectId, parse(budgetItemSchema, req.body)))),
    );
    s.put("/projects/:projectId/budget/items/:id", async (req) => {
      const p = parse(z.object({ projectId: z.guid(), id: z.guid() }), req.params);
      return ok(await budget.upsertBudgetItem(req.ctx, p.projectId, parse(budgetItemSchema, req.body), p.id));
    });
    s.delete("/projects/:projectId/budget/items/:id", async (req) => {
      const p = parse(z.object({ projectId: z.guid(), id: z.guid() }), req.params);
      await budget.deleteBudgetItem(req.ctx, p.projectId, p.id);
      return ok({ deleted: true });
    });
    s.get("/projects/:projectId/expenses", async (req) => ok(await budget.listExpenses(req.ctx, parse(projectParam, req.params).projectId)));
    s.post("/projects/:projectId/expenses", async (req, reply) =>
      reply.code(201).send(ok(await budget.createExpense(req.ctx, parse(projectParam, req.params).projectId, parse(expenseSchema, req.body)))),
    );
    s.delete("/projects/:projectId/expenses/:id", async (req) => {
      const p = parse(z.object({ projectId: z.guid(), id: z.guid() }), req.params);
      await budget.deleteExpense(req.ctx, p.projectId, p.id);
      return ok({ deleted: true });
    });
    s.get("/projects/:projectId/labor", async (req) => ok(await budget.listLabor(req.ctx, parse(projectParam, req.params).projectId)));
    s.post("/projects/:projectId/labor", async (req, reply) =>
      reply.code(201).send(ok(await budget.createLaborEntry(req.ctx, parse(projectParam, req.params).projectId, parse(laborEntrySchema, req.body)))),
    );
    s.delete("/projects/:projectId/labor/:id", async (req) => {
      const p = parse(z.object({ projectId: z.guid(), id: z.guid() }), req.params);
      await budget.deleteLaborEntry(req.ctx, p.projectId, p.id);
      return ok({ deleted: true });
    });
    s.get("/projects/:projectId/materials", async (req) => ok(await budget.listMaterialUsage(req.ctx, parse(projectParam, req.params).projectId)));
    s.post("/projects/:projectId/materials", async (req, reply) =>
      reply.code(201).send(ok(await budget.upsertMaterialUsage(req.ctx, parse(projectParam, req.params).projectId, parse(materialUsageSchema, req.body)))),
    );
    s.put("/projects/:projectId/materials/:id", async (req) => {
      const p = parse(z.object({ projectId: z.guid(), id: z.guid() }), req.params);
      return ok(await budget.upsertMaterialUsage(req.ctx, p.projectId, parse(materialUsageSchema, req.body), p.id));
    });

    // --- Change orders, approvals, payments ---------------------------------
    s.get("/projects/:projectId/change-orders", async (req) => ok(await changeOrders.listChangeOrders(req.ctx, parse(projectParam, req.params).projectId)));
    s.post("/projects/:projectId/change-orders", async (req, reply) =>
      reply.code(201).send(ok(await changeOrders.createChangeOrder(req.ctx, parse(projectParam, req.params).projectId, parse(changeOrderSchema, req.body)))),
    );
    s.get("/change-orders/:id", async (req) => ok(await changeOrders.getChangeOrder(req.ctx, parse(id, req.params).id)));
    s.patch("/change-orders/:id", async (req) =>
      ok(await changeOrders.updateChangeOrder(req.ctx, parse(id, req.params).id, parse(updateChangeOrderSchema, req.body))),
    );
    s.post("/change-orders/:id/transition", async (req) =>
      ok(await changeOrders.transitionChangeOrder(req.ctx, parse(id, req.params).id, parse(changeOrderTransitionSchema, req.body))),
    );
    s.get("/approvals", async (req) => {
      const q = parse(z.object({ projectId: z.guid().optional(), status: z.enum(["pending", "approved", "rejected", "cancelled"]).optional() }), req.query);
      return ok(await approvals.listApprovals(req.ctx, q));
    });
    s.post("/projects/:projectId/approvals", async (req, reply) =>
      reply.code(201).send(ok(await approvals.requestApproval(req.ctx, parse(projectParam, req.params).projectId, parse(approvalRequestSchema, req.body)))),
    );
    s.post("/approvals/:id/decision", async (req) => ok(await approvals.decideApproval(req.ctx, parse(id, req.params).id, parse(approvalDecisionSchema, req.body))));
    s.post("/approvals/:id/cancel", async (req) => {
      await approvals.cancelApproval(req.ctx, parse(id, req.params).id);
      return ok({ cancelled: true });
    });
    s.get("/projects/:projectId/payments", async (req) => ok(await payments.listPayments(req.ctx, parse(projectParam, req.params).projectId)));
    s.post("/projects/:projectId/payments", async (req, reply) =>
      reply.code(201).send(ok(await payments.createPayment(req.ctx, parse(projectParam, req.params).projectId, parse(paymentSchema, req.body)))),
    );
    s.patch("/projects/:projectId/payments/:id", async (req) => {
      const p = parse(z.object({ projectId: z.guid(), id: z.guid() }), req.params);
      return ok(await payments.updatePayment(req.ctx, p.projectId, p.id, parse(updatePaymentSchema, req.body)));
    });

    // --- Photos -------------------------------------------------------------
    s.get("/projects/:projectId/photos", async (req) => {
      const q = parse(
        pageQuery.extend({ taskId: z.guid().optional(), kind: z.enum(PHOTO_KINDS).optional(), inspectionId: z.guid().optional(), changeOrderId: z.guid().optional() }),
        req.query,
      );
      const { items, nextBefore } = await photos.listPhotos(req.ctx, parse(projectParam, req.params).projectId, q);
      return ok(items, { nextCursor: nextBefore });
    });
    s.post("/projects/:projectId/photos", async (req, reply) =>
      reply.code(201).send(ok(await photos.createPhoto(req.ctx, parse(projectParam, req.params).projectId, parse(photoCreateSchema, req.body)))),
    );
    s.post("/photos/:id/upload-url", async (req) => ok(await photos.photoUploadUrl(req.ctx, parse(id, req.params).id)));
    s.post("/photos/:id/complete", async (req) => ok(await photos.completePhotoUpload(req.ctx, parse(id, req.params).id)));
    s.patch("/photos/:id", async (req) => ok(await photos.updatePhoto(req.ctx, parse(id, req.params).id, parse(photoUpdateSchema, req.body))));
    s.delete("/photos/:id", async (req) => {
      await photos.deletePhoto(req.ctx, parse(id, req.params).id);
      return ok({ deleted: true });
    });

    // --- Measurements -------------------------------------------------------
    s.get("/projects/:projectId/measurements", async (req) => ok(await measurements.listMeasurements(req.ctx, parse(projectParam, req.params).projectId)));
    s.post("/projects/:projectId/measurements", async (req, reply) =>
      reply.code(201).send(ok(await measurements.createMeasurement(req.ctx, parse(projectParam, req.params).projectId, parse(measurementSchema, req.body)))),
    );
    s.patch("/measurements/:id", async (req) =>
      ok(await measurements.updateMeasurement(req.ctx, parse(id, req.params).id, parse(updateMeasurementSchema, req.body))),
    );
    s.delete("/measurements/:id", async (req) => {
      await measurements.deleteMeasurement(req.ctx, parse(id, req.params).id);
      return ok({ deleted: true });
    });
    s.get("/projects/:projectId/measurements/export", async (req, reply) => {
      const { format } = parse(z.object({ format: z.enum(["json", "csv"]).default("json") }), req.query);
      const file = await measurements.exportMeasurements(req.ctx, parse(projectParam, req.params).projectId, format);
      return reply
        .header("Content-Type", file.contentType)
        .header("Content-Disposition", `attachment; filename="${file.fileName}"`)
        .send(file.body);
    });

    // --- Inspections --------------------------------------------------------
    s.get("/projects/:projectId/inspections", async (req) => ok(await inspections.listInspections(req.ctx, parse(projectParam, req.params).projectId)));
    s.post("/projects/:projectId/inspections", async (req, reply) =>
      reply.code(201).send(ok(await inspections.createInspection(req.ctx, parse(projectParam, req.params).projectId, parse(inspectionSchema, req.body)))),
    );
    s.get("/inspections/:id", async (req) => ok(await inspections.getInspection(req.ctx, parse(id, req.params).id)));
    s.patch("/inspections/:id", async (req) =>
      ok(await inspections.updateInspection(req.ctx, parse(id, req.params).id, parse(updateInspectionSchema, req.body))),
    );

    // --- Messages -----------------------------------------------------------
    s.get("/projects/:projectId/messages", async (req) => {
      const q = parse(
        z.object({ threadKey: z.string().max(80).optional(), before: z.string().max(40).optional(), after: z.string().max(40).optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }),
        req.query,
      );
      return ok(await messages.listMessages(req.ctx, parse(projectParam, req.params).projectId, q));
    });
    s.post("/projects/:projectId/messages", async (req, reply) =>
      reply.code(201).send(ok(await messages.sendMessage(req.ctx, parse(projectParam, req.params).projectId, parse(messageSchema, req.body)))),
    );

    // --- Design integration -------------------------------------------------
    s.get("/projects/:projectId/designs", async (req) => ok(await designs.listDesigns(req.ctx, parse(projectParam, req.params).projectId)));
    s.post("/projects/:projectId/designs", async (req, reply) =>
      reply.code(201).send(ok(await designs.createDesign(req.ctx, parse(projectParam, req.params).projectId, parse(designProjectSchema, req.body)))),
    );
    s.patch("/designs/:id", async (req) =>
      ok(
        await designs.updateDesignSummary(
          req.ctx,
          parse(id, req.params).id,
          parse(patchOf(designProjectSchema).extend({ status: z.enum(["draft", "in_review", "approved", "superseded"]).optional() }), req.body),
        ),
      ),
    );
    s.post("/designs/:id/sync", async (req) => ok(await designs.syncDesign(req.ctx, parse(id, req.params).id)));
    s.post("/designs/:id/models", async (req, reply) =>
      reply.code(201).send(ok(await designs.addDesignModel(req.ctx, parse(id, req.params).id, parse(designModelSchema, req.body)))),
    );

    // --- AI -----------------------------------------------------------------
    s.post("/projects/:projectId/ai/ask", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req) =>
      ok(await askProjectAssistant(req.ctx, parse(projectParam, req.params).projectId, parse(aiAskSchema, req.body))),
    );
  });
}
