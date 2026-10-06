import { router, type Href } from "expo-router";
import { useEffect, useState } from "react";
import { Card, EmptyState, ListItem, Screen, SearchBar, Text } from "@/components/ui";
import type { IconName } from "@/components/icon";
import { useApi, useProjects, useTasks } from "@/features/data";
import { titleCase } from "@/lib/format";

interface Hit {
  type: string;
  id: string;
  title: string;
  subtitle: string | null;
  projectId: string | null;
}

const ICON: Record<string, IconName> = {
  project: "construct-outline",
  client: "person-outline",
  task: "checkbox-outline",
  document: "document-text-outline",
  photo: "image-outline",
  material: "cube-outline",
  change_order: "swap-horizontal-outline",
};

const target = (h: Hit): Href | null =>
  h.type === "project" ? `/projects/${h.id}` : h.type === "task" ? `/tasks/${h.id}` : h.type === "client" ? `/clients/${h.id}` : h.type === "document" ? `/documents/${h.id}` : h.type === "change_order" ? `/change-orders/${h.id}` : h.type === "photo" && h.projectId ? `/projects/${h.projectId}/photos` : null;

/** Global search: server full-text when online, on-device projects/tasks when offline. */
export default function Search() {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  const remote = useApi<Hit[]>(["search", debounced], debounced.length >= 2 ? "/search" : null, { q: debounced });
  const localProjects = useProjects("all", debounced);
  const localTasks = useTasks({ due: "all", search: debounced });
  const offline = !!remote.error;
  const hits: Hit[] = offline
    ? [
        ...(localProjects.data ?? []).map((p) => ({ type: "project", id: p.id, title: p.name, subtitle: p.clientName ?? null, projectId: p.id })),
        ...(localTasks.data ?? []).slice(0, 30).map((t) => ({ type: "task", id: t.id, title: t.title, subtitle: titleCase(t.status), projectId: t.projectId })),
      ]
    : (remote.data ?? []);
  return (
    <Screen title="Search" back>
      <SearchBar value={q} onChangeText={setQ} placeholder="Projects, clients, tasks, documents…" />
      {offline && debounced ? (
        <Text variant="caption" className="mt-2">
          Offline: searching projects and tasks on this device.
        </Text>
      ) : null}
      {debounced.length < 2 ? (
        <EmptyState icon="search" title="Type at least 2 characters" />
      ) : !hits.length ? (
        remote.isLoading ? null : <EmptyState icon="search" title="No results" />
      ) : (
        <Card className="mt-3 py-1">
          {hits.map((h) => (
            <ListItem key={`${h.type}:${h.id}`} icon={ICON[h.type] ?? "ellipse-outline"} title={h.title} subtitle={`${titleCase(h.type)}${h.subtitle ? ` · ${h.subtitle}` : ""}`} onPress={target(h) ? () => router.push(target(h)!) : undefined} />
          ))}
        </Card>
      )}
    </Screen>
  );
}
