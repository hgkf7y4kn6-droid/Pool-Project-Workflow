import dayjs from "dayjs";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import type { Task } from "@pool/types";
import { TaskStatusBadge } from "@/components/status-badges";
import { Card, Chips, EmptyState, IconButton, MonthGrid, Screen, Segmented, Select, Text } from "@/components/ui";
import { useApi, useProjects, useTasks } from "@/features/data";
import { useUser } from "@/providers/session";

type View3 = "day" | "week" | "month";
interface Team {
  id: string;
  name: string;
  kind: string;
}

const covers = (t: Task, iso: string) => !!t.plannedStartDate && t.plannedStartDate <= iso && (t.plannedEndDate ?? t.plannedStartDate) >= iso;

/** Calendar with day/week/month views, crew filter and per-day task lists (offline). */
export default function Schedule() {
  const user = useUser();
  const [mode, setMode] = useState<View3>("week");
  const [cursor, setCursor] = useState(dayjs());
  const [selected, setSelected] = useState(dayjs().format("YYYY-MM-DD"));
  const [crew, setCrew] = useState<string | null>(null);
  const [mineOnly, setMineOnly] = useState<"all" | "mine">(user.role === "field_worker" ? "mine" : "all");
  const tasks = useTasks({ due: "all" });
  const projects = useProjects("all");
  const teams = useApi<Team[]>(["teams"], "/teams");
  const projectName = (id: string) => projects.data?.find((p) => p.id === id)?.name ?? "";

  const filtered = useMemo(
    () =>
      (tasks.data ?? []).filter(
        (t) => t.status !== "cancelled" && (!crew || t.crewTeamId === crew) && (mineOnly === "all" || t.assigneeId === user.id),
      ),
    [tasks.data, crew, mineOnly, user.id],
  );
  const marks = useMemo(() => {
    const m: Record<string, number> = {};
    const start = cursor.startOf("month").startOf("week");
    for (let i = 0; i < 42; i++) {
      const iso = start.add(i, "day").format("YYYY-MM-DD");
      m[iso] = filtered.filter((t) => covers(t, iso)).length;
    }
    return m;
  }, [filtered, cursor]);

  const days = mode === "day" ? [dayjs(selected)] : mode === "week" ? Array.from({ length: 7 }, (_, i) => dayjs(selected).startOf("week").add(i, "day")) : [dayjs(selected)];
  const step = (dir: 1 | -1) => {
    const unit = mode === "month" ? "month" : mode === "week" ? "week" : "day";
    const next = dayjs(selected).add(dir, unit);
    setSelected(next.format("YYYY-MM-DD"));
    setCursor(next);
  };

  return (
    <Screen title="Schedule" subtitle={mode === "month" ? cursor.format("MMMM YYYY") : mode === "week" ? `Week of ${dayjs(selected).startOf("week").format("MMM D")}` : dayjs(selected).format("dddd, MMM D")}>
      <View className="gap-3">
        <Segmented value={mode} onChange={setMode} options={[{ value: "day", label: "Day" }, { value: "week", label: "Week" }, { value: "month", label: "Month" }]} />
        <View className="flex-row items-center justify-between">
          <IconButton icon="chevron-back" label="Previous" onPress={() => step(-1)} />
          <Pressable accessibilityRole="button" onPress={() => { setSelected(dayjs().format("YYYY-MM-DD")); setCursor(dayjs()); }} className="min-h-11 justify-center rounded-full bg-muted px-4">
            <Text className="font-sans-semibold text-sm">Today</Text>
          </Pressable>
          <IconButton icon="chevron-forward" label="Next" onPress={() => step(1)} />
        </View>
        <View className="flex-row gap-2">
          <View className="flex-1">
            <Select label="Crew" value={crew} allowClear onChange={setCrew} options={(teams.data ?? []).filter((t) => t.kind === "crew").map((t) => ({ value: t.id, label: t.name }))} placeholder="All crews" />
          </View>
        </View>
        <Chips value={mineOnly} onChange={setMineOnly} options={[{ value: "all", label: "All work" }, { value: "mine", label: "My work" }]} />
      </View>

      {mode === "month" && (
        <Card className="mt-4">
          <MonthGrid month={cursor} selected={selected} marks={marks} onSelect={setSelected} />
        </Card>
      )}

      {mode === "week" && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mt-4" contentContainerClassName="gap-2">
          {days.map((d) => {
            const iso = d.format("YYYY-MM-DD");
            const count = filtered.filter((t) => covers(t, iso)).length;
            const active = iso === selected;
            return (
              <Pressable key={iso} accessibilityRole="button" accessibilityLabel={`${d.format("dddd MMM D")}, ${count} tasks`} onPress={() => setSelected(iso)} className={active ? "w-16 items-center rounded-2xl bg-primary py-3" : "w-16 items-center rounded-2xl border border-border bg-card py-3"}>
                <Text className={active ? "text-xs font-sans-semibold text-primary-foreground" : "text-xs font-sans-semibold text-muted-foreground"}>{d.format("ddd")}</Text>
                <Text className={active ? "font-sans-bold text-xl text-primary-foreground" : "font-sans-bold text-xl text-foreground"}>{d.date()}</Text>
                <Text className={active ? "text-xs text-primary-foreground" : "text-xs text-muted-foreground"}>{count ? `${count} tasks` : "—"}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      <Text variant="h2" className="mb-2 mt-5">
        {dayjs(selected).format("dddd, MMMM D")}
      </Text>
      {(() => {
        const list = filtered.filter((t) => covers(t, selected));
        if (!list.length) return <EmptyState icon="calendar-clear-outline" title="Nothing scheduled" />;
        return (
          <View className="gap-2">
            {list.map((t) => (
              <Card key={t.id} onPress={() => router.push(`/tasks/${t.id}`)} className="flex-row items-center gap-3">
                <View className={t.isMilestone ? "size-3 rotate-45 bg-accent" : "h-10 w-1.5 rounded-full bg-primary"} />
                <View className="flex-1">
                  <Text variant="bodyStrong">{t.title}</Text>
                  <Text variant="caption">
                    {projectName(t.projectId)}
                    {t.weatherSensitive ? " · weather-sensitive" : ""}
                  </Text>
                </View>
                <TaskStatusBadge status={t.status} />
              </Card>
            ))}
          </View>
        );
      })()}
    </Screen>
  );
}
