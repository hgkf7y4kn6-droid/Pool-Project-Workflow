import { relations, sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgSequence,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  ACTIVITY_ACTIONS,
  APPROVAL_STATUSES,
  APPROVAL_SUBJECTS,
  BUDGET_CATEGORIES,
  CHANGE_ORDER_STATUSES,
  DEPENDENCY_TYPES,
  DOCUMENT_CATEGORIES,
  INSPECTION_RESULTS,
  MEASUREMENT_CATEGORIES,
  MEASUREMENT_UNITS,
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
  type Address,
  type ChecklistTemplateItem,
  type DesignSummary,
  type GeoPoint,
  type InspectionItemResult,
  type InspectionTemplateItem,
  type MeasurementGeometry,
  type NotificationChannel,
  type OrganizationSettings,
  type UtilityLocation,
} from "@pool/types";

/*
 * Conventions
 * - UUID primary keys (clients may generate them offline).
 * - Column names are snake_case (drizzle `casing: "snake_case"`).
 * - Money is integer cents in bigint columns.
 * - Timestamps are timestamptz returned as ISO strings; calendar dates are `date`.
 * - Tables pulled by mobile clients carry `version` (optimistic concurrency),
 *   `change_seq` (monotonic pull cursor, bumped by trigger on every write)
 *   and `deleted_at` (soft delete so deletions propagate to devices).
 */

export const changeSeq = pgSequence("change_seq", { startWith: 1, increment: 1 });

export const roleEnum = pgEnum("role", ROLES);
export const projectStatusEnum = pgEnum("project_status", PROJECT_STATUSES);
export const projectTypeEnum = pgEnum("project_type", PROJECT_TYPES);
export const stageStatusEnum = pgEnum("stage_status", STAGE_STATUSES);
export const taskStatusEnum = pgEnum("task_status", TASK_STATUSES);
export const taskPriorityEnum = pgEnum("task_priority", TASK_PRIORITIES);
export const dependencyTypeEnum = pgEnum("dependency_type", DEPENDENCY_TYPES);
export const changeOrderStatusEnum = pgEnum("change_order_status", CHANGE_ORDER_STATUSES);
export const budgetCategoryEnum = pgEnum("budget_category", BUDGET_CATEGORIES);
export const photoKindEnum = pgEnum("photo_kind", PHOTO_KINDS);
export const documentCategoryEnum = pgEnum("document_category", DOCUMENT_CATEGORIES);
export const visibilityEnum = pgEnum("visibility", VISIBILITIES);
export const measurementCategoryEnum = pgEnum("measurement_category", MEASUREMENT_CATEGORIES);
export const measurementUnitEnum = pgEnum("measurement_unit", MEASUREMENT_UNITS);
export const inspectionResultEnum = pgEnum("inspection_result", INSPECTION_RESULTS);
export const approvalStatusEnum = pgEnum("approval_status", APPROVAL_STATUSES);
export const approvalSubjectEnum = pgEnum("approval_subject", APPROVAL_SUBJECTS);
export const paymentStatusEnum = pgEnum("payment_status", PAYMENT_STATUSES);
export const notificationTypeEnum = pgEnum("notification_type", NOTIFICATION_TYPES);
export const syncEntityTypeEnum = pgEnum("sync_entity_type", SYNC_ENTITY_TYPES);
export const syncOperationEnum = pgEnum("sync_operation", SYNC_OPERATIONS);
export const activityActionEnum = pgEnum("activity_action", ACTIVITY_ACTIONS);

const ts = () => timestamp({ withTimezone: true, mode: "string" });
const money = () => bigint({ mode: "number" });

const audit = {
  createdAt: ts().notNull().defaultNow(),
  updatedAt: ts().notNull().defaultNow(),
  createdBy: uuid(),
  updatedBy: uuid(),
};

const syncable = {
  version: integer().notNull().default(1),
  changeSeq: bigint({ mode: "number" })
    .notNull()
    .default(sql`nextval('change_seq')`),
  deletedAt: ts(),
};

// ---------------------------------------------------------------------------
// Tenancy, identity, access
// ---------------------------------------------------------------------------

export const organizations = pgTable("organizations", {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  slug: text().notNull().unique(),
  timezone: text().notNull().default("America/Phoenix"),
  currency: text().notNull().default("USD"),
  settings: jsonb().$type<OrganizationSettings>().notNull(),
  ...audit,
});

