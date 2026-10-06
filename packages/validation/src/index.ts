import { z } from "zod";
import {
  APPROVAL_STATUSES,
  APPROVAL_SUBJECTS,
  BUDGET_CATEGORIES,
  CHANGE_ORDER_STATUSES,
  DEPENDENCY_TYPES,
  DOCUMENT_CATEGORIES,
  INSPECTION_RESULTS,
  MEASUREMENT_CATEGORIES,
  MEASUREMENT_UNITS,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_TYPES,
  PAYMENT_STATUSES,
  PHOTO_KINDS,
  PROJECT_STATUSES,
  PROJECT_TYPES,
  ROLES,
  STAGE_STATUSES,
  SYNC_ENTITY_TYPES,
  SYNC_OPERATIONS,
  TASK_PRIORITIES,
  TASK_STATUSES,
  VISIBILITIES,
} from "@pool/types";
import { LIMITS } from "@pool/config";

/*
 * Request validation schemas shared by the API (DTO validation) and the
 * mobile app (form validation). Keep them free of server-only concerns.
 */

// Permissive 8-4-4-4-12 hex check (Postgres accepts any such value).
export const uuid = z.guid();

type StripDefault<T> = T extends z.ZodDefault<infer I> ? I : T;
type PatchShape<S extends z.ZodRawShape> = { [K in keyof S]: z.ZodOptional<StripDefault<S[K]>> };

/**
 * PATCH schema from a create schema: every field optional and *no defaults*.
 * (zod's `.partial()` still applies `.default()` values, which would silently
 * reset untouched fields on update.)
 */
export function patchOf<S extends z.ZodRawShape>(schema: z.ZodObject<S>): z.ZodObject<PatchShape<S>> {
  const shape: Record<string, z.ZodType> = {};
  for (const [key, value] of Object.entries(schema.shape)) {
    const inner = value instanceof z.ZodDefault ? (value.unwrap() as z.ZodType) : (value as z.ZodType);
    shape[key] = inner.optional();
  }
  return z.object(shape) as unknown as z.ZodObject<PatchShape<S>>;
}

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a date in YYYY-MM-DD format");
export const isoDateTime = z.string().datetime({ offset: true });
export const cents = z.number().int().min(0).max(100_000_000_00);
export const signedCents = z.number().int().min(-100_000_000_00).max(100_000_000_00);
const trimmed = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).nullish();

export const geoPointSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracyMeters: z.number().min(0).nullish(),
});

export const addressSchema = z.object({
  line1: trimmed(200),
  line2: optionalText(200),
  city: trimmed(100),
  region: trimmed(100),
  postalCode: trimmed(20),
  country: z.string().trim().length(2).default("US"),
});

export const paginationQuery = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export const passwordSchema = z
  .string()
  .min(10, "Password must be at least 10 characters")
  .max(200)
  .regex(/[A-Za-z]/, "Password must contain a letter")
  .regex(/\d/, "Password must contain a number");

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(200),
  deviceName: z.string().max(100).optional(),
});

export const registerSchema = z.object({
  organizationName: trimmed(120),
  fullName: trimmed(120),
  email: z.string().trim().toLowerCase().email(),
  password: passwordSchema,
  timezone: z.string().max(64).default("America/Phoenix"),
});

export const refreshSchema = z.object({ refreshToken: z.string().min(20).max(500) });
export const forgotPasswordSchema = z.object({ email: z.string().trim().toLowerCase().email() });
export const resetPasswordSchema = z.object({ token: z.string().min(20).max(500), password: passwordSchema });
export const magicLinkRequestSchema = forgotPasswordSchema;
export const magicLinkVerifySchema = z.object({ token: z.string().min(20).max(500) });
export const mfaVerifySchema = z.object({ ticket: z.string().min(20).max(1000), code: z.string().regex(/^\d{6}$/) });
export const mfaConfirmSchema = z.object({ code: z.string().regex(/^\d{6}$/) });
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1), newPassword: passwordSchema });

// ---------------------------------------------------------------------------
// Users / teams / organizations
// ---------------------------------------------------------------------------

