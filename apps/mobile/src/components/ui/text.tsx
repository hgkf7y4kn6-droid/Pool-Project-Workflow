import { clsx } from "clsx";
import { Text as RNText, type TextProps } from "react-native";

type Variant = "display" | "h1" | "h2" | "h3" | "body" | "bodyStrong" | "caption" | "label" | "mono";

const VARIANT: Record<Variant, string> = {
  display: "font-sans-extrabold text-3xl text-foreground",
  h1: "font-sans-extrabold text-2xl text-foreground",
  h2: "font-sans-bold text-xl text-foreground",
  h3: "font-sans-semibold text-lg text-foreground",
  body: "font-sans text-base text-foreground",
  bodyStrong: "font-sans-semibold text-base text-foreground",
  caption: "font-sans text-sm text-muted-foreground",
  label: "font-sans-semibold text-sm text-muted-foreground",
  mono: "font-sans-medium text-sm text-foreground",
};

/**
 * Typography with Dynamic Type support: text scales with the OS setting up
 * to 1.6× so layouts stay usable at large sizes.
 */
export function Text({ variant = "body", className, ...props }: TextProps & { variant?: Variant; className?: string }) {
  return (
    <RNText
      maxFontSizeMultiplier={1.6}
      accessibilityRole={variant === "h1" || variant === "h2" || variant === "display" ? "header" : undefined}
      className={clsx(VARIANT[variant], className)}
      {...props}
    />
  );
}
