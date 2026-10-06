import { clsx } from "clsx";
import { View } from "react-native";
import { Text } from "./text";

export function ProgressBar({ value, tone = "primary", label, showValue }: { value: number; tone?: "primary" | "success" | "warning" | "danger"; label?: string; showValue?: boolean }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  const color = { primary: "bg-primary", success: "bg-success", warning: "bg-warning", danger: "bg-destructive" }[tone];
  return (
    <View accessibilityRole="progressbar" accessibilityLabel={label} accessibilityValue={{ min: 0, max: 100, now: pct }} className="gap-1">
      {(label || showValue) && (
        <View className="flex-row justify-between">
          {label ? <Text variant="label">{label}</Text> : <View />}
          {showValue ? <Text className="font-sans-semibold text-sm text-foreground">{pct}%</Text> : null}
        </View>
      )}
      <View className="h-2.5 overflow-hidden rounded-full bg-muted">
        <View className={clsx("h-full rounded-full", color)} style={{ width: `${pct}%` }} />
      </View>
    </View>
  );
}

/** Compact KPI tile for dashboards. */
export function Stat({ label, value, hint, tone = "default" }: { label: string; value: string; hint?: string; tone?: "default" | "success" | "warning" | "danger" }) {
  const color = { default: "text-foreground", success: "text-success", warning: "text-warning", danger: "text-destructive" }[tone];
  return (
    <View accessible accessibilityLabel={`${label}: ${value}${hint ? `, ${hint}` : ""}`} className="min-w-[46%] flex-1 rounded-2xl border border-border bg-card p-4">
      <Text variant="label">{label}</Text>
      <Text className={clsx("mt-1 font-sans-extrabold text-2xl", color)} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      {hint ? <Text variant="caption">{hint}</Text> : null}
    </View>
  );
}
