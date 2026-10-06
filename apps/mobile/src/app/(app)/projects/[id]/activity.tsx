import { useLocalSearchParams } from "expo-router";
import { ActivityFeed, Card, EmptyState, Screen } from "@/components/ui";
import { useActivity, useProject } from "@/features/data";

/** Chronological audit trail for the project. */
export default function Activity() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const project = useProject(id);
  const feed = useActivity(id, 300);
  return (
    <Screen title="Activity" subtitle={project.data?.name} back>
      {feed.data?.length ? <Card><ActivityFeed items={feed.data} /></Card> : <EmptyState icon="pulse-outline" title="No activity yet" />}
    </Screen>
  );
}