export const inviteUserSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  fullName: trimmed(120),
  role: z.enum(ROLES),
  phone: optionalText(40),
  clientId: uuid.nullish(),
});

export const updateUserSchema = z.object({
  fullName: trimmed(120).optional(),
  phone: optionalText(40),
  role: z.enum(ROLES).optional(),
  isActive: z.boolean().optional(),
});

export const teamSchema = z.object({
  name: trimmed(120),
  kind: z.enum(["crew", "office", "design"]),
  leadUserId: uuid.nullish(),
  memberIds: z.array(uuid).max(200).default([]),
});

export const organizationSettingsSchema = z.object({
  budgetAlertThresholdPct: z.number().min(1).max(200),
  clientCanSeeContractAmount: z.boolean(),
  crewLocationSharingEnabled: z.boolean(),
  weather: z.object({
    rainProbabilityPct: z.number().min(0).max(100),
    windSpeedKph: z.number().min(0).max(300),
    minTempC: z.number().min(-50).max(60),
    maxTempC: z.number().min(-50).max(60),
  }),
});

export const updateOrganizationSchema = z.object({
  name: trimmed(120).optional(),
  timezone: z.string().max(64).optional(),
  settings: patchOf(organizationSettingsSchema).optional(),
});

// ---------------------------------------------------------------------------
// Clients / properties
// ---------------------------------------------------------------------------

export const clientSchema = z.object({
  id: uuid.optional(),
  firstName: trimmed(80),
  lastName: trimmed(80),
  email: z.string().trim().toLowerCase().email().nullish(),
  phone: optionalText(40),
  alternatePhone: optionalText(40),
  preferredContact: z.enum(["email", "phone", "sms"]).default("phone"),
  mailingAddress: addressSchema.nullish(),
  notes: optionalText(5000),
});
export const updateClientSchema = patchOf(clientSchema.omit({ id: true }));

export const utilityLocationSchema = z.object({
  kind: z.enum(["gas", "electric", "water", "sewer", "septic", "irrigation", "telecom", "other"]),
  description: trimmed(500),
  location: geoPointSchema.nullish(),
  markedAt: isoDate.nullish(),
});

export const propertySchema = z.object({
  id: uuid.optional(),
  clientId: uuid,
  address: addressSchema,
  location: geoPointSchema.nullish(),
  lotWidthFt: z.number().positive().max(100_000).nullish(),
  lotDepthFt: z.number().positive().max(100_000).nullish(),
  lotAreaSqft: z.number().positive().max(100_000_000).nullish(),
  existingStructures: optionalText(5000),
  existingPool: optionalText(5000),
  existingLandscaping: optionalText(5000),
  utilityLocations: z.array(utilityLocationSchema).max(50).default([]),
  accessRestrictions: optionalText(5000),
  gateWidthIn: z.number().positive().max(10_000).nullish(),
  gateNotes: optionalText(2000),
  equipmentLocation: optionalText(2000),
  hoaName: optionalText(200),
  siteNotes: optionalText(10_000),
});
export const updatePropertySchema = patchOf(propertySchema.omit({ id: true, clientId: true }));

// ---------------------------------------------------------------------------
// Projects / stages
// ---------------------------------------------------------------------------

const projectBase = z.object({
  id: uuid.optional(),
  name: trimmed(160),
  type: z.enum(PROJECT_TYPES),
  status: z.enum(PROJECT_STATUSES).default("lead"),
  description: optionalText(10_000),
  projectManagerId: uuid.nullish(),
  crewTeamId: uuid.nullish(),
  contractAmountCents: cents.default(0),
  estimatedCostCents: cents.default(0),
  plannedStartDate: isoDate.nullish(),
  plannedCompletionDate: isoDate.nullish(),
  /** Stage template keys to include; defaults to the organization's full template. */
  stageKeys: z.array(z.string().max(60)).max(60).optional(),
});

/**
 * Create a project. Supply an existing client/property by id, or create them
 * inline (capture-once: the address entered here feeds maps, weather, reports).
 */