export const users = pgTable(
  "users",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: text().notNull(),
    fullName: text().notNull(),
    phone: text(),
    role: roleEnum().notNull(),
    avatarUrl: text(),
    /** scrypt hash ("scrypt$N$r$p$salt$hash"); null until an invite is accepted. */
    passwordHash: text(),
    isActive: boolean().notNull().default(true),
    mfaEnabled: boolean().notNull().default(false),
    /** TOTP secret encrypted with the server's data key (AES-256-GCM). */
    mfaSecretEnc: text(),
    clientId: uuid(),
    defaultHourlyCostCents: money().notNull().default(0),
    failedLoginCount: integer().notNull().default(0),
    lockedUntil: ts(),
    lastLoginAt: ts(),
    ...audit,
  },
  (t) => [uniqueIndex("users_email_unique").on(sql`lower(${t.email})`), index().on(t.organizationId)],
);

/** Refresh-token sessions (one per device login). Tokens are stored hashed. */
export const sessions = pgTable(
  "sessions",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    refreshTokenHash: text().notNull(),
    /** Previous token hash, kept briefly to detect refresh-token reuse. */
    previousTokenHash: text(),
    deviceName: text(),
    ipAddress: text(),
    userAgent: text(),
    expiresAt: ts().notNull(),
    revokedAt: ts(),
    lastUsedAt: ts().notNull().defaultNow(),
    createdAt: ts().notNull().defaultNow(),
  },
  (t) => [uniqueIndex().on(t.refreshTokenHash), index().on(t.userId)],
);

/** Single-use tokens: password reset, magic link, invitation, MFA ticket. */
export const authTokens = pgTable(
  "auth_tokens",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    purpose: text({ enum: ["password_reset", "magic_link", "invite", "mfa_ticket", "email_verify"] }).notNull(),
    tokenHash: text().notNull(),
    expiresAt: ts().notNull(),
    consumedAt: ts(),
    createdAt: ts().notNull().defaultNow(),
  },
  (t) => [uniqueIndex().on(t.tokenHash), index().on(t.userId, t.purpose)],
);

/**
 * Per-organization adjustments to the code-defined role/permission matrix
 * (see @pool/core ROLE_PERMISSIONS). `granted=false` revokes a default.
 */
export const rolePermissionOverrides = pgTable(
  "role_permission_overrides",
  {
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    role: roleEnum().notNull(),
    permission: text().notNull(),
    granted: boolean().notNull(),
    ...audit,
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.role, t.permission] })],
);

export const teams = pgTable(
  "teams",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text().notNull(),
    kind: text({ enum: ["crew", "office", "design"] }).notNull(),
    leadUserId: uuid().references(() => users.id, { onDelete: "set null" }),
    ...audit,
  },
  (t) => [index().on(t.organizationId)],
);

export const teamMembers = pgTable(
  "team_members",
  {
    teamId: uuid()
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    addedAt: ts().notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.userId] }), index().on(t.userId)],
);

// ---------------------------------------------------------------------------
// Clients & properties
// ---------------------------------------------------------------------------

export const clients = pgTable(
  "clients",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    firstName: text().notNull(),
    lastName: text().notNull(),
    email: text(),
    phone: text(),
    alternatePhone: text(),
    preferredContact: text({ enum: ["email", "phone", "sms"] })
      .notNull()
      .default("phone"),
    mailingAddress: jsonb().$type<Address>(),
    notes: text(),
    ...audit,
    ...syncable,
  },
  (t) => [
    index().on(t.organizationId),
    index().on(t.changeSeq),
    index("clients_search_idx").using(
      "gin",
      sql`to_tsvector('simple', ${t.firstName} || ' ' || ${t.lastName} || ' ' || coalesce(${t.email}, ''))`,
    ),
  ],
);

export const properties = pgTable(
  "properties",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    clientId: uuid()
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    address: jsonb().$type<Address>().notNull(),
    /** Denormalized for search/filtering. */
    city: text().notNull(),
    latitude: doublePrecision(),
    longitude: doublePrecision(),
    locationAccuracyM: doublePrecision(),
    lotWidthFt: doublePrecision(),
    lotDepthFt: doublePrecision(),
    lotAreaSqft: doublePrecision(),
    existingStructures: text(),
    existingPool: text(),
    existingLandscaping: text(),
    utilityLocations: jsonb().$type<UtilityLocation[]>().notNull().default([]),
    accessRestrictions: text(),
    gateWidthIn: doublePrecision(),
    gateNotes: text(),
    equipmentLocation: text(),
    hoaName: text(),
    siteNotes: text(),
    ...audit,
    ...syncable,
  },
  (t) => [index().on(t.organizationId), index().on(t.clientId), index().on(t.changeSeq)],
);

