import { clsx } from "clsx";
import { Pressable, TextInput, View } from "react-native";
import { PressableScale } from "./motion";
import { useTheme } from "@/hooks/use-theme";
import { Icon, type IconName } from "../icon";
import { Text } from "./text";

/** Section heading: optional kicker, title, and a quiet "See all ›" link. */
export function SectionHeader({ title, kicker, actionLabel = "See all", onPress, className }: { title: string; kicker?: string; actionLabel?: string; onPress?: () => void; className?: string }) {
  return (
    <View className={clsx("mb-3 mt-7 flex-row items-end justify-between gap-3", className)}>
      <View className="flex-1">
        {kicker ? <Text variant="kicker">{kicker}</Text> : null}
        <Text variant="h2" accessibilityRole="header">
          {title}
        </Text>
      </View>
      {onPress && (
        <Pressable accessibilityRole="button" accessibilityLabel={`${actionLabel}: ${title}`} onPress={onPress} hitSlop={8} className="min-h-11 flex-row items-center gap-0.5 px-1 active:opacity-60">
          <Text className="font-sans-bold text-sm text-primary">{actionLabel}</Text>
          <Icon name="chevron-forward" className="text-base text-primary" />
        </Pressable>
      )}
    </View>
  );
}

export function ListItem({
  title,
  subtitle,
  icon,
  iconTone = "primary",
  right,
  onPress,
  className,
  accessibilityHint,
}: {
  title: string;
  subtitle?: string | null;
  icon?: IconName;
  iconTone?: "primary" | "danger" | "warning" | "success" | "muted";
  right?: React.ReactNode;
  onPress?: () => void;
  className?: string;
  accessibilityHint?: string;
}) {
  const content = (
    <>
      {icon && (
        <View
          className={clsx(
            "size-11 items-center justify-center rounded-2xl",
            { primary: "bg-primary-soft", danger: "bg-destructive-soft", warning: "bg-warning-soft", success: "bg-success-soft", muted: "bg-muted" }[iconTone],
          )}
        >
          <Icon
            name={icon}
            className={clsx("text-xl", { primary: "text-primary", danger: "text-destructive", warning: "text-warning", success: "text-success", muted: "text-muted-foreground" }[iconTone])}
          />
        </View>
      )}
      <View className="flex-1">
        <Text variant="bodyStrong" numberOfLines={2}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
      {onPress && !right && <Icon name="chevron-forward" className="text-lg text-muted-foreground/70" />}
    </>
  );
  const cls = clsx("min-h-16 flex-row items-center gap-3 py-3", className);
  return onPress ? (
    <PressableScale accessibilityRole="button" accessibilityHint={accessibilityHint} onPress={onPress} scaleTo={0.985} className={cls}>
      {content}
    </PressableScale>
  ) : (
    <View className={cls}>{content}</View>
  );
}

export function KeyValue({ label, value, emphasize }: { label: string; value: React.ReactNode; emphasize?: boolean }) {
  return (
    <View className="min-h-11 flex-row items-center justify-between gap-4 py-1.5">
      <Text variant="caption">{label}</Text>
      {typeof value === "string" || typeof value === "number" ? (
        <Text className={clsx("flex-1 text-right", emphasize ? "font-sans-bold text-base" : "font-sans-semibold text-sm")} numberOfLines={2}>
          {value}
        </Text>
      ) : (
        value
      )}
    </View>
  );
}

export function Divider() {
  return <View className="h-px bg-border" />;
}

export function SearchBar({ value, onChangeText, placeholder = "Search", className }: { value: string; onChangeText: (v: string) => void; placeholder?: string; className?: string }) {
  const { colors } = useTheme();
  return (
    <View className={clsx("min-h-12 flex-row items-center gap-2 rounded-full border border-border bg-card px-4", className)}>
      <Icon name="search" className="text-xl text-muted-foreground" />
      <TextInput
        accessibilityLabel={placeholder}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        returnKeyType="search"
        autoCorrect={false}
        className="flex-1 py-2 font-sans text-base text-foreground"
      />
      {value ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Clear search" hitSlop={10} onPress={() => onChangeText("")}>
          <Icon name="close-circle" className="text-xl text-muted-foreground" />
        </Pressable>
      ) : null}
    </View>
  );
}

export function Avatar({ name, size = 40 }: { name?: string | null; size?: number }) {
  const letters = (name ?? "?").split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2 }} className="items-center justify-center bg-hero">
      <Text style={{ fontSize: size * 0.4 }} className="font-display text-hero-foreground">
        {letters}
      </Text>
    </View>
  );
}

/** Simple responsive data table: columns on wide screens, stacked cards on phones. */
export function DataTable<T>({
  rows,
  columns,
  keyOf,
  onRowPress,
  wide,
}: {
  rows: T[];
  columns: { key: string; header: string; render: (row: T) => React.ReactNode; flex?: number; align?: "left" | "right" }[];
  keyOf: (row: T) => string;
  onRowPress?: (row: T) => void;
  wide: boolean;
}) {
  if (!wide) {
    return (
      <View className="gap-2">
        {rows.map((row) => (
          <Pressable key={keyOf(row)} disabled={!onRowPress} onPress={() => onRowPress?.(row)} className="card gap-1">
            {columns.map((c) => (
              <KeyValue key={c.key} label={c.header} value={c.render(row)} />
            ))}
          </Pressable>
        ))}
      </View>
    );
  }
  return (
    <View accessibilityRole="list" className="overflow-hidden rounded-3xl border border-border bg-card">
      <View className="flex-row border-b border-border bg-surface px-4 py-3">
        {columns.map((c) => (
          <Text key={c.key} variant="label" style={{ flex: c.flex ?? 1 }} className={c.align === "right" ? "text-right" : ""}>
            {c.header}
          </Text>
        ))}
      </View>
      {rows.map((row) => (
        <Pressable key={keyOf(row)} disabled={!onRowPress} onPress={() => onRowPress?.(row)} className="min-h-14 flex-row items-center border-b border-border px-4 py-2 active:bg-muted">
          {columns.map((c) => (
            <View key={c.key} style={{ flex: c.flex ?? 1 }} className={c.align === "right" ? "items-end" : ""}>
              {(() => {
                const v = c.render(row);
                return typeof v === "string" || typeof v === "number" ? <Text className="text-sm">{v}</Text> : v;
              })()}
            </View>
          ))}
        </Pressable>
      ))}
    </View>
  );
}