export const createProjectSchema = projectBase
  .extend({
    clientId: uuid.optional(),
    client: clientSchema.optional(),
    propertyId: uuid.optional(),
    property: propertySchema.omit({ clientId: true }).optional(),
  })
  .refine((v) => !!v.clientId !== !!v.client, {
    message: "Provide exactly one of clientId or client",
    path: ["clientId"],
  })
  .refine((v) => !!v.propertyId !== !!v.property, {
    message: "Provide exactly one of propertyId or property",
    path: ["propertyId"],
  })
  .refine(
    (v) => !v.plannedStartDate || !v.plannedCompletionDate || v.plannedStartDate <= v.plannedCompletionDate,
    { message: "Completion must be on or after start", path: ["plannedCompletionDate"] },
  );

export const updateProjectSchema = patchOf(projectBase.omit({ id: true, stageKeys: true })).extend({ expectedVersion: z.number().int().optional() });

export const projectListQuery = paginationQuery.extend({
  scope: z.enum(["all", "active", "upcoming", "completed", "archived"]).default("all"),
  status: z.enum(PROJECT_STATUSES).optional(),
  type: z.enum(PROJECT_TYPES).optional(),
  projectManagerId: uuid.optional(),
  crewTeamId: uuid.optional(),
  clientId: uuid.optional(),
  city: z.string().max(100).optional(),
  startFrom: isoDate.optional(),
  startTo: isoDate.optional(),
  completionFrom: isoDate.optional(),
  completionTo: isoDate.optional(),
  q: z.string().max(200).optional(),
  sort: z.enum(["updated", "start", "completion", "name"]).default("updated"),
});

export const updateStageSchema = z.object({
  name: trimmed(120).optional(),
  status: z.enum(STAGE_STATUSES).optional(),
  plannedStartDate: isoDate.nullish(),
  plannedEndDate: isoDate.nullish(),
  actualStartDate: isoDate.nullish(),
  actualEndDate: isoDate.nullish(),
  clientVisible: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(1000).optional(),
});

export const stageTemplateSchema = z.object({
  name: trimmed(120),
  key: z.string().regex(/^[a-z0-9_]{2,60}$/),
  sortOrder: z.number().int().min(0).max(1000),
  defaultDurationDays: z.number().int().min(0).max(365),
  isMilestone: z.boolean().default(false),
  checklist: z
    .array(z.object({ label: trimmed(200), required: z.boolean(), requiresPhoto: z.boolean().optional() }))
    .max(100)
    .default([]),
});

export const addProjectMemberSchema = z.object({ userId: uuid, role: z.enum(ROLES).optional() });

// ---------------------------------------------------------------------------
// Tasks / dependencies / checklists
// ---------------------------------------------------------------------------

export const checklistItemInput = z.object({
  id: uuid.optional(),
  label: trimmed(200),
  required: z.boolean().default(false),
  requiresPhoto: z.boolean().default(false),
});

export const createTaskSchema = z.object({
  id: uuid.optional(),
  stageId: uuid.nullish(),
  title: trimmed(200),
  description: optionalText(10_000),
  status: z.enum(TASK_STATUSES).default("todo"),
  priority: z.enum(TASK_PRIORITIES).default("normal"),
  assigneeId: uuid.nullish(),
  crewTeamId: uuid.nullish(),
  subcontractorId: uuid.nullish(),
  isMilestone: z.boolean().default(false),
  plannedStartDate: isoDate.nullish(),
  plannedEndDate: isoDate.nullish(),
  durationDays: z.number().int().min(0).max(365).default(1),
  estimatedHours: z.number().min(0).max(10_000).nullish(),
  weatherSensitive: z.boolean().default(false),
  dueDate: isoDate.nullish(),
  checklist: z.array(checklistItemInput).max(100).default([]),
  /** Apply a stage-template checklist (e.g. "equipment") when no explicit checklist given. */
  checklistTemplateKey: z.string().max(60).optional(),
});

export const updateTaskSchema = patchOf(createTaskSchema.omit({ id: true, checklist: true, checklistTemplateKey: true })).extend({
    actualStartDate: isoDate.nullish(),
    actualEndDate: isoDate.nullish(),
    expectedVersion: z.number().int().optional(),
  });