// ---------------------------------------------------------------------------
// Projects, stages, members
// ---------------------------------------------------------------------------

export const stageTemplates = pgTable(
  "stage_templates",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    key: text().notNull(),
    name: text().notNull(),
    sortOrder: integer().notNull(),
    defaultDurationDays: integer().notNull().default(1),
    isMilestone: boolean().notNull().default(false),
    weatherSensitive: boolean().notNull().default(false),
    checklist: jsonb().$type<ChecklistTemplateItem[]>().notNull().default([]),
    isActive: boolean().notNull().default(true),
    ...audit,
  },
  (t) => [uniqueIndex().on(t.organizationId, t.key)],
);

export const projects = pgTable(
  "projects",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    number: text().notNull(),
    name: text().notNull(),
    clientId: uuid()
      .notNull()
      .references(() => clients.id),
    propertyId: uuid()
      .notNull()
      .references(() => properties.id),
    projectManagerId: uuid().references(() => users.id, { onDelete: "set null" }),
    crewTeamId: uuid().references(() => teams.id, { onDelete: "set null" }),
    status: projectStatusEnum().notNull().default("lead"),
    type: projectTypeEnum().notNull(),
    description: text(),
    contractAmountCents: money().notNull().default(0),
    estimatedCostCents: money().notNull().default(0),
    plannedStartDate: date(),
    plannedCompletionDate: date(),
    projectedCompletionDate: date(),
    actualStartDate: date(),
    actualCompletionDate: date(),
    completionPct: integer().notNull().default(0),
    archivedAt: ts(),
    ...audit,
    ...syncable,
  },
  (t) => [
    uniqueIndex().on(t.organizationId, t.number),
    index().on(t.organizationId, t.status),
    index().on(t.projectManagerId),
    index().on(t.clientId),
    index().on(t.changeSeq),
    index("projects_search_idx").using(
      "gin",
      sql`to_tsvector('simple', ${t.name} || ' ' || ${t.number} || ' ' || coalesce(${t.description}, ''))`,
    ),
  ],
);

export const projectMembers = pgTable(
  "project_members",
  {
    projectId: uuid()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: roleEnum().notNull(),
    addedAt: ts().notNull().defaultNow(),
    addedBy: uuid(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.userId] }), index().on(t.userId)],
);

export const projectStages = pgTable(
  "project_stages",
  {
    id: uuid().primaryKey().defaultRandom(),
    projectId: uuid()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    key: text().notNull(),
    name: text().notNull(),
    sortOrder: integer().notNull(),
    status: stageStatusEnum().notNull().default("not_started"),
    isMilestone: boolean().notNull().default(false),
    plannedStartDate: date(),
    plannedEndDate: date(),
    actualStartDate: date(),
    actualEndDate: date(),
    clientVisible: boolean().notNull().default(true),
    ...audit,
    ...syncable,
  },
  (t) => [uniqueIndex().on(t.projectId, t.key), index().on(t.changeSeq)],
);

// ---------------------------------------------------------------------------
// Tasks, dependencies, checklists, notes
// ---------------------------------------------------------------------------

export const tasks = pgTable(
  "tasks",
  {
    id: uuid().primaryKey().defaultRandom(),
    projectId: uuid()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    stageId: uuid().references(() => projectStages.id, { onDelete: "set null" }),
    title: text().notNull(),
    description: text(),
    status: taskStatusEnum().notNull().default("todo"),
    priority: taskPriorityEnum().notNull().default("normal"),
    assigneeId: uuid().references(() => users.id, { onDelete: "set null" }),
    crewTeamId: uuid().references(() => teams.id, { onDelete: "set null" }),
    subcontractorId: uuid(),
    isMilestone: boolean().notNull().default(false),
    plannedStartDate: date(),
    plannedEndDate: date(),
    actualStartDate: date(),
    actualEndDate: date(),
    durationDays: integer().notNull().default(1),
    estimatedHours: doublePrecision(),
    actualHours: doublePrecision().notNull().default(0),
    weatherSensitive: boolean().notNull().default(false),
    dueDate: date(),
    completedAt: ts(),
    completedBy: uuid(),
    completionOverrideReason: text(),
    sourceInspectionId: uuid(),
    sourceChangeOrderId: uuid(),
    ...audit,
    ...syncable,
  },
  (t) => [
    index().on(t.projectId, t.status),
    index().on(t.assigneeId, t.status),
    index().on(t.plannedStartDate),
    index().on(t.dueDate),
    index().on(t.changeSeq),
    index("tasks_search_idx").using("gin", sql`to_tsvector('simple', ${t.title} || ' ' || coalesce(${t.description}, ''))`),
  ],
);

