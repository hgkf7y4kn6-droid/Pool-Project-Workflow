import { router } from "expo-router";
import { useMemo, useState } from "react";
import { FlatList, View } from "react-native";
import { PROJECT_STATUSES, PROJECT_STATUS_LABELS, PROJECT_TYPES, PROJECT_TYPE_LABELS, type ProjectStatus, type ProjectType } from "@pool/types";
import { ProjectStatusBadge } from "@/components/status-badges";
import { BottomSheet, Button, Card, Chips, EmptyState, IconButton, LoadingState, ProgressBar, Screen, SearchBar, Select, Text } from "@/components/ui";
import { useProjects, type LocalProject } from "@/features/data";
import { useLayout } from "@/hooks/use-theme";
import { date } from "@/lib/format";
import { useSession } from "@/providers/session";

type Scope = "active" | "upcoming" | "completed" | "archived" | "all";

export default function Projects() {
  const { can, user } = useSession();
  const { columns } = useLayout();
  const [scope, setScope] = useState<Scope>("active");
  const [search, setSearch] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [status, setStatus] = useState<ProjectStatus | null>(null);
  const [type, setType] = useState<ProjectType | null>(null);
  const [mine, setMine] = useState(false);
  const [city, setCity] = useState<string | null>(null);
  const [sort, setSort] = useState<"updated" | "start" | "completion" | "name">("updated");
  const { data, loading } = useProjects(scope, search);

  const cities = useMemo(() => [...new Set((data ?? []).map((p) => p.city).filter(Boolean))] as string[], [data]);
  const rows = useMemo(() => {
    const filtered = (data ?? []).filter(
      (p) => (!status || p.status === status) && (!type || p.type === type) && (!mine || p.projectManagerId === user?.id) && (!city || p.city === city),
    );
    const key = (p: LocalProject) =>
      sort === "name" ? p.name : sort === "start" ? (p.plannedStartDate ?? "9999") : sort === "completion" ? (p.projectedCompletionDate ?? "9999") : "";
    return sort === "updated" ? filtered : [...filtered].sort((a, b) => key(a).localeCompare(key(b)));
  }, [data, status, type, mine, city, sort, user?.id]);
  const activeFilters = [status, type, city].filter(Boolean).length + (mine ? 1 : 0);

  return (
    <Screen
      title="Projects"
      scroll={false}
      actions={can("project:create") ? <IconButton icon="add-circle" label="New project" tone="primary" onPress={() => router.push("/projects/new")} /> : null}
    >
      <View className="gap-3 pb-3">
        <View className="flex-row gap-2">
          <SearchBar value={search} onChangeText={setSearch} placeholder="Search name, client, address" className="flex-1" />
          <Button label={activeFilters ? `Filters (${activeFilters})` : "Filters"} icon="options-outline" variant="outline" size="md" onPress={() => setFiltersOpen(true)} />
        </View>
        <Chips
          value={scope}
          onChange={setScope}
          options={[
            { value: "active", label: "Active" },
            { value: "upcoming", label: "Upcoming" },
            { value: "completed", label: "Completed" },
            { value: "archived", label: "Archived" },
            { value: "all", label: "All" },
          ]}
        />
      </View>
      {loading ? (
        <LoadingState />
      ) : (
        <FlatList
          key={columns}
          data={rows}
          numColumns={columns}
          keyExtractor={(p) => p.id}
          columnWrapperStyle={columns > 1 ? { gap: 12 } : undefined}
          contentContainerClassName="gap-3 pb-40"
          initialNumToRender={10}
          ListEmptyComponent={<EmptyState icon="construct-outline" title="No projects found" message="Try another filter or search." />}
          renderItem={({ item: p }) => (
            <Card className="flex-1" onPress={() => router.push(`/projects/${p.id}`)} accessibilityLabel={`${p.name}, ${PROJECT_STATUS_LABELS[p.status]}, ${p.completionPct}% complete`}>
              <View className="mb-1 flex-row items-start justify-between gap-2">
                <Text variant="h3" className="flex-1" numberOfLines={1}>
                  {p.name}
                </Text>
                <ProjectStatusBadge status={p.status} />
              </View>
              <Text variant="caption" numberOfLines={1}>
                {p.number} · {p.clientName}
              </Text>
              <Text variant="caption" numberOfLines={1}>
                {p.propertyAddress}
              </Text>
              <View className="mt-3">
                <ProgressBar value={p.completionPct} showValue />
              </View>
              <Text variant="caption" className="mt-2">
                {p.plannedStartDate ? `${date(p.plannedStartDate)} → ${date(p.projectedCompletionDate ?? p.plannedCompletionDate)}` : "Not scheduled"}
              </Text>
            </Card>
          )}
        />
      )}
      <BottomSheet visible={filtersOpen} onClose={() => setFiltersOpen(false)} title="Filter projects">
        <View className="gap-4">
          <Select label="Status" value={status} allowClear onChange={setStatus} options={PROJECT_STATUSES.map((s) => ({ value: s, label: PROJECT_STATUS_LABELS[s] }))} />
          <Select label="Project type" value={type} allowClear onChange={setType} options={PROJECT_TYPES.map((t) => ({ value: t, label: PROJECT_TYPE_LABELS[t] }))} />
          <Select label="Location" value={city} allowClear onChange={setCity} options={cities.map((c) => ({ value: c, label: c }))} />
          <Select
            label="Sort by"
            value={sort}
            onChange={(v) => setSort(v ?? "updated")}
            options={[
              { value: "updated", label: "Recently updated" },
              { value: "start", label: "Start date" },
              { value: "completion", label: "Completion date" },
              { value: "name", label: "Name" },
            ]}
          />
          <Chips value={mine ? "mine" : "all"} onChange={(v) => setMine(v === "mine")} options={[{ value: "all", label: "All managers" }, { value: "mine", label: "Managed by me" }]} />
          <Button label="Clear filters" variant="ghost" onPress={() => { setStatus(null); setType(null); setCity(null); setMine(false); }} />
          <Button label="Show results" onPress={() => setFiltersOpen(false)} />
        </View>
      </BottomSheet>
    </Screen>
  );
}
