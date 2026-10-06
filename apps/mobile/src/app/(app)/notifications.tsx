import { useMutation, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { Switch, View } from "react-native";
import { NOTIFICATION_TYPE_LABELS, type Notification, type NotificationChannel, type NotificationType } from "@pool/types";
import { Button, Card, EmptyState, ErrorState, ListItem, LoadingState, Screen, Segmented, Text } from "@/components/ui";
import { useApi } from "@/features/data";
import { api } from "@/lib/api";
import { fromNow } from "@/lib/format";

/** Notification inbox and per-type preferences (push / in-app). */
export default function Notifications() {
  const [tab, setTab] = useState<"inbox" | "prefs">("inbox");
  return (
    <Screen title="Notifications" back>
      <Segmented value={tab} onChange={setTab} options={[{ value: "inbox", label: "Inbox" }, { value: "prefs", label: "Preferences" }]} />
      <View className="mt-4">{tab === "inbox" ? <Inbox /> : <Prefs />}</View>
    </Screen>
  );
}

function Inbox() {
  const qc = useQueryClient();
  const q = useApi<Notification[]>(["notifications"], "/notifications");
  const read = useMutation({ mutationFn: (ids: string[] | "all") => api.post("/notifications/read", { ids }), onSuccess: () => void qc.invalidateQueries({ queryKey: ["notifications"] }) });
  if (q.isLoading) return <LoadingState />;
  if (q.error) return <ErrorState offline onRetry={() => void q.refetch()} />;
  if (!q.data?.length) return <EmptyState icon="notifications-off-outline" title="You're all caught up" />;
  return (
    <>
      <Button label="Mark all read" variant="ghost" size="sm" onPress={() => read.mutate("all")} />
      <Card className="py-1">
        {q.data.map((n) => (
          <ListItem
            key={n.id}
            icon={n.readAt ? "notifications-outline" : "notifications"}
            iconTone={n.readAt ? "muted" : "primary"}
            title={n.title}
            subtitle={`${n.body} · ${fromNow(n.createdAt)}`}
            onPress={() => {
              if (!n.readAt) read.mutate([n.id]);
              const data = n.data as { taskId?: string; changeOrderId?: string; projectId?: string };
              if (data.taskId) router.push(`/tasks/${data.taskId}`);
              else if (data.changeOrderId) router.push(`/change-orders/${data.changeOrderId}`);
              else if (n.projectId) router.push(`/projects/${n.projectId}`);
            }}
          />
        ))}
      </Card>
    </>
  );
}

function Prefs() {
  const qc = useQueryClient();
  const q = useApi<{ type: NotificationType; enabled: boolean; channels: NotificationChannel[] }[]>(["notification-prefs"], "/notifications/preferences");
  const save = useMutation({
    mutationFn: (p: { type: NotificationType; enabled: boolean; channels: NotificationChannel[] }) => api.put("/notifications/preferences", { preferences: [p] }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["notification-prefs"] }),
  });
  if (q.isLoading) return <LoadingState />;
  if (q.error || !q.data) return <ErrorState offline onRetry={() => void q.refetch()} />;
  return (
    <Card>
      <View className="mb-2 flex-row justify-end gap-6 pr-1">
        <Text variant="label">On</Text>
        <Text variant="label">Push</Text>
      </View>
      {q.data.map((p) => (
        <View key={p.type} className="min-h-12 flex-row items-center gap-3">
          <Text className="flex-1">{NOTIFICATION_TYPE_LABELS[p.type]}</Text>
          <Switch accessibilityLabel={`${NOTIFICATION_TYPE_LABELS[p.type]} notifications`} value={p.enabled} onValueChange={(enabled) => save.mutate({ ...p, enabled })} />
          <Switch
            accessibilityLabel={`${NOTIFICATION_TYPE_LABELS[p.type]} push`}
            disabled={!p.enabled}
            value={p.channels.includes("push")}
            onValueChange={(push) => save.mutate({ ...p, channels: push ? [...new Set<NotificationChannel>([...p.channels, "push"])] : p.channels.filter((c) => c !== "push") })}
          />
        </View>
      ))}
    </Card>
  );
}
