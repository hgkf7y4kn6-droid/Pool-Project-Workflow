import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { FlatList, View } from "react-native";
import { PriorityBadge, TaskStatusBadge } from "@/components/status-badges";
import { Card, Chips, EmptyState, EntitySyncBadge, LoadingState, Screen, SearchBar, Text } from "@/components/ui";
import { useProjects, useTasks } from "@/features/data";
import { date } from "@/lib/format";
import { useUser } from "@/providers/session";

type Due = "today" | "overdue" | "upcoming" | "open" | "all";

export default function Tasks() {
  const user = useUser();
  const params = useLocalSearchParams<{ due?: Due }>();
  const [due, setDue] = useState<Due>(params.due ?? "open");
  const [who, setWho] = useState<"me" | "everyone">(user.role === "field_worker" || user.role === "subcontractor" ? "me" : "everyone");
  const [search, setSearch] = useState("");
  const { data, loading } = useTasks({ due, assigneeId: who === "me" ? user.id : undefined, search });
  const projects = useProjects("all");
  const projectName = (id: string) => projects.data?.find((p) => p.id === id)?.name ?? "";

  return (
    <Screen title="Tasks" scroll={false}>
      <View className="gap-3 pb-3">
        <SearchBar value={search} onChangeText={setSearch} placeholder="Search tasks" />
        <Chips
          value={due}
          onChange={setDue}
          options={[
            { value: "open", label: "Open" },
            { value: "today", label: "Today" },
            { value: "overdue", label: "Overdue" },
            { value: "upcoming", label: "Upcoming" },
            { value: "all", label: "All" },
          ]}
        />
        {user.role !== "field_worker" && user.role !== "subcontractor" && (
          <Chips value={who} onChange={setWho} options={[{ value: "everyone", label: "Everyone" }, { value: "me", label: "Assigned to me" }]} />
        )}
      </View>
      {loading ? (
        <LoadingState />
      ) : (
        <FlatList
          data={data}
          keyExtractor={(t) => t.id}
          contentContainerClassName="gap-2 pb-40"
          initialNumToRender={15}
          ListEmptyComponent={<EmptyState icon="checkbox-outline" title="No tasks here" />}
          renderItem={({ item: t }) => (
            <Card onPress={() => router.push(`/tasks/${t.id}`)} className="gap-1">
              <View className="flex-row items-start justify-between gap-2">
                <Text variant="bodyStrong" className="flex-1" numberOfLines={2}>
                  {t.title}
                </Text>
                <TaskStatusBadge status={t.status} />
              </View>
              <Text variant="caption" numberOfLines={1}>
                {projectName(t.projectId)}
              </Text>
              <View className="flex-row flex-wrap items-center gap-2">
                <Text variant="caption">{t.plannedStartDate ? `${date(t.plannedStartDate)} → ${date(t.plannedEndDate)}` : t.dueDate ? `Due ${date(t.dueDate)}` : "Unscheduled"}</Text>
                <PriorityBadge priority={t.priority} />
                <EntitySyncBadge type="task" id={t.id} />
              </View>
            </Card>
          )}
        />
      )}
    </Screen>
  );
}
