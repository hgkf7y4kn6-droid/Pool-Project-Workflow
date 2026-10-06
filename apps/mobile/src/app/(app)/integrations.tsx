import { Badge, Card, ErrorState, KeyValue, LoadingState, Screen, SectionHeader, Text } from "@/components/ui";
import { useApi } from "@/features/data";

interface Integrations {
  connected: { id: string; provider: string; kind: string; isEnabled: boolean }[];
  available: { design: { id: string; displayName: string }[]; weather: { id: string }[]; storage: { id: string }[]; push: { id: string }[]; ai: { id: string }[] };
}

/** Configured third-party adapters (all replaceable behind interfaces). */
export default function IntegrationsScreen() {
  const q = useApi<Integrations>(["integrations"], "/integrations");
  if (q.isLoading) return <Screen title="Integrations" back><LoadingState /></Screen>;
  if (q.error || !q.data) return <Screen title="Integrations" back><ErrorState offline onRetry={() => void q.refetch()} /></Screen>;
  const a = q.data.available;
  return (
    <Screen title="Integrations" back>
      <Card>
        <KeyValue label="Design platforms" value={a.design.map((d) => d.displayName).join(", ")} />
        <KeyValue label="Weather" value={a.weather.map((w) => w.id).join(", ")} />
        <KeyValue label="File storage" value={a.storage.map((s) => s.id).join(", ")} />
        <KeyValue label="Push notifications" value={a.push.map((p) => p.id).join(", ")} />
        <KeyValue label="AI assistant" value={a.ai.length ? a.ai.map((x) => x.id).join(", ") : "Not configured"} />
      </Card>
      <SectionHeader title="Company connections" />
      {q.data.connected.length ? (
        <Card>
          {q.data.connected.map((c) => (
            <KeyValue key={c.id} label={`${c.provider} (${c.kind})`} value={<Badge label={c.isEnabled ? "Enabled" : "Disabled"} tone={c.isEnabled ? "success" : "neutral"} size="sm" />} />
          ))}
        </Card>
      ) : (
        <Text variant="caption">No company-specific connections yet. Server-level providers are configured by your administrator through environment settings.</Text>
      )}
    </Screen>
  );
}
