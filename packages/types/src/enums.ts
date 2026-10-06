/**
 * Domain enumerations shared by the API, database, mobile app and workers.
 *
 * Every enum is declared as a readonly tuple so it can drive runtime
 * validation (zod), Postgres enum types (drizzle) and TypeScript unions from a
 * single source of truth.
 */

export const ROLES = [
  "admin",
  "project_manager",
  "designer",
  "field_supervisor",
  "field_worker",
  "subcontractor",
  "client",
] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Administrator",
  project_manager: "Project Manager",
  designer: "Designer",
  field_supervisor: "Field Supervisor",
  field_worker: "Field Worker",
  subcontractor: "Subcontractor",
  client: "Client",
};

/** Roles that belong to the contractor's own staff (as opposed to external parties). */
export const INTERNAL_ROLES: readonly Role[] = [
  "admin",
  "project_manager",
  "designer",
  "field_supervisor",
  "field_worker",
];

/**
 * Project lifecycle: Lead → Estimate → Design → Contract → Planning →
 * Scheduling → Procurement → Construction → Inspection → Client Approval →
 * Completed → Warranty. `on_hold` and `cancelled` can be entered from any
 * active phase.
 */
export const PROJECT_STATUSES = [
  "lead",
  "estimate",
  "design",
  "contract",
  "planning",
  "scheduling",
  "procurement",
  "construction",
  "inspection",
  "client_approval",
  "completed",
  "warranty",
  "on_hold",
  "cancelled",
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  lead: "Lead",
  estimate: "Estimate",
  design: "Design",
  contract: "Contract",
  planning: "Planning",
  scheduling: "Scheduling",
  procurement: "Procurement",
  construction: "Construction",
  inspection: "Inspection",
  client_approval: "Client Approval",
  completed: "Completed",
  warranty: "Warranty",
  on_hold: "On Hold",
  cancelled: "Cancelled",
};

/** Statuses considered "active work" for dashboards and filters. */
export const ACTIVE_PROJECT_STATUSES: readonly ProjectStatus[] = [
  "planning",
  "scheduling",
  "procurement",
  "construction",
  "inspection",
  "client_approval",
];

export const UPCOMING_PROJECT_STATUSES: readonly ProjectStatus[] = [
  "lead",
  "estimate",
  "design",
  "contract",
];

export const PROJECT_TYPES = [
  "new_construction",
  "renovation",
  "remodel",
  "spa",
  "repair",
  "equipment_upgrade",
  "commercial",
] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];

export const PROJECT_TYPE_LABELS: Record<ProjectType, string> = {
  new_construction: "New Construction",
  renovation: "Renovation",
  remodel: "Remodel",
  spa: "Spa",
  repair: "Repair",
  equipment_upgrade: "Equipment Upgrade",
  commercial: "Commercial",
};

export const STAGE_STATUSES = ["not_started", "in_progress", "completed", "skipped"] as const;
export type StageStatus = (typeof STAGE_STATUSES)[number];

export const TASK_STATUSES = ["todo", "in_progress", "blocked", "done", "cancelled"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "To Do",
  in_progress: "In Progress",
  blocked: "Blocked",
  done: "Done",
  cancelled: "Cancelled",
};

export const TASK_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/**
 * Dependency types between schedulable items.
 * - FS: successor starts after predecessor finishes (most common).
 * - SS: successor starts after predecessor starts.
 * - FF: successor finishes after predecessor finishes.
 */
export const DEPENDENCY_TYPES = ["FS", "SS", "FF"] as const;
export type DependencyType = (typeof DEPENDENCY_TYPES)[number];

export const CHANGE_ORDER_STATUSES = [
  "draft",
  "submitted",
  "client_review",
  "approved",
  "rejected",
  "scheduled",
  "completed",
  "void",
] as const;
export type ChangeOrderStatus = (typeof CHANGE_ORDER_STATUSES)[number];

export const CHANGE_ORDER_STATUS_LABELS: Record<ChangeOrderStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  client_review: "Client Review",
  approved: "Approved",
  rejected: "Rejected",
  scheduled: "Scheduled",
  completed: "Completed",
  void: "Void",
};

export const BUDGET_CATEGORIES = [
  "labor",
  "materials",
  "equipment",
  "subcontractor",
  "permits",
  "overhead",
  "other",
] as const;
export type BudgetCategory = (typeof BUDGET_CATEGORIES)[number];

export const BUDGET_CATEGORY_LABELS: Record<BudgetCategory, string> = {
  labor: "Labor",
  materials: "Materials",
  equipment: "Equipment",
  subcontractor: "Subcontractors",
  permits: "Permits & Fees",
  overhead: "Overhead",
  other: "Other",
};

