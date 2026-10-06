import { router, useLocalSearchParams } from "expo-router";
import { Linking, View } from "react-native";
import type { Project } from "@pool/types";
import { ProjectStatusBadge } from "@/components/status-badges";
import { Button, Card, ErrorState, KeyValue, ListItem, LoadingState, Screen, SectionHeader, Text } from "@/components/ui";
import { useApi } from "@/features/data";
import { date, money } from "@/lib/format";

interface ClientDetail {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  alternatePhone: string | null;
  preferredContact: string;
  notes: string | null;
  properties: { id: string; address: { line1: string; city: string; region: string } }[];
  projects: (Pick<Project, "id" | "number" | "name" | "status" | "plannedStartDate" | "plannedCompletionDate" | "contractAmountCents">)[];
  portalUsers: { id: string; email: string; fullName: string; isActive: boolean; lastLoginAt: string | null }[];
}

/** Homeowner record: contacts, properties, project history and portal access. */
export default function ClientDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useApi<ClientDetail>(["client", id], `/clients/${id}`);
  if (q.isLoading) return <Screen title="Client" back><LoadingState /></Screen>;
  if (q.error || !q.data) return <Screen title="Client" back><ErrorState offline onRetry={() => void q.refetch()} /></Screen>;
  const c = q.data;
  return (
    <Screen title={c.fullName} subtitle={`Prefers ${c.preferredContact}`} back>
      <View className="flex-row gap-2">
        {c.phone ? <Button label="Call" icon="call" className="flex-1" onPress={() => void Linking.openURL(`tel:${c.phone}`)} /> : null}
        {c.phone ? <Button label="Text" icon="chatbubble" variant="outline" className="flex-1" onPress={() => void Linking.openURL(`sms:${c.phone}`)} /> : null}
        {c.email ? <Button label="Email" icon="mail" variant="outline" className="flex-1" onPress={() => void Linking.openURL(`mailto:${c.email}`)} /> : null}
      </View>
      <SectionHeader title="Contact" />
      <Card>
        <KeyValue label="Phone" value={c.phone ?? "—"} />
        <KeyValue label="Alternate" value={c.alternatePhone ?? "—"} />
        <KeyValue label="Email" value={c.email ?? "—"} />
        {c.notes ? <Text variant="caption">{c.notes}</Text> : null}
      </Card>
      <SectionHeader title="Properties" />
      <Card className="py-1">
        {c.properties.map((p) => (
          <ListItem key={p.id} icon="home-outline" title={p.address.line1} subtitle={`${p.address.city}, ${p.address.region}`} />
        ))}
      </Card>
      <SectionHeader title="Project history" />
      <View className="gap-2">
        {c.projects.map((p) => (
          <Card key={p.id} onPress={() => router.push(`/projects/${p.id}`)} className="gap-1">
            <View className="flex-row items-center justify-between gap-2">
              <Text variant="bodyStrong" className="flex-1">
                {p.name}
              </Text>
              <ProjectStatusBadge status={p.status} />
            </View>
            <Text variant="caption">
              {p.number} · {money(p.contractAmountCents)} · {date(p.plannedStartDate)} → {date(p.plannedCompletionDate)}
            </Text>
          </Card>
        ))}
      </View>
      <SectionHeader title="Client portal" />
      <Card>
        {c.portalUsers.length ? (
          c.portalUsers.map((u) => <KeyValue key={u.id} label={u.email} value={u.lastLoginAt ? `Last login ${date(u.lastLoginAt)}` : "Invited"} />)
        ) : (
          <Button label="Invite to client portal" variant="secondary" onPress={() => router.push({ pathname: "/team", params: { inviteClientId: c.id, inviteEmail: c.email ?? "", inviteName: c.fullName } })} />
        )}
      </Card>
    </Screen>
  );
}