export const completeTaskSchema = z.object({
  /** Override mandatory checklist items; requires `task:override_checklist`. */
  override: z.boolean().default(false),
  overrideReason: optionalText(1000),
  actualEndDate: isoDate.optional(),
});

export const taskListQuery = paginationQuery.extend({
  projectId: uuid.optional(),
  assigneeId: z.union([uuid, z.literal("me")]).optional(),
  status: z.enum(TASK_STATUSES).optional(),
  due: z.enum(["today", "overdue", "upcoming", "week"]).optional(),
  q: z.string().max(200).optional(),
});

export const dependencySchema = z.object({
  predecessorId: uuid,
  successorId: uuid,
  type: z.enum(DEPENDENCY_TYPES).default("FS"),
  lagDays: z.number().int().min(-60).max(365).default(0),
});

export const checklistToggleSchema = z.object({
  isChecked: z.boolean(),
  expectedVersion: z.number().int().optional(),
});

export const taskNoteSchema = z.object({
  id: uuid.optional(),
  body: trimmed(10_000),
  isProblem: z.boolean().default(false),
  visibility: z.enum(VISIBILITIES).default("internal"),
});

export const scheduleShiftSchema = z.object({
  taskId: uuid,
  /** New planned start date for the task; downstream impacts are computed. */
  newStartDate: isoDate.optional(),
  /** Or a delay in working days applied to the task. */
  delayDays: z.number().int().min(-365).max(365).optional(),
  reason: optionalText(1000),
  /** Preview only (default) or apply the proposed shifts. */
  apply: z.boolean().default(false),
});

// ---------------------------------------------------------------------------
// Financials
// ---------------------------------------------------------------------------

export const budgetItemSchema = z.object({
  id: uuid.optional(),
  category: z.enum(BUDGET_CATEGORIES),
  description: trimmed(300),
  quantity: z.number().min(0).max(1_000_000).default(1),
  unitCostCents: cents,
  stageId: uuid.nullish(),
});

export const updateBudgetSchema = z.object({
  contingencyPct: z.number().min(0).max(100).optional(),
  notes: optionalText(5000),
});

export const expenseSchema = z.object({
  id: uuid.optional(),
  budgetItemId: uuid.nullish(),
  category: z.enum(BUDGET_CATEGORIES),
  vendorId: uuid.nullish(),
  description: trimmed(300),
  amountCents: signedCents,
  incurredOn: isoDate,
  receiptPhotoId: uuid.nullish(),
  changeOrderId: uuid.nullish(),
});

export const laborEntrySchema = z.object({
  id: uuid.optional(),
  taskId: uuid.nullish(),
  userId: uuid.optional(),
  workDate: isoDate,
  hours: z.number().positive().max(24),
  hourlyCostCents: cents.optional(),
  notes: optionalText(2000),
});

export const vendorSchema = z.object({
  name: trimmed(160),
  kind: z.enum(["supplier", "subcontractor", "rental", "other"]),
  trade: optionalText(100),
  contactName: optionalText(120),
  email: z.string().trim().toLowerCase().email().nullish(),
  phone: optionalText(40),
  address: addressSchema.nullish(),
  location: geoPointSchema.nullish(),
  notes: optionalText(5000),
  isActive: z.boolean().default(true),
});

export const materialSchema = z.object({
  sku: optionalText(80),
  name: trimmed(200),
  category: trimmed(80),
  unit: trimmed(20),
  unitCostCents: cents,
  preferredVendorId: uuid.nullish(),
});

export const materialUsageSchema = z.object({
  materialId: uuid,
  taskId: uuid.nullish(),
  quantityPlanned: z.number().min(0).max(1_000_000),
  quantityUsed: z.number().min(0).max(1_000_000).default(0),
  unitCostCents: cents.optional(),
  status: z.enum(["planned", "ordered", "delivered", "installed", "returned"]).default("planned"),
  orderedAt: isoDate.nullish(),
  deliveredAt: isoDate.nullish(),
});

