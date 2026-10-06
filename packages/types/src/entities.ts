import type {
  ApprovalStatus,
  ApprovalSubject,
  BudgetCategory,
  ChangeOrderStatus,
  DependencyType,
  DocumentCategory,
  InspectionResult,
  MeasurementCategory,
  MeasurementUnit,
  NotificationChannel,
  NotificationType,
  PaymentStatus,
  PhotoKind,
  ProjectStatus,
  ProjectType,
  Role,
  StageStatus,
  TaskPriority,
  TaskStatus,
  Visibility,
  ActivityAction,
} from "./enums";

/**
 * Conventions
 * - IDs are UUID strings (client-generatable for offline creation).
 * - Money is stored and transferred as integer cents (`*Cents`).
 * - Timestamps are ISO-8601 strings; calendar dates are `YYYY-MM-DD`.
 * - `version` increments on every server-side write and is used for
 *   optimistic concurrency / sync conflict detection.
 */
export type UUID = string;
export type ISODateTime = string;
export type ISODate = string;
export type Cents = number;

export interface Audited {
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  createdBy: UUID | null;
  updatedBy: UUID | null;
}

export interface Versioned {
  version: number;
}

export interface GeoPoint {
  latitude: number;
  longitude: number;
  accuracyMeters?: number | null;
}

export interface Address {
  line1: string;
  line2?: string | null;
  city: string;
  region: string;
  postalCode: string;
  country: string;
}

export interface Organization extends Audited {
  id: UUID;
  name: string;
  slug: string;
  timezone: string;
  currency: string;
  settings: OrganizationSettings;
}

export interface OrganizationSettings {
  /** Percentage of budget consumed (0-100) that triggers a budget alert. */
  budgetAlertThresholdPct: number;
  /** Whether clients may see the project budget totals (never internal costs). */
  clientCanSeeContractAmount: boolean;
  /** Whether field workers' location may be shared with supervisors. */
  crewLocationSharingEnabled: boolean;
  /** Default weather thresholds used for schedule warnings. */
  weather: {
    rainProbabilityPct: number;
    windSpeedKph: number;
    minTempC: number;
    maxTempC: number;
  };
}

export interface User extends Audited {
  id: UUID;
  organizationId: UUID;
  email: string;
  fullName: string;
  phone: string | null;
  role: Role;
  avatarUrl: string | null;
  isActive: boolean;
  mfaEnabled: boolean;
  /** Set when the user is a client portal user. */
  clientId: UUID | null;
  lastLoginAt: ISODateTime | null;
}

export interface Team extends Audited {
  id: UUID;
  organizationId: UUID;
  name: string;
  kind: "crew" | "office" | "design";
  leadUserId: UUID | null;
  memberIds: UUID[];
}

export interface Client extends Audited, Versioned {
  id: UUID;
  organizationId: UUID;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  alternatePhone: string | null;
  preferredContact: "email" | "phone" | "sms";
  mailingAddress: Address | null;
  notes: string | null;
}

export interface Property extends Audited, Versioned {
  id: UUID;
  organizationId: UUID;
  clientId: UUID;
  address: Address;
  location: GeoPoint | null;
  lotWidthFt: number | null;
  lotDepthFt: number | null;
  lotAreaSqft: number | null;
  existingStructures: string | null;
  existingPool: string | null;
  existingLandscaping: string | null;
  utilityLocations: UtilityLocation[];
  accessRestrictions: string | null;
  gateWidthIn: number | null;
  gateNotes: string | null;
  equipmentLocation: string | null;
  hoaName: string | null;
  siteNotes: string | null;
}

export interface UtilityLocation {
  kind: "gas" | "electric" | "water" | "sewer" | "septic" | "irrigation" | "telecom" | "other";
  description: string;
  location?: GeoPoint | null;
  markedAt?: ISODate | null;
}

