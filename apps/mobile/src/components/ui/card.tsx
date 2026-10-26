import { clsx } from "clsx";
import { View, type ViewProps } from "react-native";
import { PressableScale } from "./motion";
import { Icon, type IconName } from "../icon";
import { Text } from "./text";

export function Card({ className, onPress, children, ...props }: ViewProps & { className?: string; onPress?: () => void }) {
  if (onPress) {
    return (
      <PressableScale accessibilityRole="button" onPress={onPress} scaleTo={0.985} className={clsx("card", className)} {...props}>
        {children}
      </PressableScale>
    );
  }
  return (
    <View className={clsx("card", className)} {...props}>
      {children}
    </View>
  );
}

export function CardHeader({ title, subtitle, icon, right }: { title: string; subtitle?: string | null; icon?: IconName; right?: React.ReactNode }) {
  return (
    <View className="mb-3 flex-row items-center gap-3">
      {icon && (
        <View className="icon-tile">
          <Icon name={icon} className="text-xl text-primary" />
        </View>
      )}
      <View className="flex-1">
        <Text variant="h3" numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
    </View>
  );
}

/**
 * Inverted "deep water" summary card for the most important numbers on a
 * screen, with an optional soft pool-light glow in the corner.
 */
export function HeroCard({ kicker, title, subtitle, right, children, className, onPress }: {
  kicker?: string;
  title?: string;
  subtitle?: string | null;
  right?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  onPress?: () => void;
}) {
  const body = (
    <>
      <View pointerEvents="none" className="absolute -right-16 -top-20 size-56 rounded-full bg-glow/15" />
      <View pointerEvents="none" className="absolute -right-6 -top-8 size-28 rounded-full bg-glow/10" />
      {(kicker || title || right) && (
        <View className="flex-row items-start gap-3">
          <View className="flex-1 gap-1">
            {kicker ? <Text className="hero-kicker">{kicker}</Text> : null}
            {title ? (
              <Text className="hero-title" accessibilityRole="header">
                {title}
              </Text>
            ) : null}
            {subtitle ? <Text className="hero-text">{subtitle}</Text> : null}
          </View>
          {right}
        </View>
      )}
      {children}
    </>
  );
  return onPress ? (
    <PressableScale accessibilityRole="button" onPress={onPress} scaleTo={0.985} className={clsx("hero", className)}>
      {body}
    </PressableScale>
  ) : (
    <View className={clsx("hero", className)}>{body}</View>
  );
}

/** Figure + label pair for use inside a HeroCard footer row. */
export function HeroStat({ value, label, tone }: { value: string; label: string; tone?: "warning" | "danger" | "success" }) {
  const color = tone === "danger" ? "text-[#ff9a8f]" : tone === "warning" ? "text-accent" : tone === "success" ? "text-[#7fe3b8]" : "text-hero-foreground";
  return (
    <View accessible accessibilityLabel={`${label}: ${value}`} className="min-w-[22%] flex-1">
      {/* Words (a stage name) get a smaller, wrapping size; figures stay large. */}
      <Text className={clsx("font-display", value.length > 7 ? "text-lg leading-6" : "text-2xl", color)} style={{ fontVariant: ["tabular-nums"] }} numberOfLines={2} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text className="font-sans-semibold text-[11px] uppercase tracking-wider text-hero-muted" numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/** Big, obvious shortcut for the most common jobs ("Today's tasks", "New project"). */
export function QuickAction({ icon, label, hint, onPress, tone = "primary" }: { icon: IconName; label: string; hint?: string; onPress: () => void; tone?: "primary" | "accent" }) {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={hint ? `${label}. ${hint}` : label}
      onPress={onPress}
      haptics
      className="min-w-[46%] flex-1 flex-row items-center gap-3 rounded-2xl border border-border bg-card px-3 py-3"
    >
      <View className={clsx("size-10 items-center justify-center rounded-xl", tone === "accent" ? "bg-accent" : "bg-primary-soft")}>
        <Icon name={icon} className={clsx("text-xl", tone === "accent" ? "text-accent-foreground" : "text-primary")} />
      </View>
      <View className="flex-1">
        <Text className="font-sans-bold text-sm text-foreground" numberOfLines={1}>
          {label}
        </Text>
        {hint ? (
          <Text className="font-sans text-xs text-muted-foreground" numberOfLines={1}>
            {hint}
          </Text>
        ) : null}
      </View>
    </PressableScale>
  );
}
