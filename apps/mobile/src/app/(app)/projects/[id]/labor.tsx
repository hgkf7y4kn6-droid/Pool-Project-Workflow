import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { BottomSheet, Button, Card, Chips, DateField, EmptyState, EntitySyncBadge, Fab, KeyValue, ListItem, Screen, Select, Stat, Text, TextField } from "@/components/ui";
import { useProject, useTasks } from "@/features/data";
import { useLocalQuery } from "@/hooks/use-local-query";
import { listRecords } from "@/lib/db/records";
import { date, todayISO } from "@/lib/format";
import { logLabor } from "@/lib/mutations";
import { useActor, useSession } from "@/providers/session";

interface LaborRow {
  id: string;
  userId: string;
  userName?: string;
  taskId: string | null;
  workDate: string;
  hours: number;
  notes: string | null;
}

/** Time tracking: crews log hours offline against tasks; estimated vs actual per task. */
export default function Labor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const actor = useActor();
  const { can } = useSession();
  const project = useProject(id);
  const tasks = useTasks({ projectId: id, due: "all" });
  const entries = useLocalQuery(() => listRecords<LaborRow>("labor_entry", { projectId: id, order: "desc", where: "json_extract(data, '$.deletedAt') IS NULL" }), [id], ["labor_entry"]);
  const [open, setOpen] = useState(false);
  const total = (entries.data ?? []).reduce((s, e) => s + e.hours, 0);
  const estimated = (tasks.data ?? []).reduce((s, t) => s + (t.estimatedHours ?? 0), 0);
  const taskTitle = (tid: string | null) => tasks.data?.find((t) => t.id === tid)?.title ?? "General";
  const byTask = (tasks.data ?? []).filter((t) => t.estimatedHours || t.actualHours).slice(0, 12);

  return (
    <>
      <Screen title="Labor" subtitle={project.data?.name} back>
        <View className="flex-row flex-wrap gap-3">
          <Stat label="Hours logged" value={`${total.toFixed(1)}h`} />
          <Stat label="Estimated" value={`${estimated.toFixed(0)}h`} tone={total > estimated && estimated > 0 ? "warning" : "default"} />
        </View>
        {byTask.length ? (
          <Card className="mt-4">
            <Text variant="h3" className="mb-2">
              Estimated vs actual by task
            </Text>
            {byTask.map((t) => (
              <KeyValue key={t.id} label={t.title} value={`${t.actualHours.toFixed(1)} / ${t.estimatedHours ?? "–"}h`} />
            ))}
          </Card>
        ) : null}
        <Text variant="h2" className="mb-2 mt-5">
          Entries
        </Text>
        {!entries.data?.length ? (
          <EmptyState icon="time-outline" title="No hours logged yet" />
        ) : (
          <Card className="py-1">
            {entries.data.map((e) => (
              <ListItem key={e.id} icon="person-outline" title={`${e.hours}h · ${taskTitle(e.taskId)}`} subtitle={`${e.userName ?? (e.userId === actor.userId ? actor.fullName : "Crew")} · ${date(e.workDate)}${e.notes ? ` · ${e.notes}` : ""}`} right={<EntitySyncBadge type="labor_entry" id={e.id} />} />
            ))}
          </Card>
        )}
      </Screen>
      {(can("labor:create") || can("labor:create_own")) && <Fab icon="add" label="Log hours" onPress={() => setOpen(true)} />}
      {open && <LogSheet projectId={id} tasks={(tasks.data ?? []).map((t) => ({ value: t.id, label: t.title }))} onClose={() => setOpen(false)} />}
    </>
  );
}

function LogSheet({ projectId, tasks, onClose }: { projectId: string; tasks: { value: string; label: string }[]; onClose: () => void }) {
  const actor = useActor();
  const [taskId, setTaskId] = useState<string | null>(null);
  const [hours, setHours] = useState("8");
  const [day, setDay] = useState<string | null>(todayISO());
  const [notes, setNotes] = useState("");
  return (
    <BottomSheet visible onClose={onClose} title="Log hours">
      <View className="gap-3">
        <Select label="Task" value={taskId} allowClear onChange={setTaskId} options={tasks} placeholder="General / no task" />
        <Chips value={hours} onChange={setHours} options={["2", "4", "6", "8", "10"].map((h) => ({ value: h, label: `${h}h` }))} />
        <TextField label="Hours" value={hours} onChangeText={setHours} keyboardType="decimal-pad" />
        <DateField label="Date" value={day} onChange={setDay} allowClear={false} />
        <TextField label="Notes" value={notes} onChangeText={setNotes} />
        <Button
          label="Save"
          disabled={!(Number(hours) > 0 && Number(hours) <= 24)}
          onPress={async () => {
            await logLabor({ projectId, taskId, hours: Number(hours), workDate: day ?? todayISO(), notes: notes || null }, actor);
            onClose();
          }}
        />
      </View>
    </BottomSheet>
  );
}