export const taskDependencies = pgTable(
  "task_dependencies",
  {
    id: uuid().primaryKey().defaultRandom(),
    projectId: uuid()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    predecessorId: uuid()
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    successorId: uuid()
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    type: dependencyTypeEnum().notNull().default("FS"),
    lagDays: integer().notNull().default(0),
    ...audit,
    ...syncable,
  },
  (t) => [
    uniqueIndex()
      .on(t.predecessorId, t.successorId)
      .where(sql`${t.deletedAt} is null`),
    index().on(t.projectId),
    index().on(t.changeSeq),
  ],
);

export const checklistItems = pgTable(
  "checklist_items",
  {
    id: uuid().primaryKey().defaultRandom(),
    taskId: uuid()
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    projectId: uuid()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    label: text().notNull(),
    required: boolean().notNull().default(false),
    requiresPhoto: boolean().notNull().default(false),
    sortOrder: integer().notNull().default(0),
    isChecked: boolean().notNull().default(false),
    checkedAt: ts(),
    checkedBy: uuid(),
    ...audit,
    ...syncable,
  },
  (t) => [index().on(t.taskId), index().on(t.changeSeq)],
);

export const taskNotes = pgTable(
  "task_notes",
  {
    id: uuid().primaryKey().defaultRandom(),
    taskId: uuid()
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    projectId: uuid()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    body: text().notNull(),
    isProblem: boolean().notNull().default(false),
    visibility: visibilityEnum().notNull().default("internal"),
    ...audit,
    ...syncable,
  },
  (t) => [index().on(t.taskId), index().on(t.changeSeq)],
);

/** Saved snapshot of planned dates, for schedule variance against the original plan. */
export const scheduleBaselines = pgTable(
  "schedule_baselines",
  {
    id: uuid().primaryKey().defaultRandom(),
    projectId: uuid()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text().notNull(),
    snapshot: jsonb()
      .$type<{ taskId: string; plannedStartDate: string | null; plannedEndDate: string | null }[]>()
      .notNull(),
    plannedCompletionDate: date(),
    ...audit,
  },
  (t) => [index().on(t.projectId)],
);

// ---------------------------------------------------------------------------
// Financials
// ---------------------------------------------------------------------------

export const budgets = pgTable("budgets", {
  id: uuid().primaryKey().defaultRandom(),
  projectId: uuid()
    .notNull()
    .unique()
    .references(() => projects.id, { onDelete: "cascade" }),
  contingencyPct: doublePrecision().notNull().default(5),
  notes: text(),
  ...audit,
  version: integer().notNull().default(1),
});

export const budgetItems = pgTable(
  "budget_items",
  {
    id: uuid().primaryKey().defaultRandom(),
    budgetId: uuid()
      .notNull()
      .references(() => budgets.id, { onDelete: "cascade" }),
    projectId: uuid()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    category: budgetCategoryEnum().notNull(),
    description: text().notNull(),
    quantity: doublePrecision().notNull().default(1),
    unitCostCents: money().notNull(),
    estimatedCents: money().notNull(),
    stageId: uuid().references(() => projectStages.id, { onDelete: "set null" }),
    ...audit,
    version: integer().notNull().default(1),
  },
  (t) => [index().on(t.projectId)],
);

export const vendors = pgTable(
  "vendors",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text().notNull(),
    kind: text({ enum: ["supplier", "subcontractor", "rental", "other"] }).notNull(),
    trade: text(),
    contactName: text(),
    email: text(),
    phone: text(),
    address: jsonb().$type<Address>(),
    latitude: doublePrecision(),
    longitude: doublePrecision(),
    notes: text(),
    isActive: boolean().notNull().default(true),
    /** Portal login for subcontractor staff, if any. */
    portalUserId: uuid(),
    ...audit,
  },
  (t) => [index().on(t.organizationId, t.kind)],
);

