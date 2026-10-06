import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { checklistProgress } from "@pool/core";
import type { ChecklistItem, TaskStatus } from "@pool/types";
import { Icon } from "@/components/icon";
import { PriorityBadge, TaskStatusBadge } from "@/components/status-badges";
import {
  BottomSheet,
  Button,
  Card,
  Chips,
  ConfirmDialog,
  EmptyState,
  EntitySyncBadge,
  KeyValue,
  ListItem,
  PhotoGrid,
  ProgressBar,
  Screen,
  SectionHeader,
  Text,
  TextField,
} from "@/components/ui";
import { useChecklist, usePhotos, useProject, useTask, useTaskNotes } from "@/features/data";
import { useLocalQuery } from "@/hooks/use-local-query";
import { listRecords } from "@/lib/db/records";
import { date, dateTime } from "@/lib/format";
import { addTaskNote, completeTask, LocalRuleError, logLabor, toggleChecklistItem, updateTaskStatus } from "@/lib/mutations";
import { useActor, useSession } from "@/providers/session";

/**
 * Task detail, optimised for the field: big status buttons, one-tap
 * checklist, camera shortcut that auto-links project/task/stage, problem
 * reports and hour logging — all work offline.
 */
export default function TaskDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const actor = useActor();
  const { can } = useSession();
  const task = useTask(id);
  const t = task.data;
  const project = useProject(t?.projectId);
  const checklist = useChecklist(id);
  const notes = useTaskNotes(id);
  const photos = usePhotos({ projectId: t?.projectId, taskId: id });
  const labor = useLocalQuery(() => listRecords<{ id: string; hours: number; workDate: string; userName?: string }>("labor_entry", { parentId: id, order: "desc" }), [id], ["labor_entry"]);
  const [error, setError] = useState<string | null>(null);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [noteOpen, setNoteOpen] = useState<null | "note" | "problem">(null);
  const [note, setNote] = useState("");
  const [hoursOpen, setHoursOpen] = useState(false);
  const [hours, setHours] = useState("8");

  if (!t) {
    return (
      <Screen title="Task" back>
        {task.loading ? null : <EmptyState icon="help-circle-outline" title="Task not found on this device" />}
      </Screen>
    );
  }
  const canEdit = can("task:update") || (t.assigneeId === actor.userId && can("task:update_assigned"));
  const progress = checklistProgress(checklist.data ?? []);
  const photoCountFor = (item: ChecklistItem) => (photos.data ?? []).filter((p) => p.checklistItemId === item.id).length;

  const setStatus = async (status: TaskStatus) => {
    setError(null);
    try {
      await updateTaskStatus(t, status, actor);
    } catch (e) {
      if (e instanceof LocalRuleError && status === "done" && can("task:override_checklist")) setOverrideOpen(true);
      setError(e instanceof Error ? e.message : "Could not update the task");
    }
  };

  const openCamera = (checklistItemId?: string) =>
    router.push({ pathname: "/camera", params: { projectId: t.projectId, taskId: t.id, stageId: t.stageId ?? "", checklistItemId: checklistItemId ?? "" } });

  return (
    <Screen title={t.title} subtitle={project.data?.name} back>
      <View className="mb-2 flex-row flex-wrap items-center gap-2">
        <TaskStatusBadge status={t.status} />
        <PriorityBadge priority={t.priority} />
        <EntitySyncBadge type="task" id={t.id} />
        {t.weatherSensitive && <Text variant="caption">☂ weather-sensitive</Text>}
      </View>

      {canEdit && (
        <View className="gap-2">
          <View className="flex-row gap-2">
            {t.status !== "in_progress" && t.status !== "done" && <Button label="Start" icon="play" className="flex-1" onPress={() => void setStatus("in_progress")} />}
            {t.status !== "done" && <Button label="Complete" icon="checkmark-done" variant={t.status === "in_progress" ? "primary" : "outline"} className="flex-1" onPress={() => void setStatus("done")} />}
            {t.status === "done" && <Button label="Reopen" icon="arrow-undo" variant="outline" className="flex-1" onPress={() => void setStatus("in_progress")} />}
          </View>
          <View className="flex-row gap-2">
            <Button label="Photo" icon="camera" variant="secondary" size="sm" className="flex-1 px-2" onPress={() => openCamera()} />
            <Button label="Problem" icon="warning" variant="outline" size="sm" className="flex-1 px-2" onPress={() => setNoteOpen("problem")} />
            <Button label="Hours" icon="time" variant="outline" size="sm" className="flex-1 px-2" onPress={() => setHoursOpen(true)} />
          </View>
        </View>
      )}
      {error ? (
        <Text accessibilityLiveRegion="assertive" className="mt-2 font-sans-medium text-sm text-destructive">
          {error}
        </Text>
      ) : null}

      {checklist.data?.length ? (
        <>
          <SectionHeader title="Checklist" />
          <Card>
            <ProgressBar value={progress.pct} label={`${progress.done} of ${progress.total} done`} tone={progress.pct === 100 ? "success" : "primary"} />
            <View className="mt-2">
              {checklist.data.map((item) => {
                const needsPhoto = item.requiresPhoto && photoCountFor(item) === 0;
                return (
                  <View key={item.id} className="flex-row items-center gap-2 border-b border-border">
                    <Pressable
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: item.isChecked, disabled: !canEdit }}
                      accessibilityLabel={`${item.label}${item.required ? ", required" : ""}${item.requiresPhoto ? ", photo required" : ""}`}
                      disabled={!canEdit}
                      onPress={() => void toggleChecklistItem(item, !item.isChecked, actor)}
                      className="min-h-14 flex-1 flex-row items-center gap-3 py-2"
                    >
                      <Icon name={item.isChecked ? "checkbox" : "square-outline"} className={item.isChecked ? "text-3xl text-success" : "text-3xl text-muted-foreground"} />
                      <View className="flex-1">
                        <Text className={item.isChecked ? "text-base text-muted-foreground line-through" : "text-base text-foreground"}>{item.label}</Text>
                        <View className="flex-row gap-2">
                          {item.required && <Text className="text-xs font-sans-semibold text-warning">Required</Text>}
                          {item.requiresPhoto && <Text className={needsPhoto ? "text-xs font-sans-semibold text-destructive" : "text-xs text-success"}>{needsPhoto ? "Photo needed" : `${photoCountFor(item)} photo(s)`}</Text>}
                        </View>
                      </View>
                    </Pressable>
                    {item.requiresPhoto && canEdit && (
                      <Pressable accessibilityRole="button" accessibilityLabel={`Add photo for ${item.label}`} onPress={() => openCamera(item.id)} className="size-12 items-center justify-center rounded-xl bg-primary-soft">
                        <Icon name="camera" className="text-xl text-primary" />
                      </Pressable>
                    )}
                  </View>
                );
              })}
            </View>
          </Card>
        </>
      ) : null}

      <SectionHeader title="Details" />
      <Card>
        {t.description ? <Text className="mb-2">{t.description}</Text> : null}
        <KeyValue label="Planned" value={`${date(t.plannedStartDate)} → ${date(t.plannedEndDate)}`} />
        <KeyValue label="Actual" value={t.actualStartDate ? `${date(t.actualStartDate)} → ${t.actualEndDate ? date(t.actualEndDate) : "in progress"}` : "Not started"} />
        <KeyValue label="Duration" value={`${t.durationDays} working day(s)`} />
        <KeyValue label="Labor" value={`${(labor.data ?? []).reduce((s, l) => s + l.hours, 0)}h logged${t.estimatedHours ? ` of ${t.estimatedHours}h estimated` : ""}`} />
        {t.completedAt ? <KeyValue label="Completed" value={dateTime(t.completedAt)} /> : null}
      </Card>

      <SectionHeader title="Photos" onPress={canEdit ? () => openCamera() : undefined} actionLabel="Add" />
      {photos.data?.length ? <PhotoGrid photos={photos.data} /> : <Text variant="caption">No photos yet.</Text>}

      <SectionHeader title="Notes" onPress={() => setNoteOpen("note")} actionLabel="Add note" />
      {notes.data?.length ? (
        <Card className="py-1">
          {notes.data.map((n) => (
            <ListItem key={n.id} icon={n.isProblem ? "warning" : "document-text-outline"} iconTone={n.isProblem ? "danger" : "muted"} title={n.body} subtitle={`${n.authorName ?? ""} · ${dateTime(n.createdAt)}`} />
          ))}
        </Card>
      ) : (
        <Text variant="caption">No notes yet.</Text>
      )}

      <BottomSheet visible={!!noteOpen} onClose={() => setNoteOpen(null)} title={noteOpen === "problem" ? "Report a problem" : "Add note"}>
        <View className="gap-3">
          {noteOpen === "problem" && <Text variant="caption">The task is marked blocked and your project manager is notified.</Text>}
          <TextField label={noteOpen === "problem" ? "What's wrong?" : "Note"} value={note} onChangeText={setNote} multiline autoFocus />
          <Chips value={noteOpen ?? "note"} onChange={(v) => setNoteOpen(v)} options={[{ value: "note", label: "Note" }, { value: "problem", label: "Problem" }]} />
          <Button
            label="Save"
            disabled={!note.trim()}
            onPress={async () => {
              await addTaskNote(t, note.trim(), noteOpen === "problem", actor);
              setNote("");
              setNoteOpen(null);
            }}
          />
        </View>
      </BottomSheet>

      <BottomSheet visible={hoursOpen} onClose={() => setHoursOpen(false)} title="Log hours">
        <View className="gap-3">
          <Chips value={hours} onChange={setHours} options={["2", "4", "6", "8", "10"].map((h) => ({ value: h, label: `${h}h` }))} />
          <TextField label="Hours today" value={hours} onChangeText={setHours} keyboardType="decimal-pad" />
          <Button
            label="Save hours"
            disabled={!(Number(hours) > 0 && Number(hours) <= 24)}
            onPress={async () => {
              await logLabor({ projectId: t.projectId, taskId: t.id, hours: Number(hours) }, actor);
              setHoursOpen(false);
            }}
          />
        </View>
      </BottomSheet>

      <ConfirmDialog
        visible={overrideOpen}
        title="Complete with open items?"
        message="Required checklist items are still open. As a supervisor you can override — the reason is recorded in the project history."
        confirmLabel="Complete anyway"
        onCancel={() => setOverrideOpen(false)}
        onConfirm={async () => {
          if (!overrideReason.trim()) return;
          setOverrideOpen(false);
          try {
            await completeTask(t, actor, { reason: overrideReason.trim() });
            setError(null);
          } catch (e) {
            setError(e instanceof Error ? e.message : "Could not complete");
          }
        }}
      >
        <TextField label="Reason" value={overrideReason} onChangeText={setOverrideReason} placeholder="e.g. Heater on backorder, installing next week" />
      </ConfirmDialog>
    </Screen>
  );
}
