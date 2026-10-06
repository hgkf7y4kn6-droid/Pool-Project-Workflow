import { useState } from "react";
import { View } from "react-native";
import type { SyncOperation } from "@pool/types";
import { Badge, Button, Card, ConfirmDialog, EmptyState, KeyValue, Screen, SectionHeader, Text } from "@/components/ui";
import { useLocalQuery } from "@/hooks/use-local-query";
import { useSyncQueue } from "@/hooks/use-sync-status";
import { dateTime, fromNow, titleCase } from "@/lib/format";
import { listUploads, processUploads } from "@/lib/sync/uploads";
import { useSync } from "@/providers/sync";

const describe = (op: SyncOperation) => {
  const p = op.payload as Record<string, unknown>;
  const what = (p.title ?? p.label ?? p.body ?? p.caption ?? "") as string;
  return `${titleCase(op.operation)} ${titleCase(op.entityType)}${what ? `: ${String(what).slice(0, 60)}` : ""}`;
};

/**
 * Everything saved on this device that has not reached the server, with its
 * state. Nothing is removed without the user explicitly choosing to.
 */
export default function OfflineQueue() {
  const { state, engine, syncNow } = useSync();
  const ops = useSyncQueue();
  const uploads = useLocalQuery(listUploads, [], ["uploads"]);
  const [discarding, setDiscarding] = useState<SyncOperation | null>(null);

  return (
    <Screen title="Offline queue" back subtitle={state.lastSyncedAt ? `Last synced ${fromNow(state.lastSyncedAt)}` : "Not synced yet"}>
      <Card className="gap-1">
        <KeyValue label="Connection" value={state.online ? "Online" : "Offline"} />
        <KeyValue label="Waiting to sync" value={String(state.pending)} />
        <KeyValue label="Failed" value={String(state.failed)} />
        <KeyValue label="Conflicts" value={String(state.conflicts)} />
        {state.lastError ? <Text className="text-sm text-destructive">{state.lastError}</Text> : null}
        <Button label="Sync now" icon="sync" className="mt-2" loading={state.phase === "pushing" || state.phase === "pulling"} onPress={() => void syncNow()} disabled={!state.online} />
      </Card>

      <SectionHeader title="Changes" />
      {!ops.length ? (
        <EmptyState icon="cloud-done-outline" title="Everything is synced" />
      ) : (
        <View className="gap-3">
          {ops.map((op) => (
            <Card key={op.id} className="gap-2">
              <View className="flex-row items-start justify-between gap-2">
                <Text variant="bodyStrong" className="flex-1">
                  {describe(op)}
                </Text>
                <Badge
                  size="sm"
                  label={op.status === "in_flight" ? "Uploading" : titleCase(op.status)}
                  tone={op.status === "failed" ? "danger" : op.status === "conflict" ? "warning" : "info"}
                />
              </View>
              <Text variant="caption">
                Saved {dateTime(op.createdAt)}
                {op.retryCount ? ` · ${op.retryCount} attempt(s)` : ""}
                {op.nextAttemptAt && op.status === "pending" ? ` · retry ${fromNow(op.nextAttemptAt)}` : ""}
              </Text>
              {op.lastError ? <Text className="text-sm text-destructive">{op.lastError}</Text> : null}
              {op.status === "conflict" && op.conflict && (
                <View className="gap-2 rounded-xl bg-warning-soft p-3">
                  <Text className="text-sm font-sans-semibold">Someone else changed {op.conflict.conflictingFields.join(", ")}.</Text>
                  {op.conflict.conflictingFields.map((f) => (
                    <Text key={f} className="text-sm">
                      {f}: yours “{String((op.payload as Record<string, unknown>)[f])}” · theirs “{String(op.conflict!.serverRecord[f])}”
                    </Text>
                  ))}
                  <View className="flex-row gap-2">
                    <Button label="Keep mine" size="sm" className="flex-1" onPress={() => void engine?.resolveConflict(op.id, { strategy: "keep_mine" })} />
                    <Button label="Keep theirs" size="sm" variant="outline" className="flex-1" onPress={() => void engine?.resolveConflict(op.id, { strategy: "keep_theirs" })} />
                  </View>
                </View>
              )}
              {op.status === "failed" && (
                <View className="flex-row gap-2">
                  <Button label="Retry" size="sm" icon="refresh" className="flex-1" onPress={() => void engine?.retry(op.id)} />
                  <Button label="Discard" size="sm" variant="outline" className="flex-1" onPress={() => setDiscarding(op)} />
                </View>
              )}
            </Card>
          ))}
        </View>
      )}

      <SectionHeader title="Photo uploads" onPress={() => void processUploads()} actionLabel="Retry now" />
      {!uploads.data?.length ? (
        <Text variant="caption">No photos waiting to upload.</Text>
      ) : (
        <Card className="gap-1">
          {uploads.data.map((u) => (
            <KeyValue key={u.photo_id} label={`Photo ${u.photo_id.slice(0, 8)}`} value={u.status === "waiting_metadata" ? "Waiting to sync details" : u.status === "failed" ? `Failed (${u.attempts}) – retrying` : titleCase(u.status)} />
          ))}
        </Card>
      )}

      <ConfirmDialog
        visible={!!discarding}
        title="Discard this change?"
        message="It will be removed from this device and never reach the server. This cannot be undone."
        confirmLabel="Discard"
        destructive
        onCancel={() => setDiscarding(null)}
        onConfirm={() => {
          if (discarding) void engine?.discard(discarding.id);
          setDiscarding(null);
        }}
      />
    </Screen>
  );
}
