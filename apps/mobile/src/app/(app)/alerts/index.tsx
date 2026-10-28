import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { ApiError } from "@pool/api-client";
import { SEVERITY_LABELS } from "@pool/types";
import { RecommendationRow } from "@/components/intelligence";
import { Card, Chips, EmptyState, ErrorState, LoadingState, Reveal, Screen, Segmented, Text } from "@/components/ui";
import { useProject } from "@/features/data";
import { useRecommendations } from "@/features/intelligence";

type StatusFilter = "active" | "snoozed" | "resolved,expired,superseded" | "dismissed";
type SeverityFilter = "all" | "critical,high" | "critical" | "high" | "medium" | "low";

/** Proactive alert center: every open recommendation across the projects you can see. */
export default function AlertCenter() {
  const params = useLocalSearchParams<{ projectId?: string }>();
  const project = useProject(params.projectId);
  const [status, setStatus] = useState<StatusFilter>("active");
  const [severity, setSeverity] = useState<SeverityFilter>("all");
  const [mine, setMine] = useState<"all" | "me">("all");
  const recs = useRecommendations({
    projectId: params.projectId,
    status,
    severity: severity === "all" ? undefined : severity,
    assigneeId: mine === "me" ? "me" : undefined,
    limit: 100,
  });

  return (
    <Screen kicker={project.data?.name ?? "All projects"} title="Alert center" back onRefresh={() => void recs.refetch()} refreshing={recs.isFetching}>
      <Reveal index={0} className="gap-3">
        <Segmented
          value={mine}
          onChange={setMine}
          options={[
            { value: "all", label: "Everything" },
            { value: "me", label: "Assigned to me" },
          ]}
        />
        <Chips
          value={status}
          onChange={setStatus}
          options={[
            { value: "active", label: "Open" },
            { value: "snoozed", label: "Snoozed" },
            { value: "resolved,expired,superseded", label: "Resolved" },
            { value: "dismissed", label: "Dismissed" },
          ]}
        />
        <Chips
          value={severity}
          onChange={setSeverity}
          options={[
            { value: "all", label: "All severities" },
            { value: "critical,high", label: "Critical & high" },
            ...(["critical", "high", "medium", "low"] as const).map((s) => ({ value: s, label: SEVERITY_LABELS[s] })),
          ]}
        />
      </Reveal>
      <Reveal index={1} className="mt-3">
        {recs.isLoading ? (
          <LoadingState />
        ) : recs.error ? (
          <ErrorState message={recs.error instanceof ApiError ? recs.error.message : "Alerts need a connection."} onRetry={() => void recs.refetch()} />
        ) : recs.data?.length ? (
          <View className="gap-2">
            <Text variant="caption">
              {recs.data.length} item{recs.data.length === 1 ? "" : "s"}, most urgent first. Severity comes from your company&apos;s rules, with the evidence on each item.
            </Text>
            <Card className="py-1">
              {recs.data.map((r) => (
                <RecommendationRow key={r.id} rec={r} showProject={!params.projectId} />
              ))}
            </Card>
          </View>
        ) : (
          <EmptyState icon="checkmark-done-outline" title={status === "active" ? "All clear" : "Nothing here"} message={status === "active" ? "No open alerts match these filters." : "Try another filter."} />
        )}
      </Reveal>
    </Screen>
  );
}