export const expenses = pgTable(
  "expenses",
  {
    id: uuid().primaryKey().defaultRandom(),
    projectId: uuid()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    budgetItemId: uuid().references(() => budgetItems.id, { onDelete: "set null" }),
    category: budgetCategoryEnum().notNull(),
    vendorId: uuid().references(() => vendors.id, { onDelete: "set null" }),
    description: text().notNull(),
    amountCents: money().notNull(),
    incurredOn: date().notNull(),
    receiptPhotoId: uuid(),
    changeOrderId: uuid(),
    ...audit,
    ...syncable,
  },
  (t) => [index().on(t.projectId), index().on(t.changeSeq)],
);

export const laborEntries = pgTable(
  "labor_entries",
  {
    id: uuid().primaryKey().defaultRandom(),
    projectId: uuid()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    taskId: uuid().references(() => tasks.id, { onDelete: "set null" }),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    workDate: date().notNull(),
    hours: doublePrecision().notNull(),
    hourlyCostCents: money().notNull(),
    notes: text(),
    ...audit,
    ...syncable,
  },
  (t) => [index().on(t.projectId), index().on(t.userId, t.workDate), index().on(t.taskId), index().on(t.changeSeq)],
);

export const materials = pgTable(
  "materials",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    sku: text(),
    name: text().notNull(),
    category: text().notNull(),
    unit: text().notNull(),
    unitCostCents: money().notNull(),
    preferredVendorId: uuid().references(() => vendors.id, { onDelete: "set null" }),
    ...audit,
  },
  (t) => [
    index().on(t.organizationId),
    index("materials_search_idx").using("gin", sql`to_tsvector('simple', ${t.name} || ' ' || coalesce(${t.sku}, ''))`),
  ],
);

export const materialUsage = pgTable(
  "material_usage",
  {
    id: uuid().primaryKey().defaultRandom(),
    projectId: uuid()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    materialId: uuid()
      .notNull()
      .references(() => materials.id),
    taskId: uuid().references(() => tasks.id, { onDelete: "set null" }),
    quantityPlanned: doublePrecision().notNull().default(0),
    quantityUsed: doublePrecision().notNull().default(0),
    unitCostCents: money().notNull(),
    status: text({ enum: ["planned", "ordered", "delivered", "installed", "returned"] })
      .notNull()
      .default("planned"),
    orderedAt: date(),
    deliveredAt: date(),
    ...audit,
    version: integer().notNull().default(1),
  },
  (t) => [index().on(t.projectId)],
);

export const changeOrders = pgTable(
  "change_orders",
  {
    id: uuid().primaryKey().defaultRandom(),
    projectId: uuid()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    number: integer().notNull(),
    title: text().notNull(),
    description: text().notNull(),
    reason: text(),
    status: changeOrderStatusEnum().notNull().default("draft"),
    costCents: money().notNull().default(0),
    priceCents: money().notNull().default(0),
    laborHoursImpact: doublePrecision().notNull().default(0),
    materialImpact: text(),
    scheduleImpactDays: integer().notNull().default(0),
    submittedAt: ts(),
    decidedAt: ts(),
    decidedBy: uuid(),
    signatureName: text(),
    signatureDataUrl: text(),
    decisionNotes: text(),
    ...audit,
    ...syncable,
  },
  (t) => [uniqueIndex().on(t.projectId, t.number), index().on(t.status), index().on(t.changeSeq)],
);

export const payments = pgTable(
  "payments",
  {
    id: uuid().primaryKey().defaultRandom(),
    projectId: uuid()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    label: text().notNull(),
    amountCents: money().notNull(),
    dueDate: date(),
    status: paymentStatusEnum().notNull().default("scheduled"),
    paidAt: ts(),
    method: text(),
    reference: text(),
    stageId: uuid().references(() => projectStages.id, { onDelete: "set null" }),
    changeOrderId: uuid().references(() => changeOrders.id, { onDelete: "set null" }),
    ...audit,
    version: integer().notNull().default(1),
  },
  (t) => [index().on(t.projectId), index().on(t.status, t.dueDate)],
);

// ---------------------------------------------------------------------------
// Field data: photos, documents, measurements, inspections
// ---------------------------------------------------------------------------

