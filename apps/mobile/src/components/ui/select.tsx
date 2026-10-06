import { clsx } from "clsx";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { Icon } from "../icon";
import { BottomSheet } from "./sheet";
import { Text } from "./text";

export interface Option<T extends string> {
  value: T;
  label: string;
  description?: string;
}

/** Dropdown replacement: opens a bottom sheet with large, tappable options. */
export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
  placeholder = "Select…",
  error,
  allowClear,
}: {
  label?: string;
  value: T | null | undefined;
  options: Option<T>[];
  onChange: (value: T | null) => void;
  placeholder?: string;
  error?: string | null;
  allowClear?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);
  return (
    <View className="gap-1.5">
      {label && <Text variant="label">{label}</Text>}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label ?? "Select"}: ${selected?.label ?? "none"}`}
        onPress={() => setOpen(true)}
        className={clsx("min-h-14 flex-row items-center justify-between rounded-xl border-2 bg-card px-4", error ? "border-destructive" : "border-border")}
      >
        <Text className={selected ? "text-foreground" : "text-muted-foreground"} numberOfLines={1}>
          {selected?.label ?? placeholder}
        </Text>
        <Icon name="chevron-down" className="text-xl text-muted-foreground" />
      </Pressable>
      {error ? <Text className="text-sm text-destructive">{error}</Text> : null}
      <BottomSheet visible={open} onClose={() => setOpen(false)} title={label ?? "Select"}>
        {allowClear && (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              onChange(null);
              setOpen(false);
            }}
            className="min-h-14 flex-row items-center border-b border-border"
          >
            <Text className="text-muted-foreground">None</Text>
          </Pressable>
        )}
        {options.map((o) => (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ selected: o.value === value }}
            onPress={() => {
              onChange(o.value);
              setOpen(false);
            }}
            className="min-h-14 flex-row items-center justify-between gap-3 border-b border-border py-2"
          >
            <View className="flex-1">
              <Text variant="bodyStrong">{o.label}</Text>
              {o.description ? <Text variant="caption">{o.description}</Text> : null}
            </View>
            {o.value === value && <Icon name="checkmark-circle" className="text-2xl text-primary" />}
          </Pressable>
        ))}
      </BottomSheet>
    </View>
  );
}

/** Horizontal single-select chips (filters, segmented choices). */
export function Chips<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: Option<T>[];
  value: T | null;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <View className={clsx("flex-row flex-wrap gap-2", className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(o.value)}
            className={clsx("min-h-11 justify-center rounded-full border-2 px-4", active ? "border-primary bg-primary" : "border-border bg-card")}
          >
            <Text className={clsx("font-sans-semibold text-sm", active ? "text-primary-foreground" : "text-foreground")}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Segmented control for 2–4 views (Day / Week / Month). */
export function Segmented<T extends string>({ options, value, onChange }: { options: Option<T>[]; value: T; onChange: (v: T) => void }) {
  return (
    <View accessibilityRole="tablist" className="flex-row rounded-xl bg-muted p-1">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(o.value)}
            className={clsx("min-h-11 flex-1 items-center justify-center rounded-lg", active && "bg-card shadow-sm")}
          >
            <Text className={clsx("font-sans-semibold text-sm", active ? "text-foreground" : "text-muted-foreground")}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
