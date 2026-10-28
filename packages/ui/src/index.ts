import type {
  ChangeOrderStatus,
  CommunicationStatus,
  FactorState,
  InspectionResult,
  ReadinessLabel,
  RecommendationStatus,
  Severity,
  PaymentStatus,
  ProjectStatus,
  StageStatus,
  TaskPriority,
  TaskStatus,
} from "@pool/types";

/**
 * Pool PM design tokens — the single source for colors, type, spacing,
 * radii, elevation and touch sizing. The mobile app mirrors the colors as
 * CSS variables in global.css (NativeWind); a unit test keeps them in sync.
 *
 * Brand: "Lagoon & Limestone". Warm limestone neutrals (the coping stone),
 * deep-water ink for text and hero surfaces, lagoon teal for brand and
 * primary actions, and a warm sun amber reserved for highlights. Dark mode is
 * "night swim": deep water with a glowing pool-light teal.
 *
 * Field use: body text ≥ 7:1 and secondary text ≥ 4.5:1 on cards for glare.
 */
export const palette = {
  light: {
    background: "#f5f2ec",
    card: "#ffffff",
    surface: "#faf8f4",
    muted: "#ece7de",
    border: "#ded6c9",
    foreground: "#0a2230",
    mutedForeground: "#54636b",
    primary: "#0a6c78",
    primaryForeground: "#ffffff",
    primarySoft: "#dcefef",
    accent: "#f2a93b",
    accentForeground: "#2a1a00",
    accentInk: "#8f5300",
    success: "#126b4c",
    successSoft: "#dcf1e6",
    warning: "#954708",
    warningSoft: "#fbeed8",
    destructive: "#b8352a",
    destructiveSoft: "#fbe4e0",
    info: "#1e5aa0",
    infoSoft: "#e1ebf7",
    hero: "#0a2230",
    heroForeground: "#f5f2ec",
    heroMuted: "#a7bcc3",
    glow: "#2bd4e3",
  },
  dark: {
    background: "#071319",
    card: "#0e1f27",
    surface: "#12262f",
    muted: "#183139",
    border: "#24414b",
    foreground: "#e8f1f2",
    mutedForeground: "#97adb4",
    primary: "#3ccfdb",
    primaryForeground: "#03171d",
    primarySoft: "#0e3940",
    accent: "#f7b955",
    accentForeground: "#2a1a00",
    accentInk: "#f7b955",
    success: "#4ad69b",
    successSoft: "#0f3326",
    warning: "#f5a524",
    warningSoft: "#3a2a0b",
    destructive: "#ff7a6b",
    destructiveSoft: "#3d1a17",
    info: "#7ab0f2",
    infoSoft: "#13284a",
    hero: "#0b2c38",
    heroForeground: "#e8f1f2",
    heroMuted: "#94b3bb",
    glow: "#3ccfdb",
  },
} as const;

export type ColorScheme = keyof typeof palette;
export type ColorToken = keyof (typeof palette)["light"];

export const spacing = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;

export const radius = { sm: 8, md: 12, lg: 16, xl: 24, xxl: 28, pill: 999 } as const;

/** Type scale (px). Body is 16 minimum for outdoor legibility. */
export const typography = {
  caption: { size: 13, lineHeight: 18 },
  label: { size: 14, lineHeight: 20 },
  body: { size: 16, lineHeight: 24 },
  bodyLarge: { size: 18, lineHeight: 26 },
  title: { size: 20, lineHeight: 28 },
  headline: { size: 24, lineHeight: 32 },
  display: { size: 32, lineHeight: 40 },
} as const;

/** Manrope for the interface; Fraunces (display) for headlines and hero numbers. */
export const fonts = {
  display: "display-semibold",
  displayBold: "display-bold",
  regular: "sans-regular",
  medium: "sans-medium",
  semibold: "sans-semibold",
  bold: "sans-bold",
  extrabold: "sans-extrabold",
} as const;

/** Minimum touch targets. 56dp for primary field actions (gloves). */
export const touch = { min: 48, field: 56, fab: 64 } as const;

