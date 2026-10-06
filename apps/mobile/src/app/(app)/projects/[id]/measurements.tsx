import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { MEASUREMENT_CATEGORIES, MEASUREMENT_UNITS, type Measurement, type MeasurementCategory, type MeasurementUnit } from "@pool/types";
import { BottomSheet, Button, Card, Chips, EmptyState, EntitySyncBadge, Fab, ListItem, Screen, Select, Text, TextField } from "@/components/ui";
import { useMeasurements, useProject } from "@/features/data";
import { downloadAndShare } from "@/lib/download";
import { titleCase } from "@/lib/format";
import { deleteMeasurement, saveMeasurement } from "@/lib/mutations";
import { useSession } from "@/providers/session";

/** Site measurements (offline). Structured geometry exports to CAD/design tools. */
export default function Measurements() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { can } = useSession();
  const project = useProject(id);
  const list = useMeasurements(id);
  const [editing, setEditing] = useState<Partial<Measurement> | null>(null);
  const grouped = MEASUREMENT_CATEGORIES.map((c) => ({ c, rows: (list.data ?? []).filter((m) => m.category === c) })).filter((g) => g.rows.length);

  return (
    <>
      <Screen title="Measurements" subtitle={project.data?.name} back>
        {!grouped.length && <EmptyState icon="resize-outline" title="No measurements yet" message="Record pool, depth, deck, equipment and property dimensions." />}
        {grouped.map((g) => (
          <View key={g.c} className="mb-4">
            <Text variant="label" className="mb-2 uppercase">
              {titleCase(g.c)}
            </Text>
            <Card className="py-1">
              {g.rows.map((m) => (
                <ListItem
                  key={m.id}
                  title={m.label}
                  subtitle={[m.notes, m.geometry ? `${m.geometry.type} geometry` : null, m.location ? "GPS tagged" : null].filter(Boolean).join(" · ") || null}
                  right={
                    <View className="items-end gap-1">
                      <Text className="font-sans-bold text-lg">
                        {m.value} {m.unit}
                      </Text>
                      <EntitySyncBadge type="measurement" id={m.id} />
                    </View>
                  }
                  onPress={can("measurement:create") ? () => setEditing(m) : undefined}
                />
              ))}
            </Card>
          </View>
        ))}
        {list.data?.length ? (
          <View className="flex-row gap-2">
            <Button label="Export for CAD (JSON)" icon="download-outline" variant="outline" size="md" className="flex-1" onPress={() => void downloadAndShare(`/projects/${id}/measurements/export`, { format: "json" }, `${project.data?.number ?? "project"}-measurements.json`, "application/json")} />
          </View>
        ) : null}
      </Screen>
      {can("measurement:create") && <Fab icon="add" label="Add measurement" onPress={() => setEditing({ category: "pool", unit: "ft" })} />}
      {editing && <MeasurementSheet projectId={id} initial={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function MeasurementSheet({ projectId, initial, onClose }: { projectId: string; initial: Partial<Measurement>; onClose: () => void }) {
  const [category, setCategory] = useState<MeasurementCategory>(initial.category ?? "pool");
  const [label, setLabel] = useState(initial.label ?? "");
  const [value, setValue] = useState(initial.value !== undefined ? String(initial.value) : "");
  const [unit, setUnit] = useState<MeasurementUnit>(initial.unit ?? "ft");
  const [notes, setNotes] = useState(initial.notes ?? "");
  const [gps, setGps] = useState<"yes" | "no">("yes");
  const num = Number(value);
  return (
    <BottomSheet visible onClose={onClose} title={initial.id ? "Edit measurement" : "New measurement"}>
      <View className="gap-3">
        <Select label="Category" value={category} onChange={(v) => v && setCategory(v)} options={MEASUREMENT_CATEGORIES.map((c) => ({ value: c, label: titleCase(c) }))} />
        <TextField label="Label" value={label} onChangeText={setLabel} placeholder="e.g. Deep end depth" />
        <View className="flex-row gap-3">
          <TextField className="flex-1" label="Value" value={value} onChangeText={setValue} keyboardType="decimal-pad" />
          <View className="flex-1">
            <Select label="Unit" value={unit} onChange={(v) => v && setUnit(v)} options={MEASUREMENT_UNITS.map((u) => ({ value: u, label: u }))} />
          </View>
        </View>
        <TextField label="Notes" value={notes} onChangeText={setNotes} multiline />
        {!initial.id && <Chips value={gps} onChange={setGps} options={[{ value: "yes", label: "Tag GPS location" }, { value: "no", label: "No location" }]} />}
        <Button
          label="Save"
          disabled={!label.trim() || !Number.isFinite(num) || value === ""}
          onPress={async () => {
            await saveMeasurement(projectId, { id: initial.id, category, label: label.trim(), value: num, unit, notes: notes || null, geometry: initial.geometry ?? null, tagLocation: gps === "yes" });
            onClose();
          }}
        />
        {initial.id && (
          <Button
            label="Delete"
            variant="ghost"
            onPress={async () => {
              await deleteMeasurement(initial as Measurement);
              onClose();
            }}
          />
        )}
      </View>
    </BottomSheet>
  );
}
