import { clsx } from "clsx";
import dayjs from "dayjs";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { Icon } from "../icon";
import { IconButton } from "./button";
import { BottomSheet } from "./sheet";
import { Text } from "./text";

/** Month grid used by the date field and the schedule month view. */
export function MonthGrid({
  month,
  selected,
  onSelect,
  marks,
}: {
  month: dayjs.Dayjs;
  selected?: string | null;
  onSelect: (date: string) => void;
  /** Dot indicators per ISO date (e.g. task counts). */
  marks?: Record<string, number>;
}) {
  const start = month.startOf("month").startOf("week");
  const days = Array.from({ length: 42 }, (_, i) => start.add(i, "day"));
  const today = dayjs().format("YYYY-MM-DD");
  return (
    <View>
      <View className="flex-row">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <Text key={i} variant="label" className="flex-1 text-center">
            {d}
          </Text>
        ))}
      </View>
      <View className="mt-1 flex-row flex-wrap">
        {days.map((d) => {
          const iso = d.format("YYYY-MM-DD");
          const inMonth = d.month() === month.month();
          const isSelected = iso === selected;
          const count = marks?.[iso] ?? 0;
          return (
            <Pressable
              key={iso}
              accessibilityRole="button"
              accessibilityLabel={`${d.format("dddd, MMMM D")}${count ? `, ${count} items` : ""}`}
              accessibilityState={{ selected: isSelected }}
              onPress={() => onSelect(iso)}
              className="h-12 w-[14.28%] items-center justify-center"
            >
              <View className={clsx("size-10 items-center justify-center rounded-full", isSelected ? "bg-primary" : iso === today && "border-2 border-primary")}>
                <Text className={clsx("font-sans-semibold text-base", isSelected ? "text-primary-foreground" : inMonth ? "text-foreground" : "text-muted-foreground opacity-50")}>
                  {d.date()}
                </Text>
              </View>
              {count > 0 && <View className={clsx("absolute bottom-0.5 size-1.5 rounded-full", isSelected ? "bg-accent" : "bg-primary")} />}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** Date input with a calendar sheet (no native picker dependency). */
export function DateField({
  label,
  value,
  onChange,
  error,
  allowClear = true,
}: {
  label: string;
  value: string | null | undefined;
  onChange: (value: string | null) => void;
  error?: string | null;
  allowClear?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => dayjs(value ?? undefined));
  return (
    <View className="gap-1.5">
      <Text variant="label">{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value ? dayjs(value).format("MMMM D, YYYY") : "not set"}`}
        onPress={() => {
          setMonth(dayjs(value ?? undefined));
          setOpen(true);
        }}
        className={clsx("min-h-14 flex-row items-center justify-between rounded-xl border-2 bg-card px-4", error ? "border-destructive" : "border-border")}
      >
        <Text className={value ? "text-foreground" : "text-muted-foreground"}>{value ? dayjs(value).format("ddd, MMM D, YYYY") : "Select date"}</Text>
        <Icon name="calendar-outline" className="text-xl text-muted-foreground" />
      </Pressable>
      {error ? <Text className="text-sm text-destructive">{error}</Text> : null}
      <BottomSheet visible={open} onClose={() => setOpen(false)} title={label}>
        <View className="mb-2 flex-row items-center justify-between">
          <IconButton icon="chevron-back" label="Previous month" onPress={() => setMonth((m) => m.subtract(1, "month"))} />
          <Text variant="h3">{month.format("MMMM YYYY")}</Text>
          <IconButton icon="chevron-forward" label="Next month" onPress={() => setMonth((m) => m.add(1, "month"))} />
        </View>
        <MonthGrid
          month={month}
          selected={value}
          onSelect={(d) => {
            onChange(d);
            setOpen(false);
          }}
        />
        <View className="mt-3 flex-row justify-between">
          <Pressable accessibilityRole="button" className="min-h-12 justify-center px-2" onPress={() => { onChange(dayjs().format("YYYY-MM-DD")); setOpen(false); }}>
            <Text className="font-sans-semibold text-primary">Today</Text>
          </Pressable>
          {allowClear && (
            <Pressable accessibilityRole="button" className="min-h-12 justify-center px-2" onPress={() => { onChange(null); setOpen(false); }}>
              <Text className="font-sans-semibold text-muted-foreground">Clear</Text>
            </Pressable>
          )}
        </View>
      </BottomSheet>
    </View>
  );
}
