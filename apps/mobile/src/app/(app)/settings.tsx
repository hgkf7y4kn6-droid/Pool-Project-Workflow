import { router } from "expo-router";
import { useState } from "react";
import { Switch, View } from "react-native";
import { Button, Card, ConfirmDialog, KeyValue, ListItem, Screen, SectionHeader, Text } from "@/components/ui";
import { useProjects } from "@/features/data";
import { config } from "@/lib/config";
import { getJSON, KV_KEYS, setJSON } from "@/lib/kv";
import { useSession } from "@/providers/session";
import { useSync } from "@/providers/sync";

/** Security (biometrics, sessions, MFA), offline storage and account. */
export default function Settings() {
  const { biometricsAvailable, biometricsEnabled, setBiometricsEnabled, signOut, user } = useSession();
  const { state, engine } = useSync();
  const projects = useProjects("all");
  const [pinned, setPinned] = useState<string[]>(getJSON(KV_KEYS.pinnedProjects, []));
  const [confirmWipe, setConfirmWipe] = useState(false);
  const togglePin = (id: string) => {
    const next = pinned.includes(id) ? pinned.filter((p) => p !== id) : [...pinned, id];
    setPinned(next);
    setJSON(KV_KEYS.pinnedProjects, next);
    void engine?.resetCursor().then(() => engine.sync());
  };
  return (
    <Screen title="Settings" back>
      <SectionHeader title="Security" />
      <Card className="gap-2">
        <View className="min-h-12 flex-row items-center justify-between">
          <View className="flex-1">
            <Text variant="bodyStrong">Biometric unlock</Text>
            <Text variant="caption">{biometricsAvailable ? "Require Face ID / fingerprint to open the app" : "Not available on this device"}</Text>
          </View>
          <Switch accessibilityLabel="Biometric unlock" disabled={!biometricsAvailable} value={biometricsEnabled} onValueChange={(v) => void setBiometricsEnabled(v)} />
        </View>
        <ListItem icon="key-outline" title="Two-step verification" subtitle={user?.mfaEnabled ? "On" : "Off — set up from the web admin"} />
      </Card>

      <SectionHeader title="Offline projects" />
      <Card>
        <Text variant="caption" className="mb-2">
          {pinned.length ? "Only pinned projects are stored for offline use." : "All your projects are available offline. Pin projects to limit storage on this device."}
        </Text>
        {(projects.data ?? []).map((p) => (
          <View key={p.id} className="min-h-12 flex-row items-center justify-between">
            <Text className="flex-1">{p.name}</Text>
            <Switch accessibilityLabel={`Keep ${p.name} offline`} value={!pinned.length || pinned.includes(p.id)} onValueChange={() => togglePin(p.id)} />
          </View>
        ))}
      </Card>

      <SectionHeader title="Sync" />
      <Card>
        <KeyValue label="Waiting to sync" value={String(state.pending)} />
        <KeyValue label="Needs attention" value={String(state.failed + state.conflicts)} />
        <Button label="Open offline queue" variant="ghost" onPress={() => router.push("/offline-queue")} />
      </Card>

      <SectionHeader title="About" />
      <Card>
        <KeyValue label="Server" value={config.apiUrl} />
        <KeyValue label="Environment" value={config.appEnv} />
      </Card>

      <View className="mt-6 gap-2">
        <Button label="Sign out" variant="outline" icon="log-out-outline" onPress={() => void signOut()} />
        <Button label="Sign out and erase device data" variant="ghost" onPress={() => setConfirmWipe(true)} />
      </View>
      <ConfirmDialog
        visible={confirmWipe}
        title="Erase device data?"
        message={state.pending ? `${state.pending} change(s) have not synced yet and will be lost.` : "All project data stored on this device will be removed."}
        confirmLabel="Erase"
        destructive
        onCancel={() => setConfirmWipe(false)}
        onConfirm={() => void signOut({ wipe: true })}
      />
    </Screen>
  );
}