export const changeOrderSchema = z.object({
  title: trimmed(200),
  description: trimmed(10_000),
  reason: optionalText(2000),
  costCents: signedCents.default(0),
  priceCents: signedCents.default(0),
  laborHoursImpact: z.number().min(-10_000).max(10_000).default(0),
  materialImpact: optionalText(5000),
  scheduleImpactDays: z.number().int().min(-365).max(365).default(0),
});
export const updateChangeOrderSchema = patchOf(changeOrderSchema);

export const changeOrderTransitionSchema = z.object({
  to: z.enum(CHANGE_ORDER_STATUSES),
  notes: optionalText(2000),
  signatureName: optionalText(120),
  /** PNG data URL captured from the signature pad (max ~200KB). */
  signatureDataUrl: z
    .string()
    .max(300_000)
    .regex(/^data:image\/(png|jpeg);base64,/)
    .nullish(),
});

export const paymentSchema = z.object({
  label: trimmed(200),
  amountCents: cents,
  dueDate: isoDate.nullish(),
  status: z.enum(PAYMENT_STATUSES).default("scheduled"),
  method: optionalText(60),
  reference: optionalText(120),
  stageId: uuid.nullish(),
  changeOrderId: uuid.nullish(),
});
export const updatePaymentSchema = patchOf(paymentSchema).extend({ paidAt: isoDateTime.nullish() });

// ---------------------------------------------------------------------------
// Field: photos, documents, measurements, inspections
// ---------------------------------------------------------------------------

export const photoCreateSchema = z.object({
  id: uuid.optional(),
  taskId: uuid.nullish(),
  stageId: uuid.nullish(),
  inspectionId: uuid.nullish(),
  changeOrderId: uuid.nullish(),
  measurementId: uuid.nullish(),
  /** Photo evidence for a checklist item that requires one. */
  checklistItemId: uuid.nullish(),
  kind: z.enum(PHOTO_KINDS).default("progress"),
  caption: optionalText(2000),
  takenAt: isoDateTime,
  location: geoPointSchema.nullish(),
  mimeType: z.enum(["image/jpeg", "image/png", "image/heic", "image/webp"]).default("image/jpeg"),
  byteSize: z.number().int().positive().max(LIMITS.photoBytes),
  width: z.number().int().positive().max(20_000).nullish(),
  height: z.number().int().positive().max(20_000).nullish(),
  visibility: z.enum(VISIBILITIES).default("internal"),
  pairedPhotoId: uuid.nullish(),
});
export const photoUpdateSchema = patchOf(
  photoCreateSchema.pick({ caption: true, kind: true, visibility: true, taskId: true, stageId: true, pairedPhotoId: true }),
);

export const documentCreateSchema = z.object({
  projectId: uuid.nullish(),
  title: trimmed(200),
  category: z.enum(DOCUMENT_CATEGORIES),
  description: optionalText(5000),
  visibility: z.enum(VISIBILITIES).default("internal"),
  tags: z.array(z.string().trim().max(40)).max(30).default([]),
  availableOffline: z.boolean().default(false),
  file: z.object({
    fileName: trimmed(255),
    mimeType: z.string().max(120),
    byteSize: z.number().int().positive().max(LIMITS.documentBytes),
    checksumSha256: z.string().regex(/^[a-f0-9]{64}$/).nullish(),
  }),
});

export const documentVersionSchema = z.object({
  fileName: trimmed(255),
  mimeType: z.string().max(120),
  byteSize: z.number().int().positive().max(LIMITS.documentBytes),
  checksumSha256: z.string().regex(/^[a-f0-9]{64}$/).nullish(),
  notes: optionalText(2000),
});

export const documentUpdateSchema = patchOf(documentCreateSchema.omit({ file: true, projectId: true }));

export const documentListQuery = paginationQuery.extend({
  projectId: uuid.optional(),
  category: z.enum(DOCUMENT_CATEGORIES).optional(),
  q: z.string().max(200).optional(),
});

export const measurementGeometrySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("point"), x: z.number(), y: z.number(), z: z.number().optional() }),
  z.object({ type: z.literal("line"), points: z.array(z.tuple([z.number(), z.number()]).rest(z.number())).min(2).max(500) }),
  z.object({ type: z.literal("polygon"), points: z.array(z.tuple([z.number(), z.number()]).rest(z.number())).min(3).max(500) }),
  z.object({
    type: z.literal("profile"),
    stations: z.array(z.object({ distance: z.number(), depth: z.number() })).min(2).max(200),
  }),
]);

