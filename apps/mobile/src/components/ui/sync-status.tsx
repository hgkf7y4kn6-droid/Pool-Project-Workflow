import { clsx } from "clsx";
import { router } from "expo-router";
import { ActivityIndicator, Pressable, View } from "react-native";
import { useEntitySyncStatus } from "@/hooks/use-sync-status";
import { fromNow } from "@/lib/format";
import { useSync } from "@/providers/sync";
import { Icon } from "../icon";
import { Text } from "./text";

/**
 * Always-visible sync indicator. Tapping opens the offline queue so users
 * can see exactly what is saved locally, waiting, failed or in conflict.
 */
export function SyncPill() {
  const { state } = useSync();
  let icon: "cloud-done-outline" | "cloud-offline-outline" | "cloud-upload-outline" | "warning-outline" = "cloud-done-outline";
  const busy = state.phase === "pushing" || state.phase === "pulling";
  // Before the first successful sync the device has no data yet; don't claim "Synced".
  let label = state.lastSyncedAt ? `Synced ${fromNow(state.lastSyncedAt)}` : busy ? "Downloading data" : "Not synced yet";
  let tone = state.lastSyncedAt ? "text-success" : "text-info";
  if (!state.online || state.phase === "offline") {
    icon = "cloud-offline-outline";
    label = state.pending ? `Offline · ${state.pending} saved on device` : "Offline";
    tone = "text-warning";
  } else if (state.conflicts || state.failed) {
    icon = "warning-outline";
    label = `${state.conflicts + state.failed} need attention`;
    tone = "text-destructive";
  } else if (state.pending) {
    icon = "cloud-upload-outline";
    label = `${state.pending} waiting to sync`;
    tone = "text-info";
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Sync status: ${label}. Open offline queue.`}
      onPress={() => router.push("/offline-queue")}
      className="min-h-11 flex-row items-center gap-1.5 rounded-full bg-muted px-3"
    >
      {busy ? <ActivityIndicator size="small" /> : <Icon name={icon} className={clsx("text-lg", tone)} />}
      <Text className="max-w-36 font-sans-semibold text-xs text-foreground" numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Small per-record badge: "On device", "Sync failed", "Conflict". */
export function EntitySyncBadge({ type, id }: { type: string; id: string }) {
  const status = useEntitySyncStatus(type, id);
  if (status === "synced") return null;
  const cfg = {
    pending: { icon: "phone-portrait-outline" as const, label: "Saved on device", cls: "bg-info-soft text-info" },
    failed: { icon: "alert-circle-outline" as const, label: "Sync failed", cls: "bg-destructive-soft text-destructive" },
    conflict: { icon: "git-compare-outline" as const, label: "Conflict", cls: "bg-warning-soft text-warning" },
  }[status];
  return (
    <View accessibilityLabel={cfg.label} className={clsx("flex-row items-center gap-1 self-start rounded-full px-2 py-0.5", cfg.cls.split(" ")[0])}>
      <Icon name={cfg.icon} className={clsx("text-xs", cfg.cls.split(" ")[1])} />
      <Text className={clsx("font-sans-semibold text-xs", cfg.cls.split(" ")[1])}>{cfg.label}</Text>
    </View>
  );
}

export function OfflineBanner() {
  const { state } = useSync();
  if (state.online && state.phase !== "offline") return null;
  return (
    <View accessibilityLiveRegion="polite" className="mb-3 flex-row items-center gap-2 rounded-xl bg-warning-soft p-3">
      <Icon name="cloud-offline-outline" className="text-xl text-warning" />
      <Text className="flex-1 font-sans-medium text-sm text-foreground">You&apos;re offline. Changes are saved on this device and will sync automatically.</Text>
    </View>
  );
}
