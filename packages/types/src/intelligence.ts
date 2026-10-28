import type { ISODate, ISODateTime, UUID } from "./entities";
import type { Role } from "./enums";

/*
 * Project intelligence: shared vocabulary for the rules engine (@pool/core),
 * the API, the CrewAI service contract and the app. See docs/intelligence.md.
 */

export const AGENT_KEYS = ["superintendent", "schedule", "readiness", "communication", "procurement", "closeout"] as const;
export type AgentKey = (typeof AGENT_KEYS)[number];

export const AGENT_LABELS: Record<AgentKey, string> = {
  superintendent: "Project Superintendent",
  schedule: "Schedule & Delay Prevention",
  readiness: "Readiness & Quality",
  communication: "Homeowner Communication",
  procurement: "Procurement & Subcontractors",
  closeout: "Closeout & Warranty",
};

export const SEVERITIES = ["critical", "high", "medium", "low"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const SEVERITY_LABELS: Record<Severity, string> = { critical: "Critical", high: "High", medium: "Medium", low: "Low" };

/** Lower is more urgent; used for sorting and thresholds. */
export const SEVERITY_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export const CONFIDENCES = ["high", "medium", "low"] as const;
export type Confidence = (typeof CONFIDENCES)[number];

export const RECOMMENDATION_STATUSES = [
  "open",
  "acknowledged",
  "in_progress",
  "snoozed",
  "escalated",
  "resolved",
  "dismissed",
  "superseded",
  "expired",
] as const;
export type RecommendationStatus = (typeof RECOMMENDATION_STATUSES)[number];

/** Statuses that still need someone's attention. */
export const ACTIVE_RECOMMENDATION_STATUSES: readonly RecommendationStatus[] = ["open", "acknowledged", "in_progress", "snoozed", "escalated"];

export const RECOMMENDATION_STATUS_LABELS: Record<RecommendationStatus, string> = {
  open: "Open",
  acknowledged: "Acknowledged",
  in_progress: "In progress",
  snoozed: "Snoozed",
  escalated: "Escalated",
  resolved: "Resolved",
  dismissed: "Dismissed",
  superseded: "Superseded",
  expired: "Expired",
};

export const DISMISS_REASONS = ["not_applicable", "already_handled", "data_incorrect", "accepted_risk", "duplicate", "other"] as const;
export type DismissReason = (typeof DISMISS_REASONS)[number];

export const DISMISS_REASON_LABELS: Record<DismissReason, string> = {
  not_applicable: "Doesn't apply to this project",
  already_handled: "Already handled outside the app",
  data_incorrect: "The project data is wrong",
  accepted_risk: "Risk accepted",
  duplicate: "Duplicate",
  other: "Other",
};

export const EVIDENCE_TYPES = [
  "project",
  "stage",
  "task",
  "dependency",
  "checklist_item",
  "inspection",
  "approval",
  "change_order",
  "material",
  "document",
  "photo",
  "weather_alert",
  "message",
  "activity",
] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

export interface Evidence {
  type: EvidenceType;
  id: UUID;
  label: string;
  /** The observed fact, e.g. "status todo, planned end 2026-05-02". */
  detail: string;
}

export interface ImpactRef {
  type: EvidenceType;
  id: UUID;
  label: string;
}

/** Actions an agent or rule may *propose*. They only run after human approval. */
export const PROPOSED_ACTION_TYPES = ["create_task", "request_approval", "draft_message"] as const;
export type ProposedActionType = (typeof PROPOSED_ACTION_TYPES)[number];

export type ProposedAction =
  | { type: "create_task"; title: string; stageId: UUID | null; dueDate: ISODate | null; description?: string }
  | { type: "request_approval"; title: string; subjectType: "milestone" | "design" | "document" | "walkthrough" | "other"; dueDate: ISODate | null }
  | { type: "draft_message"; audience: CommunicationAudience; kind: CommunicationKind };

export type ResponsibleRole = Extract<Role, "admin" | "project_manager" | "designer" | "field_supervisor"> | "office";

export interface Recommendation {
  id: UUID;
  projectId: UUID;
  projectName: string;
  projectNumber: string;
  agent: AgentKey;
  ruleKey: string;
  category: string;
  severity: Severity;
  confidence: Confidence;
  title: string;
  observation: string;
  risk: string;
  recommendedAction: string;
  responsibleRole: ResponsibleRole;
  assigneeId: UUID | null;
  assigneeName: string | null;
  suggestedDueDate: ISODate | null;
  dueRationale: string;
  subjectType: EvidenceType;
  subjectId: UUID;
  stageId: UUID | null;
  evidence: Evidence[];
  impact: ImpactRef[];
  missingData: boolean;
  requiresApproval: boolean;
  proposedAction: ProposedAction | null;
  actionResult: { entityType: string; entityId: UUID } | null;
  status: RecommendationStatus;
  snoozedUntil: ISODateTime | null;
  escalationLevel: number;
  reevaluateWhen: string;
  expiresAt: ISODate | null;
  firstDetectedAt: ISODateTime;
  lastDetectedAt: ISODateTime;
  resolvedAt: ISODateTime | null;
  resolutionNote: string | null;
  dismissReason: DismissReason | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface RecommendationEvent {
  id: UUID;
  action: string;
  fromStatus: RecommendationStatus | null;
  toStatus: RecommendationStatus | null;
  actorId: UUID | null;
  actorName: string | null;
  /** Set when an automation (not a person) made the change, e.g. "rules:auto_resolve". */
  automationPolicy: string | null;
  note: string | null;
  createdAt: ISODateTime;
}

// ---------------------------------------------------------------------------
// Readiness
// ---------------------------------------------------------------------------

export const READINESS_FACTORS = [
  "prerequisites",
  "permits",
  "inspections",
  "materials",
  "crew",
  "decisions",
  "documentation",
  "weather",
  "schedule",
] as const;
export type ReadinessFactorKey = (typeof READINESS_FACTORS)[number];

export const READINESS_FACTOR_LABELS: Record<ReadinessFactorKey, string> = {
  prerequisites: "Prerequisite work",
  permits: "Permits",
  inspections: "Inspections",
  materials: "Materials & equipment",
  crew: "Crew & subcontractors",
  decisions: "Homeowner decisions",
  documentation: "Documentation & photos",
  weather: "Weather",
  schedule: "Schedule",
};

/** `unknown` means the records needed to judge this factor are missing — not a failure. */
export type FactorState = "ready" | "at_risk" | "blocked" | "unknown";
export type ReadinessLabel = "ready" | "at_risk" | "blocked" | "no_upcoming_milestone";

export interface ReadinessItem {
  label: string;
  state: FactorState;
  /** Authoritative record that satisfies (or would satisfy) the item. */
  evidence: Evidence | null;
  /** Needs a qualified person to verify; the app never certifies it. */
  humanVerification: boolean;
}

export interface ReadinessFactor {
  key: ReadinessFactorKey;
  state: FactorState;
  mandatory: boolean;
  score: number | null;
  weight: number;
  explanation: string;
  items: ReadinessItem[];
}

export interface MilestoneReadiness {
  stageId: UUID;
  stageKey: string;
  stageName: string;
  plannedStartDate: ISODate | null;
  daysUntilStart: number | null;
  label: ReadinessLabel;
  score: number;
  factors: ReadinessFactor[];
  blockers: string[];
  risks: string[];
  missingData: string[];
  history: { sampleSize: number; medianDays: number; p80Days: number } | null;
}

export interface ProjectReadiness {
  label: ReadinessLabel;
  score: number;
  explanation: string[];
  nextMilestone: MilestoneReadiness | null;
  evaluatedAt: ISODateTime;
}

// ---------------------------------------------------------------------------
// Briefing, Q&A, communications
// ---------------------------------------------------------------------------

export interface BriefingAction {
  recommendationId: UUID | null;
  text: string;
  severity: Severity;
  responsibleRole: ResponsibleRole;
  dueDate: ISODate | null;
}

export interface ProjectBriefing {
  projectId: UUID;
  generatedAt: ISODateTime;
  /** "rules" when no LLM narrative was available. */
  source: "rules" | "agent";
  headline: string;
  status: string;
  narrative: string | null;
  /** When the agent narrative was written, and whether project data changed since. */
  narrativeAt: ISODateTime | null;
  narrativeStale: boolean;
  upcomingMilestones: { stageId: UUID; name: string; plannedStartDate: ISODate | null; readiness: ReadinessLabel | null }[];
  blockers: BriefingAction[];
  todayActions: BriefingAction[];
  upcomingDeadlines: { type: EvidenceType; id: UUID; label: string; date: ISODate }[];
  recentChanges: { id: UUID; summary: string; createdAt: ISODateTime }[];
  approvalsNeeded: { type: EvidenceType; id: UUID; label: string }[];
  needsIntervention: boolean;
  interventionReasons: string[];
}

export interface ProjectIntelligence {
  briefing: ProjectBriefing;
  readiness: ProjectReadiness;
  counts: Record<Severity, number>;
  recommendations: Recommendation[];
  lastEvaluatedAt: ISODateTime | null;
  agentProvider: "crewai" | "anthropic" | "none";
}

export interface Citation {
  type: EvidenceType;
  id: UUID;
  label: string;
}

export interface IntelligenceAnswer {
  answer: string;
  citations: Citation[];
  source: "agent" | "rules";
  runId: UUID | null;
  /** Validation notes, e.g. citations dropped because they weren't in the data. */
  warnings: string[];
}

export const COMMUNICATION_AUDIENCES = ["homeowner", "supplier", "subcontractor", "internal"] as const;
export type CommunicationAudience = (typeof COMMUNICATION_AUDIENCES)[number];

export const COMMUNICATION_KINDS = [
  "weekly_update",
  "upcoming_work",
  "schedule_change",
  "decision_reminder",
  "change_order_explanation",
  "weather_delay",
  "milestone_complete",
  "walkthrough",
  "delivery_follow_up",
  "subcontractor_confirmation",
  "custom",
] as const;
export type CommunicationKind = (typeof COMMUNICATION_KINDS)[number];

export const COMMUNICATION_KIND_LABELS: Record<CommunicationKind, string> = {
  weekly_update: "Weekly progress update",
  upcoming_work: "Upcoming work notice",
  schedule_change: "Schedule change",
  decision_reminder: "Decision reminder",
  change_order_explanation: "Change order explanation",
  weather_delay: "Weather delay",
  milestone_complete: "Milestone complete",
  walkthrough: "Walkthrough & handover",
  delivery_follow_up: "Delivery follow-up",
  subcontractor_confirmation: "Subcontractor confirmation",
  custom: "Custom message",
};

export const COMMUNICATION_STATUSES = ["draft", "approved", "rejected", "posted"] as const;
export type CommunicationStatus = (typeof COMMUNICATION_STATUSES)[number];

export interface CommunicationFact {
  type: EvidenceType;
  id: UUID;
  text: string;
}

export interface CommunicationDraft {
  id: UUID;
  projectId: UUID;
  audience: CommunicationAudience;
  kind: CommunicationKind;
  subject: string;
  body: string;
  status: CommunicationStatus;
  source: "agent" | "template" | "manual";
  facts: CommunicationFact[];
  /** Sentences the validator could not tie to a fact; shown to the reviewer. */
  unsupportedClaims: string[];
  recommendationId: UUID | null;
  agentRunId: UUID | null;
  postedMessageId: UUID | null;
  createdBy: UUID | null;
  createdByName: string | null;
  approvedBy: UUID | null;
  approvedAt: ISODateTime | null;
  rejectionReason: string | null;
  version: number;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

// ---------------------------------------------------------------------------
// Portfolio, runs, settings
// ---------------------------------------------------------------------------

export interface PortfolioProject {
  projectId: UUID;
  name: string;
  number: string;
  status: string;
  readiness: ReadinessLabel | null;
  readinessScore: number | null;
  nextMilestone: string | null;
  counts: Record<Severity, number>;
  oldestOpenHighDays: number | null;
  needsIntervention: boolean;
}

export interface PortfolioOverview {
  projects: PortfolioProject[];
  attention: Recommendation[];
  crewConflicts: { resource: string; resourceName: string; date: ISODate; tasks: { id: UUID; title: string; projectId: UUID; projectName: string }[] }[];
  totals: { activeProjects: number; needsIntervention: number; atRiskMilestones: number; overdueDecisions: number; materialRisks: number; pendingInspections: number };
}

export const AGENT_RUN_KINDS = ["briefing", "ask", "draft"] as const;
export type AgentRunKind = (typeof AGENT_RUN_KINDS)[number];

export interface AgentRun {
  id: UUID;
  projectId: UUID | null;
  kind: AgentRunKind;
  provider: string;
  model: string | null;
  status: "running" | "succeeded" | "failed" | "rejected";
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  error: string | null;
  validationIssues: string[];
  requestedBy: UUID | null;
  createdAt: ISODateTime;
}

export interface IntelligenceSettings {
  enabled: boolean;
  /** Look this many calendar days ahead for upcoming work. */
  lookaheadDays: number;
  /** Blocked work starting within this many days is high (beyond it, medium). */
  attentionWindowDays: number;
  /** Work starting within this many days that is blocked by a mandatory gate is critical. */
  criticalWindowDays: number;
  /** A critical-path task overdue by more than this many days is critical. */
  criticalOverdueDays: number;
  /** Projected completion slipping by more than this many days is high. */
  slipDaysHigh: number;
  /** Flag active projects whose client hasn't had an update in this many days. */
  clientUpdateDays: number;
  /** Flag active projects with no recorded activity for this many days. */
  inactivityDays: number;
  decisionDueSoonDays: number;
  changeOrderWaitDays: number;
  /** Deliveries needed within this many days must be confirmed. */
  deliveryConfirmDays: number;
  /** Lead time assumed when a material has none recorded. */
  defaultLeadTimeDays: number;
  /** Open high-severity items older than this escalate. */
  escalateAfterDays: number;
  /** First stage key that needs an issued permit; that stage and every later one are gated. */
  permitGateFromStage: string;
  /** Stage key → inspection types that must have passed before the stage starts. */
  inspectionGates: Record<string, string[]>;
  /** Stage key → earlier stage keys whose work it covers up (photos/inspections needed first). */
  concealment: Record<string, string[]>;
  /** Push/in-app notification for recommendations at or above this severity. */
  notifyMinSeverity: Severity;
  /** compact = superintendent only (1 LLM call); full = specialists + superintendent. */
  briefingDepth: "compact" | "full";
  /** Generate an LLM briefing for each active project in the daily scan. */
  dailyAgentBriefings: boolean;
  dailyAgentRunLimit: number;
}