export const elevation = {
  none: { shadowOpacity: 0, elevation: 0 },
  card: { shadowColor: "#0a2230", shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  raised: { shadowColor: "#0a2230", shadowOpacity: 0.12, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 6 },
} as const;

/** Motion: one easing family (expo-out) and three durations, so the app moves consistently. */
export const motion = {
  fast: 160,
  base: 280,
  slow: 520,
  /** Stagger between list items on first reveal (capped at 8 items). */
  stagger: 45,
  pressScale: 0.97,
} as const;

export const breakpoints = { tablet: 768, desktop: 1100 } as const;

/** Semantic tone used by badges, banners and timeline nodes. */
export type Tone = "neutral" | "info" | "success" | "warning" | "danger" | "primary";

export const projectStatusTone: Record<ProjectStatus, Tone> = {
  lead: "neutral",
  estimate: "neutral",
  design: "info",
  contract: "info",
  planning: "primary",
  scheduling: "primary",
  procurement: "primary",
  construction: "primary",
  inspection: "warning",
  client_approval: "warning",
  completed: "success",
  warranty: "success",
  on_hold: "warning",
  cancelled: "danger",
};

export const taskStatusTone: Record<TaskStatus, Tone> = {
  todo: "neutral",
  in_progress: "primary",
  blocked: "danger",
  done: "success",
  cancelled: "neutral",
};

export const taskPriorityTone: Record<TaskPriority, Tone> = {
  low: "neutral",
  normal: "info",
  high: "warning",
  urgent: "danger",
};

export const stageStatusTone: Record<StageStatus, Tone> = {
  not_started: "neutral",
  in_progress: "primary",
  completed: "success",
  skipped: "neutral",
};

export const changeOrderStatusTone: Record<ChangeOrderStatus, Tone> = {
  draft: "neutral",
  submitted: "info",
  client_review: "warning",
  approved: "success",
  rejected: "danger",
  scheduled: "primary",
  completed: "success",
  void: "neutral",
};

export const inspectionResultTone: Record<InspectionResult, Tone> = {
  pending: "neutral",
  pass: "success",
  fail: "danger",
  partial: "warning",
};

export const paymentStatusTone: Record<PaymentStatus, Tone> = {
  scheduled: "neutral",
  invoiced: "info",
  paid: "success",
  overdue: "danger",
  void: "neutral",
};

export const severityTone: Record<Severity, Tone> = {
  critical: "danger",
  high: "warning",
  medium: "info",
  low: "neutral",
};

export const readinessTone: Record<ReadinessLabel, Tone> = {
  ready: "success",
  at_risk: "warning",
  blocked: "danger",
  no_upcoming_milestone: "neutral",
};

/** `unknown` is missing data, deliberately neutral rather than alarming. */
export const factorStateTone: Record<FactorState, Tone> = {
  ready: "success",
  at_risk: "warning",
  blocked: "danger",
  unknown: "neutral",
};

export const recommendationStatusTone: Record<RecommendationStatus, Tone> = {
  open: "primary",
  acknowledged: "info",
  in_progress: "info",
  snoozed: "neutral",
  escalated: "danger",
  resolved: "success",
  dismissed: "neutral",
  superseded: "neutral",
  expired: "neutral",
};

export const communicationStatusTone: Record<CommunicationStatus, Tone> = {
  draft: "neutral",
  approved: "success",
  rejected: "danger",
  posted: "success",
};

/** Foreground/background token pair for a tone. */
export function toneColors(tone: Tone, scheme: ColorScheme): { fg: string; bg: string } {
  const p = palette[scheme];
  switch (tone) {
    case "success":
      return { fg: p.success, bg: p.successSoft };
    case "warning":
      return { fg: p.warning, bg: p.warningSoft };
    case "danger":
      return { fg: p.destructive, bg: p.destructiveSoft };
    case "info":
      return { fg: p.info, bg: p.infoSoft };
    case "primary":
      return { fg: p.primary, bg: p.primarySoft };
    default:
      return { fg: p.mutedForeground, bg: p.muted };
  }
}

/** WCAG relative-luminance contrast ratio (used by token tests). */
export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string) => {
    const v = hex.replace("#", "");
    const [r, g, bl] = [0, 2, 4].map((i) => {
      const c = parseInt(v.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
