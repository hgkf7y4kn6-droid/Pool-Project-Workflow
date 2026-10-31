import type { IntelligenceSettings, OrganizationSettings, Severity } from "@pool/types";

/**
 * Defaults for project intelligence. Organizations override individual keys
 * in `organizations.settings.intelligence`; stage and inspection keys match
 * DEFAULT_STAGE_TEMPLATES / DEFAULT_INSPECTION_TEMPLATES and can be remapped
 * for other construction methods or jurisdictions.
 */
export const DEFAULT_INTELLIGENCE_SETTINGS: IntelligenceSettings = {
  enabled: true,
  lookaheadDays: 14,
  attentionWindowDays: 7,
  criticalWindowDays: 2,
  criticalOverdueDays: 3,
  slipDaysHigh: 5,
  clientUpdateDays: 7,
  inactivityDays: 7,
  decisionDueSoonDays: 3,
  changeOrderWaitDays: 5,
  deliveryConfirmDays: 7,
  defaultLeadTimeDays: 10,
  escalateAfterDays: 3,
  permitGateFromStage: "excavation",
  permitExpiryWarnDays: 21,
  inspectionGates: { gunite: ["pre_gunite"], decking: ["pre_deck"], walkthrough: ["final"] },
  concealment: { gunite: ["plumbing", "electrical", "steel"], decking: ["plumbing", "electrical"] },
  notifyMinSeverity: "high",
  briefingDepth: "compact",
  dailyAgentBriefings: false,
  dailyAgentRunLimit: 200,
};

export function resolveIntelligenceSettings(settings: Pick<OrganizationSettings, "intelligence"> | null | undefined): IntelligenceSettings {
  const o = settings?.intelligence ?? {};
  return {
    ...DEFAULT_INTELLIGENCE_SETTINGS,
    ...o,
    inspectionGates: o.inspectionGates ?? DEFAULT_INTELLIGENCE_SETTINGS.inspectionGates,
    concealment: o.concealment ?? DEFAULT_INTELLIGENCE_SETTINGS.concealment,
  };
}

const RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export function severityAtLeast(severity: Severity, threshold: Severity): boolean {
  return RANK[severity] <= RANK[threshold];
}

export function maxSeverity(a: Severity, b: Severity): Severity {
  return RANK[a] <= RANK[b] ? a : b;
}

export function compareSeverity(a: Severity, b: Severity): number {
  return RANK[a] - RANK[b];
}
