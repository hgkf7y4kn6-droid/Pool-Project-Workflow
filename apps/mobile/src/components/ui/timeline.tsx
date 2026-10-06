import { clsx } from "clsx";
import { View } from "react-native";
import type { ProjectStage } from "@pool/types";
import { dayLabel, shortDate, time } from "@/lib/format";
import { Icon } from "../icon";
import { Text } from "./text";

/** Vertical construction lifecycle timeline (Contract → … → Completion). */
export function StageTimeline({ stages, compact }: { stages: Pick<ProjectStage, "id" | "name" | "status" | "plannedStartDate" | "plannedEndDate" | "actualEndDate" | "isMilestone">[]; compact?: boolean }) {
  return (
    <View accessibilityRole="list">
      {stages.map((s, i) => {
        const done = s.status === "completed";
        const active = s.status === "in_progress";
        const skipped = s.status === "skipped";
        return (
          <View key={s.id} accessible accessibilityLabel={`${s.name}: ${s.status.replace("_", " ")}`} className="flex-row gap-3">
            <View className="items-center">
              <View
                className={clsx(
                  "size-7 items-center justify-center rounded-full border-2",
                  done ? "border-success bg-success" : active ? "border-primary bg-primary-soft" : "border-border bg-card",
                )}
              >
                {done ? <Icon name="checkmark" className="text-sm text-primary-foreground" /> : active ? <View className="size-2.5 rounded-full bg-primary" /> : null}
              </View>
              {i < stages.length - 1 && <View className={clsx("w-0.5 flex-1", done ? "bg-success" : "bg-border")} style={{ minHeight: compact ? 14 : 22 }} />}
            </View>
            <View className={clsx("flex-1 flex-row items-start justify-between", compact ? "pb-2" : "pb-4")}>
              <Text className={clsx("font-sans-semibold text-base", skipped ? "text-muted-foreground line-through" : "text-foreground", active && "text-primary")}>
                {s.name}
                {s.isMilestone ? " ◆" : ""}
              </Text>
              {!compact && (
                <Text variant="caption">{done ? `Done ${shortDate(s.actualEndDate ?? s.plannedEndDate)}` : s.plannedStartDate ? `${shortDate(s.plannedStartDate)} – ${shortDate(s.plannedEndDate)}` : ""}</Text>
              )}
            </View>
          </View>
        );
      })}
    </View>
  );
}

/** Chronological activity feed grouped by day (audit trail). */
export function ActivityFeed({ items }: { items: { id: string; summary: string; createdAt: string; action?: string }[] }) {
  let lastDay = "";
  return (
    <View>
      {items.map((a) => {
        const day = dayLabel(a.createdAt);
        const showDay = day !== lastDay;
        lastDay = day;
        return (
          <View key={a.id}>
            {showDay && (
              <Text variant="label" className="mb-1 mt-3 uppercase">
                {day}
              </Text>
            )}
            <View className="flex-row gap-3 py-2">
              <Text variant="caption" className="w-16">
                {time(a.createdAt)}
              </Text>
              <Text className="flex-1 text-sm text-foreground">{a.summary}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}
