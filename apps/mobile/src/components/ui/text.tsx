import { clsx } from "clsx";
import { Text as RNText, type TextProps } from "react-native";

type Variant = "display" | "h1" | "h2" | "h3" | "body" | "bodyStrong" | "caption" | "label" | "kicker" | "stat" | "mono";

const VARIANT: Record<Variant, string> = {
  display: "display",
  h1: "h1",
  h2: "h2",
  h3: "h3",
  body: "body",
  bodyStrong: "font-sans-semibold text-base leading-6 text-foreground",
  caption: "caption",
  label: "label",
  kicker: "kicker",
  stat: "stat-value",
  // Tabular figures keep amounts and dates aligned in columns.
  mono: "font-sans-semibold text-sm text-foreground",
};

/**
 * Typography with Dynamic Type support: text scales with the OS setting up
 * to 1.6× so layouts stay usable at large sizes.
 */
export function Text({ variant = "body", className, style, ...props }: TextProps & { variant?: Variant; className?: string }) {
  const numeric = variant === "stat" || variant === "mono";
  return (
    <RNText
      style={numeric ? [{ fontVariant: ["tabular-nums"] }, style] : style}
      maxFontSizeMultiplier={1.6}
      accessibilityRole={variant === "h1" || variant === "h2" || variant === "display" ? "header" : undefined}
      className={clsx(VARIANT[variant], className)}
      {...props}
    />
  );
}