export const PHOTO_KINDS = ["progress", "before", "after", "problem", "inspection", "client"] as const;
export type PhotoKind = (typeof PHOTO_KINDS)[number];

export const DOCUMENT_CATEGORIES = [
  "blueprint",
  "site_plan",
  "engineering",
  "permit",
  "contract",
  "specification",
  "manual",
  "warranty",
  "invoice",
  "other",
] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export const DOCUMENT_CATEGORY_LABELS: Record<DocumentCategory, string> = {
  blueprint: "Blueprints",
  site_plan: "Site Plans",
  engineering: "Engineering",
  permit: "Permits",
  contract: "Contracts",
  specification: "Specifications",
  manual: "Product Manuals",
  warranty: "Warranty",
  invoice: "Invoices",
  other: "Other",
};

/** Who may see a document/photo/message. `internal` is never shown to clients. */
export const VISIBILITIES = ["internal", "client"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export const MEASUREMENT_CATEGORIES = [
  "pool",
  "depth",
  "elevation",
  "deck",
  "equipment",
  "plumbing",
  "electrical",
  "property",
  "other",
] as const;
export type MeasurementCategory = (typeof MEASUREMENT_CATEGORIES)[number];

export const MEASUREMENT_UNITS = ["in", "ft", "cm", "m", "sqft", "sqm", "gal", "l", "psi", "deg"] as const;
export type MeasurementUnit = (typeof MEASUREMENT_UNITS)[number];

export const INSPECTION_RESULTS = ["pending", "pass", "fail", "partial"] as const;
export type InspectionResult = (typeof INSPECTION_RESULTS)[number];

export const APPROVAL_STATUSES = ["pending", "approved", "rejected", "cancelled"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const APPROVAL_SUBJECTS = ["change_order", "design", "document", "milestone", "walkthrough", "other"] as const;
export type ApprovalSubject = (typeof APPROVAL_SUBJECTS)[number];

export const PAYMENT_STATUSES = ["scheduled", "invoiced", "paid", "overdue", "void"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const NOTIFICATION_TYPES = [
  "task_assigned",
  "task_overdue",
  "schedule_changed",
  "change_order_approved",
  "change_order_rejected",
  "approval_requested",
  "message_received",
  "inspection_failed",
  "budget_threshold",
  "weather_warning",
  "milestone_completed",
  "sync_failed",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  task_assigned: "New task assigned",
  task_overdue: "Task overdue",
  schedule_changed: "Schedule changed",
  change_order_approved: "Change order approved",
  change_order_rejected: "Change order rejected",
  approval_requested: "Approval requested",
  message_received: "New message",
  inspection_failed: "Inspection failed",
  budget_threshold: "Budget threshold exceeded",
  weather_warning: "Weather warning",
  milestone_completed: "Milestone completed",
  sync_failed: "Sync failed",
};

export const NOTIFICATION_CHANNELS = ["push", "email", "in_app"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/** Entities that participate in offline synchronization. */
export const SYNC_ENTITY_TYPES = [
  "task",
  "checklist_item",
  "task_note",
  "labor_entry",
  "expense",
  "measurement",
  "photo",
  "inspection",
  "message",
] as const;
export type SyncEntityType = (typeof SYNC_ENTITY_TYPES)[number];

/** Entities that the mobile client pulls into its local database (read models). */
export const PULL_ENTITY_TYPES = [
  "project",
  "client",
  "property",
  "stage",
  "task",
  "task_dependency",
  "checklist_item",
  "task_note",
  "labor_entry",
  "expense",
  "measurement",
  "photo",
  "inspection",
  "document",
  "change_order",
  "message",
  "activity",
] as const;
export type PullEntityType = (typeof PULL_ENTITY_TYPES)[number];

export const SYNC_OPERATIONS = ["create", "update", "delete"] as const;
export type SyncOperationKind = (typeof SYNC_OPERATIONS)[number];

export const SYNC_STATUSES = ["pending", "in_flight", "synced", "failed", "conflict"] as const;
export type SyncStatus = (typeof SYNC_STATUSES)[number];

export const ACTIVITY_ACTIONS = [
  "project.created",
  "project.updated",
  "project.status_changed",
  "stage.updated",
  "task.created",
  "task.updated",
  "task.completed",
  "task.assigned",
  "task.problem_reported",
  "schedule.shifted",
  "photo.uploaded",
  "document.uploaded",
  "measurement.recorded",
  "inspection.recorded",
  "inspection.failed",
  "change_order.created",
  "change_order.status_changed",
  "approval.requested",
  "approval.decided",
  "payment.recorded",
  "expense.recorded",
  "labor.recorded",
  "message.sent",
  "client.created",
  "property.updated",
] as const;
export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number];
