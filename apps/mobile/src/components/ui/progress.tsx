import { clsx } from "clsx";
import { View } from "react-native";
import { PressableScale } from "./motion";
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
      <View className="h-2 overflow-hidden rounded-full bg-muted">
        <View className={clsx("h-full rounded-full", color)} style={{ width: `${pct}%` }} />
      </View>
    </View>
  );
}

/** KPI tile: uppercase label, a display-serif figure and an optional hint. */
export function Stat({ label, value, hint, tone = "default", onPress }: { label: string; value: string; hint?: string; tone?: "default" | "success" | "warning" | "danger"; onPress?: () => void }) {
  const color = { default: "text-foreground", success: "text-success", warning: "text-warning", danger: "text-destructive" }[tone];
  const dot = { default: null, success: "bg-success", warning: "bg-accent", danger: "bg-destructive" }[tone];
  const body = (
    <>
      <View className="flex-row items-center gap-1.5">
        {dot ? <View className={clsx("size-2 rounded-full", dot)} /> : null}
        <Text className="stat-label" numberOfLines={1}>
          {label}
        </Text>
      </View>
      <Text variant="stat" className={clsx("mt-1.5", color)} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      {hint ? (
        <Text variant="caption" numberOfLines={2}>
          {hint}
        </Text>
      ) : null}
    </>
  );
  const a11y = `${label}: ${value}${hint ? `, ${hint}` : ""}`;
  return onPress ? (
    <PressableScale accessibilityRole="button" accessibilityLabel={a11y} onPress={onPress} className="tile min-w-[46%]">
      {body}
    </PressableScale>
  ) : (
    <View accessible accessibilityLabel={a11y} className="tile min-w-[46%]">
      {body}
    </View>
  );
}
