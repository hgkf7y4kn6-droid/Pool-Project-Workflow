import type { OrganizationSettings } from "@pool/types";

export const DEFAULT_ORG_SETTINGS: OrganizationSettings = {
  budgetAlertThresholdPct: 90,
  clientCanSeeContractAmount: true,
  crewLocationSharingEnabled: false,
  weather: { rainProbabilityPct: 60, windSpeedKph: 40, minTempC: 4, maxTempC: 43 },
};
