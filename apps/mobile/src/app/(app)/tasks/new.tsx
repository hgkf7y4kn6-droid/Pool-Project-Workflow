import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { TASK_PRIORITIES, type SessionUser, type TaskPriority } from "@pool/types";
import { Button, Card, Chips, DateField, IconButton, Screen, SectionHeader, Select, Text, TextField } from "@/components/ui";
import { useApi, useStages } from "@/features/data";
import { titleCase } from "@/lib/format";
import { createTask } from "@/lib/mutations";
import { useSession } from "@/providers/session";

/** Create a task (works offline: queued and synced later). */
export default function NewTask() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const { can } = useSession();
  const stages = useStages(projectId);
  const users = useApi<SessionUser[]>(["users"], can("task:assign") ? "/users" : null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [stageId, setStageId] = useState<string | null>(null);
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [start, setStart] = useState<string | null>(null);
  const [duration, setDuration] = useState("1");
  const [priority, setPriority] = useState<TaskPriority>("normal");
  const [items, setItems] = useState<{ label: string; required: boolean; requiresPhoto: boolean }[]>([]);
  const [newItem, setNewItem] = useState("");
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!title.trim()) return setError("Give the task a title");
    const id = await createTask(projectId, {
      title: title.trim(),
      description: description.trim() || undefined,
      stageId,
      assigneeId,
      plannedStartDate: start,
      durationDays: Math.max(1, Number(duration) || 1),
      priority,
      checklist: items,
    });
    router.replace(`/tasks/${id}`);
  };

  return (
    <Screen title="New task" back>
      <View className="gap-4">
        <TextField label="Title" value={title} onChangeText={setTitle} error={error} required />
        <TextField label="Description" value={description} onChangeText={setDescription} multiline />
        <Select label="Stage" value={stageId} allowClear onChange={setStageId} options={(stages.data ?? []).map((s) => ({ value: s.id, label: s.name }))} />
        {can("task:assign") && <Select label="Assign to" value={assigneeId} allowClear onChange={setAssigneeId} options={(users.data ?? []).filter((u) => u.role !== "client").map((u) => ({ value: u.id, label: u.fullName }))} />}
        <View className="flex-row gap-3">
          <View className="flex-[2]">
            <DateField label="Start" value={start} onChange={setStart} />
          </View>
          <TextField className="flex-1" label="Days" value={duration} onChangeText={setDuration} keyboardType="number-pad" />
        </View>
        <Text variant="label">Priority</Text>
        <Chips value={priority} onChange={setPriority} options={TASK_PRIORITIES.map((p) => ({ value: p, label: titleCase(p) }))} />

        <SectionHeader title="Checklist" />
        <Card className="gap-2">
          {items.map((it, i) => (
            <View key={i} className="flex-row items-center gap-2">
              <Text className="flex-1">{it.label}</Text>
              <Chips
                value={it.requiresPhoto ? "photo" : it.required ? "req" : "opt"}
                onChange={(v) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, required: v !== "opt", requiresPhoto: v === "photo" } : x)))}
                options={[{ value: "opt", label: "Optional" }, { value: "req", label: "Required" }, { value: "photo", label: "Photo" }]}
              />
              <IconButton icon="trash-outline" tone="danger" label={`Remove ${it.label}`} onPress={() => setItems((xs) => xs.filter((_, j) => j !== i))} />
            </View>
          ))}
          <View className="flex-row items-end gap-2">
            <TextField className="flex-1" label="Add item" value={newItem} onChangeText={setNewItem} onSubmitEditing={() => { if (newItem.trim()) { setItems((xs) => [...xs, { label: newItem.trim(), required: true, requiresPhoto: false }]); setNewItem(""); } }} />
            <IconButton icon="add-circle" tone="primary" label="Add checklist item" onPress={() => { if (newItem.trim()) { setItems((xs) => [...xs, { label: newItem.trim(), required: true, requiresPhoto: false }]); setNewItem(""); } }} />
          </View>
        </Card>
        <Button label="Create task" icon="checkmark" onPress={() => void save()} />
      </View>
    </Screen>
  );
}