export const measurementSchema = z.object({
  id: uuid.optional(),
  propertyId: uuid.nullish(),
  category: z.enum(MEASUREMENT_CATEGORIES),
  label: trimmed(160),
  value: z.number().finite(),
  unit: z.enum(MEASUREMENT_UNITS),
  geometry: measurementGeometrySchema.nullish(),
  location: geoPointSchema.nullish(),
  notes: optionalText(5000),
  measuredAt: isoDateTime,
});
export const updateMeasurementSchema = patchOf(measurementSchema.omit({ id: true }));

export const inspectionItemResultSchema = z.object({
  key: z.string().max(60),
  label: trimmed(200),
  result: z.enum(["pass", "fail", "na", "pending"]),
  notes: optionalText(2000),
  correctiveAction: optionalText(2000),
});

export const inspectionSchema = z.object({
  id: uuid.optional(),
  stageId: uuid.nullish(),
  templateId: uuid.nullish(),
  inspectionType: trimmed(120),
  inspectorName: trimmed(120),
  inspectorOrg: optionalText(120),
  scheduledFor: isoDate.nullish(),
  inspectedAt: isoDateTime.nullish(),
  result: z.enum(INSPECTION_RESULTS).default("pending"),
  items: z.array(inspectionItemResultSchema).max(200).default([]),
  notes: optionalText(10_000),
  signatureName: optionalText(120),
  signatureDataUrl: z.string().max(300_000).regex(/^data:image\/(png|jpeg);base64,/).nullish(),
  /** When the inspection fails, create corrective tasks for failed items (default true). */
  generateCorrectiveTasks: z.boolean().default(true),
});
export const updateInspectionSchema = patchOf(inspectionSchema.omit({ id: true }));

export const inspectionTemplateSchema = z.object({
  name: trimmed(120),
  inspectionType: trimmed(120),
  items: z
    .array(z.object({ key: z.string().regex(/^[a-z0-9_]{1,60}$/), label: trimmed(200), required: z.boolean() }))
    .min(1)
    .max(200),
});

// ---------------------------------------------------------------------------
// Client experience: approvals, messages, notifications
// ---------------------------------------------------------------------------

export const approvalRequestSchema = z.object({
  subjectType: z.enum(APPROVAL_SUBJECTS),
  subjectId: uuid.nullish(),
  title: trimmed(200),
  description: optionalText(5000),
  requestedFrom: uuid.nullish(),
  dueDate: isoDate.nullish(),
});

export const approvalDecisionSchema = z.object({
  decision: z.enum(APPROVAL_STATUSES).refine((s) => s === "approved" || s === "rejected", {
    message: "Decision must be approved or rejected",
  }),
  notes: optionalText(2000),
  signatureName: optionalText(120),
  signatureDataUrl: z.string().max(300_000).regex(/^data:image\/(png|jpeg);base64,/).nullish(),
});

export const messageSchema = z.object({
  id: uuid.optional(),
  threadKey: z.string().max(80).default("general"),
  body: trimmed(10_000),
  visibility: z.enum(VISIBILITIES).default("internal"),
  attachments: z.array(z.object({ photoId: uuid.optional(), documentId: uuid.optional() })).max(20).default([]),
});

export const notificationPreferenceSchema = z.object({
  preferences: z
    .array(
      z.object({
        type: z.enum(NOTIFICATION_TYPES),
        channels: z.array(z.enum(NOTIFICATION_CHANNELS)).max(3),
        enabled: z.boolean(),
      }),
    )
    .max(NOTIFICATION_TYPES.length),
});

export const pushTokenSchema = z.object({
  token: z.string().min(10).max(300),
  platform: z.enum(["ios", "android", "web"]),
  deviceId: z.string().max(120),
});