export const photos = pgTable(
  "photos",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: uuid()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    taskId: uuid().references(() => tasks.id, { onDelete: "set null" }),
    stageId: uuid().references(() => projectStages.id, { onDelete: "set null" }),
    inspectionId: uuid(),
    changeOrderId: uuid(),
    measurementId: uuid(),
    checklistItemId: uuid(),
    kind: photoKindEnum().notNull().default("progress"),
    caption: text(),
    takenAt: ts().notNull(),
    latitude: doublePrecision(),
    longitude: doublePrecision(),
    locationAccuracyM: doublePrecision(),
    storageKey: text(),
    thumbnailKey: text(),
    width: integer(),
    height: integer(),
    byteSize: integer(),
    mimeType: text().notNull().default("image/jpeg"),
    visibility: visibilityEnum().notNull().default("internal"),
    uploadStatus: text({ enum: ["pending", "uploaded", "processed", "failed"] })
      .notNull()
      .default("pending"),
    pairedPhotoId: uuid(),
    ...audit,
    ...syncable,
  },
  (t) => [
    index().on(t.projectId, t.takenAt),
    index().on(t.taskId),
    index().on(t.inspectionId),
    index().on(t.changeOrderId),
    index().on(t.changeSeq),
  ],
);

export const documents = pgTable(
  "documents",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: uuid().references(() => projects.id, { onDelete: "cascade" }),
    title: text().notNull(),
    category: documentCategoryEnum().notNull(),
    description: text(),
    visibility: visibilityEnum().notNull().default("internal"),
    currentVersionId: uuid(),
    tags: text().array().notNull().default(sql`'{}'::text[]`),
    availableOffline: boolean().notNull().default(false),
    ...audit,
    ...syncable,
  },
  (t) => [
    index().on(t.organizationId, t.category),
    index().on(t.projectId),
    index().on(t.changeSeq),
    index("documents_search_idx").using(
      "gin",
      sql`to_tsvector('simple', ${t.title} || ' ' || coalesce(${t.description}, ''))`,
    ),
  ],
);

export const documentVersions = pgTable(
  "document_versions",
  {
    id: uuid().primaryKey().defaultRandom(),
    documentId: uuid()
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    versionNumber: integer().notNull(),
    storageKey: text().notNull(),
    fileName: text().notNull(),
    mimeType: text().notNull(),
    byteSize: bigint({ mode: "number" }).notNull(),
    checksumSha256: text(),
    uploadStatus: text({ enum: ["pending", "uploaded"] })
      .notNull()
      .default("pending"),
    uploadedBy: uuid(),
    uploadedAt: ts().notNull().defaultNow(),
    notes: text(),
  },
  (t) => [uniqueIndex().on(t.documentId, t.versionNumber)],
);

export const measurements = pgTable(
  "measurements",
  {
    id: uuid().primaryKey().defaultRandom(),
    projectId: uuid()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    propertyId: uuid().references(() => properties.id, { onDelete: "set null" }),
    category: measurementCategoryEnum().notNull(),
    label: text().notNull(),
    value: doublePrecision().notNull(),
    unit: measurementUnitEnum().notNull(),
    geometry: jsonb().$type<MeasurementGeometry>(),
    latitude: doublePrecision(),
    longitude: doublePrecision(),
    locationAccuracyM: doublePrecision(),
    notes: text(),
    measuredAt: ts().notNull(),
    ...audit,
    ...syncable,
  },
  (t) => [index().on(t.projectId, t.category), index().on(t.changeSeq)],
);

export const inspectionTemplates = pgTable(
  "inspection_templates",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text().notNull(),
    inspectionType: text().notNull(),
    items: jsonb().$type<InspectionTemplateItem[]>().notNull(),
    ...audit,
  },
  (t) => [index().on(t.organizationId)],
);

export const inspections = pgTable(
  "inspections",
  {
    id: uuid().primaryKey().defaultRandom(),
    projectId: uuid()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    stageId: uuid().references(() => projectStages.id, { onDelete: "set null" }),
    templateId: uuid().references(() => inspectionTemplates.id, { onDelete: "set null" }),
    inspectionType: text().notNull(),
    inspectorName: text().notNull(),
    inspectorOrg: text(),
    scheduledFor: date(),
    inspectedAt: ts(),
    result: inspectionResultEnum().notNull().default("pending"),
    items: jsonb().$type<InspectionItemResult[]>().notNull().default([]),
    notes: text(),
    signatureName: text(),
    signatureDataUrl: text(),
    ...audit,
    ...syncable,
  },
  (t) => [index().on(t.projectId), index().on(t.changeSeq)],
);

