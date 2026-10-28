import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { ApiError } from "@pool/api-client";
import { COMMUNICATION_KIND_LABELS, type CommunicationAudience, type CommunicationDraft, type CommunicationKind } from "@pool/types";
import { communicationStatusTone } from "@pool/ui";
import { Badge, Button, Card, Chips, EmptyState, ListItem, LoadingState, Reveal, Screen, SectionHeader, Text, TextField } from "@/components/ui";
import { useProject } from "@/features/data";
import { useDrafts, useIntelMutation } from "@/features/intelligence";
import { api } from "@/lib/api";
import { fromNow, titleCase } from "@/lib/format";
import { useSession } from "@/providers/session";

const KINDS: Record<CommunicationAudience, CommunicationKind[]> = {
  homeowner: ["weekly_update", "upcoming_work", "schedule_change", "decision_reminder", "change_order_explanation", "weather_delay", "milestone_complete", "walkthrough"],
  supplier: ["delivery_follow_up", "custom"],
  subcontractor: ["subcontractor_confirmation", "custom"],
  internal: ["weekly_update", "custom"],
};

/** Professional communication composer: drafts from verified facts, reviewed before anything is sent. */
export default function Communications() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { can } = useSession();
  const project = useProject(id);
  const drafts = useDrafts(id);
  const [audience, setAudience] = useState<CommunicationAudience>("homeowner");
  const [kind, setKind] = useState<CommunicationKind>("weekly_update");
  const [guidance, setGuidance] = useState("");
  const create = useIntelMutation(() => api.post<CommunicationDraft>(`/projects/${id}/communications`, { audience, kind, guidance: guidance.trim() || null }));

  return (
    <Screen kicker={project.data?.number ?? "Project"} title="Messages to send" subtitle={project.data?.name} back onRefresh={() => void drafts.refetch()} refreshing={drafts.isFetching}>
      {can("intelligence:manage") ? (
        <Reveal index={0}>
          <Card className="gap-3">
            <Text variant="h3">New draft</Text>
            <Text variant="caption">Written only from verified project facts. Nothing is sent until someone approves it.</Text>
            <Text variant="label">To</Text>
            <Chips
              value={audience}
              onChange={(a) => {
                setAudience(a);
                setKind(KINDS[a][0]!);
              }}
              options={(["homeowner", "supplier", "subcontractor", "internal"] as const).map((a) => ({ value: a, label: titleCase(a) }))}
            />
            <Text variant="label">About</Text>
            <Chips value={kind} onChange={setKind} options={KINDS[audience].map((k) => ({ value: k, label: COMMUNICATION_KIND_LABELS[k] }))} />
            <TextField label="Anything to mention? (optional)" value={guidance} onChangeText={setGuidance} multiline maxLength={500} helper="Treated as a note to the writer, not as a fact." />
            <Button
              label="Write draft"
              icon="create-outline"
              loading={create.isPending}
              onPress={() =>
                create.mutate(undefined, {
                  onSuccess: (d) => {
                    setGuidance("");
                    router.push(`/communications/${d.id}`);
                  },
                })
              }
            />
            {create.error ? <Text className="text-sm text-destructive">{create.error instanceof ApiError ? create.error.message : "Needs a connection"}</Text> : null}
          </Card>
        </Reveal>
      ) : null}

      <SectionHeader kicker="History" title="Drafts" />
      {drafts.isLoading ? (
        <LoadingState rows={3} />
      ) : drafts.data?.length ? (
        <Card className="py-1">
          {drafts.data.map((d) => (
            <ListItem
              key={d.id}
              title={d.subject}
              subtitle={`${COMMUNICATION_KIND_LABELS[d.kind]} · to ${d.audience} · ${d.createdByName ?? "Automation"} · ${fromNow(d.createdAt)}`}
              icon={d.source === "agent" ? "sparkles-outline" : "document-text-outline"}
              right={
                <View className="items-end gap-1">
                  <Badge label={titleCase(d.status)} tone={communicationStatusTone[d.status]} size="sm" />
                  {d.unsupportedClaims.length && d.status === "draft" ? <Badge label={`${d.unsupportedClaims.length} to check`} tone="warning" size="sm" /> : null}
                </View>
              }
              onPress={() => router.push(`/communications/${d.id}`)}
            />
          ))}
        </Card>
      ) : (
        <EmptyState icon="mail-open-outline" title="No drafts yet" message="Write a weekly update or a reminder from the facts on this project." />
      )}
    </Screen>
  );
}