export const searchQuery = z.object({
  q: z.string().trim().min(2).max(200),
  types: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",") : undefined))
    .pipe(
      z.array(z.enum(["project", "client", "task", "document", "photo", "material", "change_order"])).optional(),
    ),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const reportQuery = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  format: z.enum(["json", "csv", "xlsx", "pdf"]).default("json"),
});

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

export const syncPushSchema = z.object({
  deviceId: z.string().min(1).max(120),
  operations: z
    .array(
      z.object({
        id: uuid,
        projectId: uuid.nullable(),
        entityType: z.enum(SYNC_ENTITY_TYPES),
        entityId: uuid,
        operation: z.enum(SYNC_OPERATIONS),
        payload: z.record(z.string(), z.unknown()),
        baseVersion: z.number().int().nullable(),
        baseValues: z.record(z.string(), z.unknown()).nullable().default(null),
        createdAt: isoDateTime,
        force: z.boolean().optional(),
      }),
    )
    .max(200),
});

export const syncPullSchema = z.object({
  cursor: z.string().max(100).nullish(),
  projectIds: z.array(uuid).max(200).optional(),
  limit: z.number().int().min(1).max(1000).default(500),
});

// ---------------------------------------------------------------------------
// Design integration
// ---------------------------------------------------------------------------

export const designProjectSchema = z.object({
  provider: z.string().max(60).default("manual"),
  title: trimmed(200),
  externalId: optionalText(200),
  summary: z
    .object({
      poolShape: z.string().max(60).optional(),
      lengthFt: z.number().positive().optional(),
      widthFt: z.number().positive().optional(),
      shallowDepthFt: z.number().positive().optional(),
      deepDepthFt: z.number().positive().optional(),
      deckAreaSqft: z.number().positive().optional(),
      features: z.array(z.string().max(100)).max(50).optional(),
      equipment: z.array(z.object({ name: z.string().max(100), location: z.string().max(200).optional() })).max(50).optional(),
    })
    .nullish(),
});

export const designModelSchema = z.object({
  kind: z.enum(["model_3d", "rendering", "plan", "landscape_concept", "deck_layout"]),
  title: trimmed(200),
  format: z.string().max(20),
  externalUrl: z.string().url().max(2000).nullish(),
  file: z
    .object({ fileName: trimmed(255), mimeType: z.string().max(120), byteSize: z.number().int().positive() })
    .nullish(),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type ProjectListQuery = z.infer<typeof projectListQuery>;
export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type CompleteTaskInput = z.infer<typeof completeTaskSchema>;
export type TaskListQuery = z.infer<typeof taskListQuery>;
export type DependencyInput = z.infer<typeof dependencySchema>;
export type ScheduleShiftInput = z.infer<typeof scheduleShiftSchema>;
export type ClientInput = z.infer<typeof clientSchema>;
export type PropertyInput = z.infer<typeof propertySchema>;
export type BudgetItemInput = z.infer<typeof budgetItemSchema>;
export type ExpenseInput = z.infer<typeof expenseSchema>;
export type LaborEntryInput = z.infer<typeof laborEntrySchema>;
export type ChangeOrderInput = z.infer<typeof changeOrderSchema>;
export type ChangeOrderTransitionInput = z.infer<typeof changeOrderTransitionSchema>;
export type PaymentInput = z.infer<typeof paymentSchema>;
export type PhotoCreateInput = z.infer<typeof photoCreateSchema>;
export type DocumentCreateInput = z.infer<typeof documentCreateSchema>;
export type MeasurementInput = z.infer<typeof measurementSchema>;
export type InspectionInput = z.infer<typeof inspectionSchema>;
export type ApprovalRequestInput = z.infer<typeof approvalRequestSchema>;
export type ApprovalDecisionInput = z.infer<typeof approvalDecisionSchema>;
export type MessageInput = z.infer<typeof messageSchema>;
export type SyncPushInput = z.infer<typeof syncPushSchema>;
export type SyncPullInput = z.infer<typeof syncPullSchema>;
export type InviteUserInput = z.infer<typeof inviteUserSchema>;
export type MaterialUsageInput = z.infer<typeof materialUsageSchema>;
export type DesignProjectInput = z.infer<typeof designProjectSchema>;

export { z };