// ---------------------------------------------------------------------------
// Client experience: approvals, messages
// ---------------------------------------------------------------------------

export const approvals = pgTable(
  "approvals",
  {
    id: uuid().primaryKey().defaultRandom(),
    projectId: uuid()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    subjectType: approvalSubjectEnum().notNull(),
    subjectId: uuid(),
    title: text().notNull(),
    description: text(),
    requestedFrom: uuid().references(() => users.id, { onDelete: "set null" }),
    status: approvalStatusEnum().notNull().default("pending"),
    dueDate: date(),
    decidedAt: ts(),
    decidedBy: uuid(),
    signatureName: text(),
    signatureDataUrl: text(),
    decisionNotes: text(),
    ...audit,
    version: integer().notNull().default(1),
  },
  (t) => [index().on(t.projectId, t.status), index().on(t.requestedFrom, t.status)],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid().primaryKey().defaultRandom(),
    projectId: uuid()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    threadKey: text().notNull().default("general"),
    authorId: uuid()
      .notNull()
      .references(() => users.id),
    body: text().notNull(),
    visibility: visibilityEnum().notNull().default("internal"),
    attachments: jsonb().$type<{ photoId?: string; documentId?: string }[]>().notNull().default([]),
    ...audit,
    ...syncable,
  },
  (t) => [index().on(t.projectId, t.threadKey, t.createdAt), index().on(t.changeSeq)],
);

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export const notifications = pgTable(
  "notifications",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: uuid().references(() => projects.id, { onDelete: "cascade" }),
    type: notificationTypeEnum().notNull(),
    title: text().notNull(),
    body: text().notNull(),
    data: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    /** Dedupe key so recurring scans (weather, overdue) notify only once. */
    dedupeKey: text(),
    readAt: ts(),
    pushedAt: ts(),
    createdAt: ts().notNull().defaultNow(),
  },
  (t) => [
    index().on(t.userId, t.readAt, t.createdAt),
    uniqueIndex()
      .on(t.userId, t.dedupeKey)
      .where(sql`${t.dedupeKey} is not null`),
  ],
);

export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: notificationTypeEnum().notNull(),
    channels: jsonb().$type<NotificationChannel[]>().notNull(),
    enabled: boolean().notNull().default(true),
    updatedAt: ts().notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.type] })],
);

export const pushTokens = pgTable(
  "push_tokens",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text().notNull().unique(),
    platform: text({ enum: ["ios", "android", "web"] }).notNull(),
    deviceId: text().notNull(),
    lastSeenAt: ts().notNull().defaultNow(),
    disabledAt: ts(),
  },
  (t) => [index().on(t.userId)],
);

// ---------------------------------------------------------------------------
// Audit / activity / sync bookkeeping
// ---------------------------------------------------------------------------

export const activityLogs = pgTable(
  "activity_logs",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: uuid().references(() => projects.id, { onDelete: "cascade" }),
    actorId: uuid().references(() => users.id, { onDelete: "set null" }),
    actorName: text(),
    action: activityActionEnum().notNull(),
    entityType: text().notNull(),
    entityId: uuid(),
    summary: text().notNull(),
    metadata: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    clientVisible: boolean().notNull().default(false),
    ipAddress: text(),
    createdAt: ts().notNull().defaultNow(),
    changeSeq: bigint({ mode: "number" })
      .notNull()
      .default(sql`nextval('change_seq')`),
  },
  (t) => [
    index().on(t.projectId, t.createdAt),
    index().on(t.organizationId, t.createdAt),
    index().on(t.changeSeq),
  ],
);

/** Server-side idempotency log for pushed offline operations. */
export const syncOperations = pgTable(
  "sync_operations",
  {
    id: uuid().primaryKey(),
    organizationId: uuid().notNull(),
    userId: uuid().notNull(),
    deviceId: text().notNull(),
    projectId: uuid(),
    entityType: syncEntityTypeEnum().notNull(),
    entityId: uuid().notNull(),
    operation: syncOperationEnum().notNull(),
    status: text({ enum: ["applied", "conflict", "rejected"] }).notNull(),
    resultVersion: integer(),
    errorCode: text(),
    clientCreatedAt: ts().notNull(),
    receivedAt: ts().notNull().defaultNow(),
  },
  (t) => [index().on(t.userId, t.receivedAt), index().on(t.entityType, t.entityId)],
);

