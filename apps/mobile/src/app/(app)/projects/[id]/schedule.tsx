import { useMutation, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import { router, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import { ApiError } from "@pool/api-client";
import type { ScheduleImpact } from "@pool/core";
import { Badge, BottomSheet, Button, Card, ErrorState, KeyValue, LoadingState, Screen, SectionHeader, Segmented, Text, TextField } from "@/components/ui";
import { useApi } from "@/features/data";
import { useTheme } from "@/hooks/use-theme";
import { api } from "@/lib/api";
import { date, shortDate } from "@/lib/format";
import { useSession } from "@/providers/session";
import { useSync } from "@/providers/sync";

interface ScheduleTask {
  id: string;
  title: string;
  status: string;
  isMilestone: boolean;
  weatherSensitive: boolean;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  totalFloatDays: number | null;
  critical: boolean;
}
interface ScheduleResponse {
  projectFinish: string;
  plannedCompletionDate: string | null;
  tasks: ScheduleTask[];
  dependencies: { id: string; predecessorId: string; successorId: string; type: string; lagDays: number }[];
  milestones: { id: string; name: string; plannedDate: string | null; status: string }[];
  violations: { predecessorId: string; successorId: string; requiredShiftDays: number }[];
  resourceConflicts: { resource: string; date: string; taskIds: string[] }[];
}

const DAY_W = 18;

/** Project timeline: Gantt bars, critical path, dependencies, delay what-if. */
export default function ProjectSchedule() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const q = useApi<ScheduleResponse>(["schedule", id], `/projects/${id}/schedule`);
  const weather = useApi<{ warnings: { taskId: string; date: string; severity: string; message: string }[] }>(["weather", id], `/projects/${id}/weather`, undefined, { retry: false });
  const [view, setView] = useState<"gantt" | "list">("gantt");
  const [shifting, setShifting] = useState<ScheduleTask | null>(null);

  const range = useMemo(() => {
    const dated = (q.data?.tasks ?? []).filter((t) => t.plannedStartDate);
    if (!dated.length) return null;
    const start = dayjs(dated.map((t) => t.plannedStartDate!).sort()[0]);
    const end = dayjs(dated.map((t) => t.plannedEndDate ?? t.plannedStartDate!).sort().at(-1));
    return { start, days: end.diff(start, "day") + 1 };
  }, [q.data]);

  if (q.isLoading) return <Screen title="Schedule" back><LoadingState /></Screen>;
  if (q.error || !q.data) return <Screen title="Schedule" back><ErrorState offline onRetry={() => void q.refetch()} /></Screen>;
  const s = q.data;
  const titleOf = (tid: string) => s.tasks.find((t) => t.id === tid)?.title ?? "task";

  return (
    <Screen title="Schedule" subtitle={`Projected finish ${date(s.projectFinish)}`} back onRefresh={() => void q.refetch()} refreshing={q.isFetching}>
      {weather.data?.warnings.length ? (
        <Card className="mb-3 gap-1 border-warning bg-warning-soft">
          <Text variant="bodyStrong">Weather warnings</Text>
          {weather.data.warnings.slice(0, 4).map((w, i) => (
            <Text key={i} className="text-sm">
              {w.message}
            </Text>
          ))}
          <Text variant="caption">Tap a task below to preview a delay. Nothing is rescheduled without your confirmation.</Text>
        </Card>
      ) : null}
      {s.violations.length ? (
        <Card className="mb-3 border-destructive bg-destructive-soft">
          <Text variant="bodyStrong">Dependency problems</Text>
          {s.violations.map((v, i) => (
            <Text key={i} className="text-sm">
              {titleOf(v.successorId)} starts {v.requiredShiftDays} day(s) before {titleOf(v.predecessorId)} allows.
            </Text>
          ))}
        </Card>
      ) : null}
      {s.resourceConflicts.length ? (
        <Card className="mb-3 border-warning">
          <Text variant="bodyStrong">Crew double-booked on {s.resourceConflicts.length} day(s)</Text>
          <Text variant="caption">First: {date(s.resourceConflicts[0]!.date)} — {s.resourceConflicts[0]!.taskIds.map(titleOf).join(", ")}</Text>
        </Card>
      ) : null}

      <Segmented value={view} onChange={setView} options={[{ value: "gantt", label: "Timeline" }, { value: "list", label: "List" }]} />
      <View className="my-3 flex-row gap-3">
        <Badge label="Critical path" tone="danger" size="sm" />
        <Badge label="Has float" tone="primary" size="sm" />
        <Badge label="Done" tone="success" size="sm" />
      </View>

      {view === "gantt" && range ? (
        <Card className="p-0">
          <ScrollView horizontal>
            <View>
              <View className="flex-row border-b border-border" style={{ marginLeft: 150 }}>
                {Array.from({ length: Math.ceil(range.days / 7) }, (_, w) => (
                  <Text key={w} variant="caption" style={{ width: DAY_W * 7 }} className="py-1">
                    {range.start.add(w * 7, "day").format("MMM D")}
                  </Text>
                ))}
              </View>
              {s.tasks.filter((t) => t.plannedStartDate).map((t) => {
                const offset = dayjs(t.plannedStartDate!).diff(range.start, "day");
                const len = Math.max(dayjs(t.plannedEndDate ?? t.plannedStartDate!).diff(dayjs(t.plannedStartDate!), "day") + 1, 1);
                const color = t.status === "done" ? colors.success : t.critical ? colors.destructive : colors.primary;
                return (
                  <View key={t.id} className="h-11 flex-row items-center border-b border-border">
                    <Text numberOfLines={1} style={{ width: 150 }} className="px-2 text-sm" onPress={() => router.push(`/tasks/${t.id}`)}>
                      {t.title}
                    </Text>
                    <View style={{ width: range.days * DAY_W }}>
                      {t.isMilestone ? (
                        <View style={{ marginLeft: offset * DAY_W, width: 14, height: 14, transform: [{ rotate: "45deg" }], backgroundColor: colors.accent }} />
                      ) : (
                        <View accessibilityLabel={`${t.title}: ${shortDate(t.plannedStartDate)} to ${shortDate(t.plannedEndDate)}`} style={{ marginLeft: offset * DAY_W, width: len * DAY_W - 2, height: 18, borderRadius: 5, backgroundColor: color }} />
                      )}
                    </View>
                  </View>
                );
              })}
            </View>
          </ScrollView>
        </Card>
      ) : (
        <View className="gap-2">
          {s.tasks.map((t) => (
            <Card key={t.id} onPress={() => setShifting(t)} className="gap-1">
              <View className="flex-row items-center justify-between gap-2">
                <Text variant="bodyStrong" className="flex-1">
                  {t.isMilestone ? "◆ " : ""}
                  {t.title}
                </Text>
                {t.critical ? <Badge label="Critical" tone="danger" size="sm" /> : t.totalFloatDays ? <Badge label={`${t.totalFloatDays}d float`} tone="primary" size="sm" /> : null}
              </View>
              <Text variant="caption">
                {date(t.plannedStartDate)} → {date(t.plannedEndDate)}
                {t.weatherSensitive ? " · weather-sensitive" : ""}
              </Text>
            </Card>
          ))}
        </View>
      )}

      <SectionHeader title="Milestones" />
      <Card>
        {s.milestones.map((m) => (
          <KeyValue key={m.id} label={m.name} value={`${date(m.plannedDate)} · ${m.status.replace("_", " ")}`} />
        ))}
      </Card>
      {shifting && <ShiftSheet projectId={id} task={shifting} onClose={() => setShifting(null)} />}
    </Screen>
  );
}

/** Delay what-if: preview downstream impacts, then apply only on confirmation. */
function ShiftSheet({ projectId, task, onClose }: { projectId: string; task: ScheduleTask; onClose: () => void }) {
  const { can } = useSession();
  const { syncNow } = useSync();
  const qc = useQueryClient();
  const [days, setDays] = useState("1");
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<(ScheduleImpact & { applied: boolean }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = useMutation({
    mutationFn: (apply: boolean) => api.post<ScheduleImpact & { applied: boolean }>(`/projects/${projectId}/schedule/shift`, { taskId: task.id, delayDays: Number(days) || 0, reason: reason || null, apply }),
    onSuccess: async (res) => {
      setPreview(res);
      if (res.applied) {
        await syncNow();
        void qc.invalidateQueries();
        onClose();
      }
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Needs a connection"),
  });
  return (
    <BottomSheet visible onClose={onClose} title={`Delay ${task.title}`}>
      <View className="gap-3">
        <TextField label="Delay (working days)" value={days} onChangeText={setDays} keyboardType="number-pad" />
        <TextField label="Reason" value={reason} onChangeText={setReason} placeholder="e.g. Heavy rain forecast" />
        <Button label="Preview impact" variant="secondary" loading={run.isPending && !preview} onPress={() => run.mutate(false)} />
        {preview && (
          <Card className="gap-1">
            <Text variant="bodyStrong">
              {preview.completionSlipDays ? `Completion moves ${preview.completionSlipDays} working day(s) to ${date(preview.proposedFinish)}` : "Completion date is not affected (float absorbs it)"}
            </Text>
            {preview.impacted.map((i) => (
              <Text key={i.id} className="text-sm">
                {i.title}: {shortDate(i.previousStart)} → {shortDate(i.proposedStart)}
              </Text>
            ))}
          </Card>
        )}
        {error ? <Text className="text-sm text-destructive">{error}</Text> : null}
        {preview && can("schedule:update") && <Button label="Apply to schedule" loading={run.isPending} onPress={() => run.mutate(true)} />}
        <Button label="Open task" variant="ghost" onPress={() => { onClose(); router.push(`/tasks/${task.id}`); }} />
      </View>
    </BottomSheet>
  );
}