export interface Project extends Audited, Versioned {
  id: UUID;
  organizationId: UUID;
  number: string;
  name: string;
  clientId: UUID;
  propertyId: UUID;
  projectManagerId: UUID | null;
  crewTeamId: UUID | null;
  status: ProjectStatus;
  type: ProjectType;
  description: string | null;
  contractAmountCents: Cents;
  estimatedCostCents: Cents;
  plannedStartDate: ISODate | null;
  plannedCompletionDate: ISODate | null;
  projectedCompletionDate: ISODate | null;
  actualStartDate: ISODate | null;
  actualCompletionDate: ISODate | null;
  completionPct: number;
  archivedAt: ISODateTime | null;
  /** Denormalized for list views / offline display. */
  clientName?: string;
  propertyAddress?: string;
  projectManagerName?: string | null;
}

export interface ProjectMember {
  projectId: UUID;
  userId: UUID;
  role: Role;
  addedAt: ISODateTime;
}

export interface StageTemplate {
  id: UUID;
  organizationId: UUID;
  name: string;
  key: string;
  sortOrder: number;
  defaultDurationDays: number;
  isMilestone: boolean;
  checklist: ChecklistTemplateItem[];
}

export interface ProjectStage extends Audited, Versioned {
  id: UUID;
  projectId: UUID;
  key: string;
  name: string;
  sortOrder: number;
  status: StageStatus;
  isMilestone: boolean;
  plannedStartDate: ISODate | null;
  plannedEndDate: ISODate | null;
  actualStartDate: ISODate | null;
  actualEndDate: ISODate | null;
  clientVisible: boolean;
}

export interface ChecklistTemplateItem {
  label: string;
  required: boolean;
  requiresPhoto?: boolean;
}

export interface Task extends Audited, Versioned {
  id: UUID;
  projectId: UUID;
  stageId: UUID | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeId: UUID | null;
  crewTeamId: UUID | null;
  subcontractorId: UUID | null;
  isMilestone: boolean;
  plannedStartDate: ISODate | null;
  plannedEndDate: ISODate | null;
  actualStartDate: ISODate | null;
  actualEndDate: ISODate | null;
  durationDays: number;
  estimatedHours: number | null;
  actualHours: number;
  weatherSensitive: boolean;
  dueDate: ISODate | null;
  completedAt: ISODateTime | null;
  completedBy: UUID | null;
  sourceInspectionId: UUID | null;
  sourceChangeOrderId: UUID | null;
  deletedAt: ISODateTime | null;
  assigneeName?: string | null;
}

export interface TaskDependency {
  id: UUID;
  projectId: UUID;
  predecessorId: UUID;
  successorId: UUID;
  type: DependencyType;
  lagDays: number;
}

export interface ChecklistItem extends Audited, Versioned {
  id: UUID;
  taskId: UUID;
  label: string;
  required: boolean;
  requiresPhoto: boolean;
  sortOrder: number;
  isChecked: boolean;
  checkedAt: ISODateTime | null;
  checkedBy: UUID | null;
  deletedAt: ISODateTime | null;
}

export interface TaskNote extends Audited, Versioned {
  id: UUID;
  taskId: UUID;
  projectId: UUID;
  body: string;
  isProblem: boolean;
  visibility: Visibility;
  deletedAt: ISODateTime | null;
  authorName?: string;
}

export interface Budget extends Audited, Versioned {
  id: UUID;
  projectId: UUID;
  contingencyPct: number;
  notes: string | null;
}

export interface BudgetItem extends Audited, Versioned {
  id: UUID;
  budgetId: UUID;
  projectId: UUID;
  category: BudgetCategory;
  description: string;
  quantity: number;
  unitCostCents: Cents;
  estimatedCents: Cents;
  stageId: UUID | null;
}

export interface Expense extends Audited, Versioned {
  id: UUID;
  projectId: UUID;
  budgetItemId: UUID | null;
  category: BudgetCategory;
  vendorId: UUID | null;
  description: string;
  amountCents: Cents;
  incurredOn: ISODate;
  receiptPhotoId: UUID | null;
  changeOrderId: UUID | null;
  deletedAt: ISODateTime | null;
}

