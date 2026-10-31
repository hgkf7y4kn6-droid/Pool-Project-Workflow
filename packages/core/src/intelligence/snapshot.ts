import type {
  AgentKey,
  ApprovalStatus,
  ApprovalSubject,
  ChangeOrderStatus,
  Confidence,
  DependencyType,
  DocumentCategory,
  Evidence,
  EvidenceType,
  ImpactRef,
  InspectionResult,
  PermitStatus,
  ProjectStatus,
  ProposedAction,
  ResponsibleRole,
  Severity,
  StageStatus,
  TaskPriority,
  TaskStatus,
} from "@pool/types";

/**
 * Everything the rules engine knows about one project, assembled by the API
 * from records the evaluating principal may read. The engine is pure: the
 * same snapshot and settings always produce the same findings.
 */
export interface IntelligenceSnapshot {
  today: string;
  project: {
    id: string;
    name: string;
    number: string;
    status: ProjectStatus;
    projectManagerId: string | null;
    plannedStartDate: string | null;
    plannedCompletionDate: string | null;
    projectedCompletionDate: string | null;
    actualCompletionDate: string | null;
    /** Latest activity-log entry of any kind. */
    lastActivityAt: string | null;
    /** Latest client-visible message or activity (what the homeowner last heard). */
    lastClientUpdateAt: string | null;
    /** Latest schedule shift or projected-completion change. */
    lastScheduleChangeAt: string | null;
    createdAt: string;
  };
  stages: {
    id: string;
    key: string;
    name: string;
    sortOrder: number;
    status: StageStatus;
    plannedStartDate: string | null;
    plannedEndDate: string | null;
    actualStartDate: string | null;
    actualEndDate: string | null;
    /** Shown on the homeowner's timeline; only these reach homeowner drafts. */
    clientVisible: boolean;
  }[];
  tasks: {
    id: string;
    title: string;
    stageId: string | null;
    status: TaskStatus;
    priority: TaskPriority;
    assigneeId: string | null;
    crewTeamId: string | null;
    subcontractorId: string | null;
    isMilestone: boolean;
    plannedStartDate: string | null;
    plannedEndDate: string | null;
    actualStartDate: string | null;
    actualEndDate: string | null;
    durationDays: number;
    dueDate: string | null;
    weatherSensitive: boolean;
    sourceInspectionId: string | null;
  }[];
  dependencies: { id: string; predecessorId: string; successorId: string; type: DependencyType; lagDays: number }[];
  checklist: { id: string; taskId: string; label: string; required: boolean; requiresPhoto: boolean; isChecked: boolean; hasPhoto: boolean }[];
  inspections: { id: string; stageId: string | null; inspectionType: string; result: InspectionResult; scheduledFor: string | null; inspectedAt: string | null; createdAt: string }[];
  permits: {
    id: string;
    stageId: string | null;
    permitType: string;
    jurisdiction: string;
    permitNumber: string | null;
    status: PermitStatus;
    issuedOn: string | null;
    expiresOn: string | null;
  }[];
  approvals: { id: string; subjectType: ApprovalSubject; title: string; status: ApprovalStatus; dueDate: string | null; createdAt: string }[];
  changeOrders: { id: string; number: number; title: string; status: ChangeOrderStatus; scheduleImpactDays: number; submittedAt: string | null }[];
  materials: {
    id: string;
    name: string;
    taskId: string | null;
    status: "planned" | "ordered" | "delivered" | "installed" | "returned";
    orderedAt: string | null;
    deliveredAt: string | null;
    requiredBy: string | null;
    expectedDeliveryDate: string | null;
    deliveryConfirmedAt: string | null;
    leadTimeDays: number | null;
    vendorName: string | null;
  }[];
  documents: { id: string; category: DocumentCategory; title: string }[];
  weatherAlerts: { id: string; taskId: string | null; date: string; summary: string }[];
  /** Display names for users, crews and subcontractors referenced above. */
  names: Record<string, string>;
  recentActivity: { id: string; summary: string; createdAt: string }[];
  /** Completed-stage durations across the organization, keyed by stage key (only keys with ≥5 samples). */
  stageHistory: Record<string, { sampleSize: number; medianDays: number; p80Days: number }>;
}

/** A rule's output before it is persisted as a recommendation. */
export interface Finding {
  ruleKey: string;
  agent: AgentKey;
  category: string;
  /** Stable identity: the same condition on the same records yields the same key. */
  dedupeKey: string;
  severity: Severity;
  confidence: Confidence;
  title: string;
  observation: string;
  risk: string;
  recommendedAction: string;
  responsibleRole: ResponsibleRole;
  assigneeId: string | null;
  suggestedDueDate: string | null;
  dueRationale: string;
  subject: { type: EvidenceType; id: string };
  stageId: string | null;
  evidence: Evidence[];
  impact: ImpactRef[];
  /** True when the finding is about absent data rather than a negative fact. */
  missingData: boolean;
  requiresApproval: boolean;
  proposedAction: ProposedAction | null;
  reevaluateWhen: string;
  expiresAt: string | null;
}
