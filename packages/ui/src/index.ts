import type {
  ChangeOrderStatus,
  InspectionResult,
  PaymentStatus,
  ProjectStatus,
  StageStatus,
  TaskPriority,
  TaskStatus,
} from "@pool/types";

/**
 * Pool PM design tokens — the single source for colors, type, spacing,
 * radii, elevation and touch sizing. The mobile app mirrors the colors as
 * CSS variables in global.css (NativeWind); keep both in sync.
 *
 * Design intent: a durable, field-friendly construction tool. High contrast
 * for outdoor glare (body text ≥ 7:1, secondary text ≥ 4.5:1 on cards), a
 * pool-water blue for brand/primary actions, and safety yellow reserved for
 * warnings and attention states.
 */
export const palette = {
  light: {
    background: "#f3f6f9",
    card: "#ffffff",
    surface: "#eef3f7",
    muted: "#e2e9f0",
    border: "#c9d4de",
    foreground: "#0d1a26",
    mutedForeground: "#4a5b6c",
    primary: "#0a5ea8",
    primaryForeground: "#ffffff",
    primarySoft: "#dcecfa",
    accent: "#f2a900",
    accentForeground: "#1a1300",
    success: "#0b6b4c",
    successSoft: "#dcf3ea",
    warning: "#9a4508",
    warningSoft: "#fdf0dc",
    destructive: "#c42b2b",
    destructiveSoft: "#fbe3e3",
    info: "#0b7285",
    infoSoft: "#dcf1f4",
  },
  dark: {
    background: "#0a1117",
    card: "#111b24",
    surface: "#16222d",
    muted: "#1d2b37",
    border: "#2b3d4c",
    foreground: "#e9eef4",
    mutedForeground: "#9badbe",
    primary: "#4da6ff",
    primaryForeground: "#04121f",
    primarySoft: "#12304d",
    accent: "#ffc233",
    accentForeground: "#1a1300",
    success: "#3dd598",
    successSoft: "#0f3326",
    warning: "#f5a524",
    warningSoft: "#3a2a0b",
    destructive: "#ff6b6b",
    destructiveSoft: "#3d1717",
    info: "#38bdf8",
    infoSoft: "#0d2e3d",
  },
} as const;

export type ColorScheme = keyof typeof palette;
export type ColorToken = keyof (typeof palette)["light"];

export const spacing = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;

export const radius = { sm: 8, md: 12, lg: 16, xl: 24, pill: 999 } as const;

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

export const fonts = {
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
  card: { shadowColor: "#0d1a26", shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  raised: { shadowColor: "#0d1a26", shadowOpacity: 0.12, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 6 },
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