export interface LaborEntry extends Audited, Versioned {
  id: UUID;
  projectId: UUID;
  taskId: UUID | null;
  userId: UUID;
  workDate: ISODate;
  hours: number;
  hourlyCostCents: Cents;
  notes: string | null;
  deletedAt: ISODateTime | null;
}

export interface Vendor extends Audited {
  id: UUID;
  organizationId: UUID;
  name: string;
  kind: "supplier" | "subcontractor" | "rental" | "other";
  trade: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  address: Address | null;
  location: GeoPoint | null;
  notes: string | null;
  isActive: boolean;
}

export interface Material extends Audited {
  id: UUID;
  organizationId: UUID;
  sku: string | null;
  name: string;
  category: string;
  unit: string;
  unitCostCents: Cents;
  preferredVendorId: UUID | null;
}

export interface MaterialUsage extends Audited, Versioned {
  id: UUID;
  projectId: UUID;
  materialId: UUID;
  taskId: UUID | null;
  quantityPlanned: number;
  quantityUsed: number;
  unitCostCents: Cents;
  status: "planned" | "ordered" | "delivered" | "installed" | "returned";
  orderedAt: ISODate | null;
  deliveredAt: ISODate | null;
  materialName?: string;
  unit?: string;
}

export interface ChangeOrder extends Audited, Versioned {
  id: UUID;
  projectId: UUID;
  number: number;
  title: string;
  description: string;
  reason: string | null;
  status: ChangeOrderStatus;
  costCents: Cents;
  priceCents: Cents;
  laborHoursImpact: number;
  materialImpact: string | null;
  scheduleImpactDays: number;
  submittedAt: ISODateTime | null;
  decidedAt: ISODateTime | null;
  decidedBy: UUID | null;
  signatureName: string | null;
  signatureDataUrl: string | null;
  decisionNotes: string | null;
}

export interface Photo extends Audited, Versioned {
  id: UUID;
  projectId: UUID;
  taskId: UUID | null;
  stageId: UUID | null;
  inspectionId: UUID | null;
  changeOrderId: UUID | null;
  measurementId: UUID | null;
  checklistItemId: UUID | null;
  kind: PhotoKind;
  caption: string | null;
  takenAt: ISODateTime;
  location: GeoPoint | null;
  storageKey: string | null;
  thumbnailKey: string | null;
  width: number | null;
  height: number | null;
  byteSize: number | null;
  mimeType: string;
  visibility: Visibility;
  uploadStatus: "pending" | "uploaded" | "processed" | "failed";
  pairedPhotoId: UUID | null;
  deletedAt: ISODateTime | null;
  url?: string | null;
  thumbnailUrl?: string | null;
}

export interface DocumentRecord extends Audited, Versioned {
  id: UUID;
  organizationId: UUID;
  projectId: UUID | null;
  title: string;
  category: DocumentCategory;
  description: string | null;
  visibility: Visibility;
  currentVersionId: UUID | null;
  tags: string[];
  availableOffline: boolean;
  deletedAt: ISODateTime | null;
  currentVersion?: DocumentVersion | null;
}

export interface DocumentVersion {
  id: UUID;
  documentId: UUID;
  versionNumber: number;
  storageKey: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  checksumSha256: string | null;
  uploadedBy: UUID | null;
  uploadedAt: ISODateTime;
  notes: string | null;
}

export interface Measurement extends Audited, Versioned {
  id: UUID;
  projectId: UUID;
  propertyId: UUID | null;
  category: MeasurementCategory;
  label: string;
  value: number;
  unit: MeasurementUnit;
  /** Optional structured data for CAD export (e.g. polygon points, depth profile). */
  geometry: MeasurementGeometry | null;
  location: GeoPoint | null;
  notes: string | null;
  measuredAt: ISODateTime;
  deletedAt: ISODateTime | null;
}

/**
 * CAD-friendly geometry. Coordinates are in the measurement's unit relative to
 * a site datum (0,0,0) chosen by the field team (e.g. house corner).
 */
export type MeasurementGeometry =
  | { type: "point"; x: number; y: number; z?: number }
  | { type: "line"; points: number[][] }
  | { type: "polygon"; points: number[][] }
  | { type: "profile"; stations: { distance: number; depth: number }[] };

