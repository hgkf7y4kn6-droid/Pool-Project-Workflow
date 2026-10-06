import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { PriorityBadge, TaskStatusBadge } from "@/components/status-badges";
import { Card, Chips, EmptyState, EntitySyncBadge, IconButton, Screen, Text } from "@/components/ui";
import { useProject, useStages, useTasks } from "@/features/data";
import { date } from "@/lib/format";
import { useSession } from "@/providers/session";

export default function ProjectTasks() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { can } = useSession();
  const project = useProject(id);
  const stages = useStages(id);
  const [due, setDue] = useState<"open" | "all" | "overdue">("open");
  const tasks = useTasks({ projectId: id, due });
  const groups = [
    ...(stages.data ?? []).map((s) => ({ key: s.id, title: s.name, tasks: (tasks.data ?? []).filter((t) => t.stageId === s.id) })),
    { key: "none", title: "Other tasks", tasks: (tasks.data ?? []).filter((t) => !t.stageId) },
  ].filter((g) => g.tasks.length);

  return (
    <Screen
      title="Tasks"
      subtitle={project.data?.name}
      back
      actions={can("task:create") ? <IconButton icon="add-circle" tone="primary" label="New task" onPress={() => router.push({ pathname: "/tasks/new", params: { projectId: id } })} /> : null}
    >
      <Chips className="mb-3" value={due} onChange={setDue} options={[{ value: "open", label: "Open" }, { value: "overdue", label: "Overdue" }, { value: "all", label: "All" }]} />
      {!groups.length && <EmptyState icon="checkbox-outline" title="No tasks" />}
      {groups.map((g) => (
        <View key={g.key} className="mb-4">
          <Text variant="label" className="mb-2 uppercase">
            {g.title}
          </Text>
          <View className="gap-2">
            {g.tasks.map((t) => (
              <Card key={t.id} onPress={() => router.push(`/tasks/${t.id}`)} className="gap-1">
                <View className="flex-row items-start justify-between gap-2">
                  <Text variant="bodyStrong" className="flex-1">
                    {t.title}
                  </Text>
                  <TaskStatusBadge status={t.status} />
                </View>
                <View className="flex-row flex-wrap items-center gap-2">
                  <Text variant="caption">{t.plannedStartDate ? `${date(t.plannedStartDate)} → ${date(t.plannedEndDate)}` : "Unscheduled"}</Text>
                  <PriorityBadge priority={t.priority} />
                  <EntitySyncBadge type="task" id={t.id} />
                </View>
              </Card>
            ))}
          </View>
        </View>
      ))}
    </Screen>
  );
}
