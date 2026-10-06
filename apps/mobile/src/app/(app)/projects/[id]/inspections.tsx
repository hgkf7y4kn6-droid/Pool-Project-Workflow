import { router, useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import { InspectionBadge } from "@/components/status-badges";
import { Card, EmptyState, EntitySyncBadge, Fab, Screen, Text } from "@/components/ui";
import { useInspections, useProject } from "@/features/data";
import { date, titleCase } from "@/lib/format";
import { useSession } from "@/providers/session";

export default function ProjectInspections() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { can } = useSession();
  const project = useProject(id);
  const list = useInspections(id);
  return (
    <>
      <Screen title="Inspections" subtitle={project.data?.name} back>
        {!list.data?.length && <EmptyState icon="shield-checkmark-outline" title="No inspections yet" />}
        <View className="gap-2">
          {(list.data ?? []).map((i) => (
            <Card key={i.id} onPress={() => router.push(`/inspections/${i.id}`)} className="gap-1">
              <View className="flex-row items-center justify-between">
                <Text variant="bodyStrong">{titleCase(i.inspectionType)}</Text>
                <InspectionBadge result={i.result} />
              </View>
              <Text variant="caption">
                {i.inspectorName} · {i.inspectedAt ? `Inspected ${date(i.inspectedAt)}` : i.scheduledFor ? `Scheduled ${date(i.scheduledFor)}` : "Not scheduled"}
              </Text>
              <EntitySyncBadge type="inspection" id={i.id} />
            </Card>
          ))}
        </View>
      </Screen>
      {can("inspection:create") && <Fab icon="add" label="New inspection" onPress={() => router.push({ pathname: "/inspections/new", params: { projectId: id } })} />}
    </>
  );
}