export interface InspectionTemplate {
  id: UUID;
  organizationId: UUID;
  name: string;
  inspectionType: string;
  items: InspectionTemplateItem[];
}

export interface InspectionTemplateItem {
  key: string;
  label: string;
  required: boolean;
}

export interface InspectionItemResult {
  key: string;
  label: string;
  result: "pass" | "fail" | "na" | "pending";
  notes?: string | null;
  correctiveAction?: string | null;
}

export interface Inspection extends Audited, Versioned {
  id: UUID;
  projectId: UUID;
  stageId: UUID | null;
  templateId: UUID | null;
  inspectionType: string;
  inspectorName: string;
  inspectorOrg: string | null;
  scheduledFor: ISODate | null;
  inspectedAt: ISODateTime | null;
  result: InspectionResult;
  items: InspectionItemResult[];
  notes: string | null;
  signatureName: string | null;
  signatureDataUrl: string | null;
  deletedAt: ISODateTime | null;
}

export interface Approval extends Audited, Versioned {
  id: UUID;
  projectId: UUID;
  subjectType: ApprovalSubject;
  subjectId: UUID | null;
  title: string;
  description: string | null;
  requestedFrom: UUID | null;
  status: ApprovalStatus;
  dueDate: ISODate | null;
  decidedAt: ISODateTime | null;
  decidedBy: UUID | null;
  signatureName: string | null;
  signatureDataUrl: string | null;
  decisionNotes: string | null;
}

export interface Payment extends Audited, Versioned {
  id: UUID;
  projectId: UUID;
  label: string;
  amountCents: Cents;
  dueDate: ISODate | null;
  status: PaymentStatus;
  paidAt: ISODateTime | null;
  method: string | null;
  reference: string | null;
  stageId: UUID | null;
  changeOrderId: UUID | null;
}

export interface Notification {
  id: UUID;
  userId: UUID;
  organizationId: UUID;
  projectId: UUID | null;
  type: NotificationType;
  title: string;
  body: string;
  data: Record<string, unknown>;
  readAt: ISODateTime | null;
  createdAt: ISODateTime;
}

export interface NotificationPreference {
  userId: UUID;
  type: NotificationType;
  channels: NotificationChannel[];
  enabled: boolean;
}

export interface Message extends Audited, Versioned {
  id: UUID;
  projectId: UUID;
  threadKey: string;
  authorId: UUID;
  body: string;
  visibility: Visibility;
  attachments: { photoId?: UUID; documentId?: UUID }[];
  deletedAt: ISODateTime | null;
  authorName?: string;
}

export interface ActivityLog {
  id: UUID;
  organizationId: UUID;
  projectId: UUID | null;
  actorId: UUID | null;
  actorName: string | null;
  action: ActivityAction;
  entityType: string;
  entityId: UUID | null;
  summary: string;
  metadata: Record<string, unknown>;
  clientVisible: boolean;
  createdAt: ISODateTime;
}

export interface DesignProject extends Audited {
  id: UUID;
  projectId: UUID;
  provider: string;
  externalId: string | null;
  status: "draft" | "in_review" | "approved" | "superseded";
  title: string;
  summary: DesignSummary | null;
  lastSyncedAt: ISODateTime | null;
}

export interface DesignSummary {
  poolShape?: string;
  lengthFt?: number;
  widthFt?: number;
  shallowDepthFt?: number;
  deepDepthFt?: number;
  surfaceAreaSqft?: number;
  volumeGallons?: number;
  deckAreaSqft?: number;
  features?: string[];
  equipment?: { name: string; location?: string }[];
}

export interface DesignModel {
  id: UUID;
  designProjectId: UUID;
  kind: "model_3d" | "rendering" | "plan" | "landscape_concept" | "deck_layout";
  title: string;
  format: string;
  storageKey: string | null;
  externalUrl: string | null;
  thumbnailKey: string | null;
  createdAt: ISODateTime;
  url?: string | null;
}