/** Deduplicated weather warnings shown on dashboards (never auto-reschedule). */
export const weatherAlerts = pgTable(
  "weather_alerts",
  {
    id: uuid().primaryKey().defaultRandom(),
    projectId: uuid()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    taskId: uuid().references(() => tasks.id, { onDelete: "cascade" }),
    forDate: date().notNull(),
    severity: text({ enum: ["advisory", "warning", "severe"] }).notNull(),
    message: text().notNull(),
    reasons: jsonb().$type<string[]>().notNull().default([]),
    acknowledgedAt: ts(),
    acknowledgedBy: uuid(),
    createdAt: ts().notNull().defaultNow(),
  },
  (t) => [uniqueIndex().on(t.projectId, t.taskId, t.forDate), index().on(t.forDate)],
);

export const savedViews = pgTable(
  "saved_views",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    scope: text({ enum: ["projects", "tasks", "documents", "photos"] }).notNull(),
    name: text().notNull(),
    filters: jsonb().$type<Record<string, unknown>>().notNull(),
    createdAt: ts().notNull().defaultNow(),
  },
  (t) => [index().on(t.userId, t.scope)],
);

// ---------------------------------------------------------------------------
// Design integration
// ---------------------------------------------------------------------------

export const designProjects = pgTable(
  "design_projects",
  {
    id: uuid().primaryKey().defaultRandom(),
    projectId: uuid()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    provider: text().notNull(),
    externalId: text(),
    status: text({ enum: ["draft", "in_review", "approved", "superseded"] })
      .notNull()
      .default("draft"),
    title: text().notNull(),
    summary: jsonb().$type<DesignSummary>(),
    lastSyncedAt: ts(),
    ...audit,
  },
  (t) => [index().on(t.projectId)],
);

export const designModels = pgTable(
  "design_models",
  {
    id: uuid().primaryKey().defaultRandom(),
    designProjectId: uuid()
      .notNull()
      .references(() => designProjects.id, { onDelete: "cascade" }),
    kind: text({ enum: ["model_3d", "rendering", "plan", "landscape_concept", "deck_layout"] }).notNull(),
    title: text().notNull(),
    format: text().notNull(),
    storageKey: text(),
    externalUrl: text(),
    thumbnailKey: text(),
    clientVisible: boolean().notNull().default(true),
    createdAt: ts().notNull().defaultNow(),
    createdBy: uuid(),
  },
  (t) => [index().on(t.designProjectId)],
);

/** Org-level integration credentials (design platforms, accounting, …), encrypted. */
export const integrations = pgTable(
  "integrations",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    provider: text().notNull(),
    kind: text({ enum: ["design", "weather", "accounting", "storage", "ai", "other"] }).notNull(),
    configEnc: text(),
    isEnabled: boolean().notNull().default(true),
    ...audit,
  },
  (t) => [uniqueIndex().on(t.organizationId, t.provider)],
);

// ---------------------------------------------------------------------------
// Relations (for relational queries)
// ---------------------------------------------------------------------------

export const projectsRelations = relations(projects, ({ one, many }) => ({
  organization: one(organizations, { fields: [projects.organizationId], references: [organizations.id] }),
  client: one(clients, { fields: [projects.clientId], references: [clients.id] }),
  property: one(properties, { fields: [projects.propertyId], references: [properties.id] }),
  projectManager: one(users, { fields: [projects.projectManagerId], references: [users.id] }),
  stages: many(projectStages),
  tasks: many(tasks),
  members: many(projectMembers),
}));

export const projectStagesRelations = relations(projectStages, ({ one, many }) => ({
  project: one(projects, { fields: [projectStages.projectId], references: [projects.id] }),
  tasks: many(tasks),
}));

export const tasksRelations = relations(tasks, ({ one, many }) => ({
  project: one(projects, { fields: [tasks.projectId], references: [projects.id] }),
  stage: one(projectStages, { fields: [tasks.stageId], references: [projectStages.id] }),
  assignee: one(users, { fields: [tasks.assigneeId], references: [users.id] }),
  checklist: many(checklistItems),
}));

export const checklistItemsRelations = relations(checklistItems, ({ one }) => ({
  task: one(tasks, { fields: [checklistItems.taskId], references: [tasks.id] }),
}));

export const projectMembersRelations = relations(projectMembers, ({ one }) => ({
  project: one(projects, { fields: [projectMembers.projectId], references: [projects.id] }),
  user: one(users, { fields: [projectMembers.userId], references: [users.id] }),
}));
