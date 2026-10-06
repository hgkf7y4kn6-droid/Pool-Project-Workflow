import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import type { Material, MaterialUsage } from "@pool/types";
import { Badge, BottomSheet, Button, Card, Chips, EmptyState, ErrorState, Fab, ListItem, LoadingState, Screen, Select, Text, TextField } from "@/components/ui";
import { useApi } from "@/features/data";
import { api } from "@/lib/api";
import { money, titleCase } from "@/lib/format";
import { useSession } from "@/providers/session";

type Row = MaterialUsage & { materialName: string; unit: string; sku: string | null; unitCostCents: number | null };
const STATUSES = ["planned", "ordered", "delivered", "installed", "returned"] as const;

/** Materials planned, ordered, delivered and installed on the project. */
export default function ProjectMaterials() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { can } = useSession();
  const q = useApi<Row[]>(["materials", id], `/projects/${id}/materials`);
  const [editing, setEditing] = useState<Row | "new" | null>(null);
  return (
    <>
      <Screen title="Materials" back onRefresh={() => void q.refetch()} refreshing={q.isFetching}>
        {q.isLoading ? (
          <LoadingState />
        ) : q.error ? (
          <ErrorState offline onRetry={() => void q.refetch()} />
        ) : !q.data?.length ? (
          <EmptyState icon="cube-outline" title="No materials yet" />
        ) : (
          <Card className="py-1">
            {q.data.map((r) => (
              <ListItem
                key={r.id}
                icon="cube-outline"
                title={r.materialName}
                subtitle={`${r.quantityUsed}/${r.quantityPlanned} ${r.unit} used${r.unitCostCents !== null ? ` · ${money(r.unitCostCents)}/${r.unit}` : ""}`}
                right={<Badge size="sm" label={titleCase(r.status)} tone={r.status === "installed" ? "success" : r.status === "delivered" ? "info" : r.status === "ordered" ? "primary" : "neutral"} />}
                onPress={can("material:manage") ? () => setEditing(r) : undefined}
              />
            ))}
          </Card>
        )}
      </Screen>
      {can("material:manage") && <Fab icon="add" label="Add material" onPress={() => setEditing("new")} />}
      {editing && <MaterialSheet projectId={id} row={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function MaterialSheet({ projectId, row, onClose }: { projectId: string; row: Row | null; onClose: () => void }) {
  const qc = useQueryClient();
  const catalog = useApi<Material[]>(["catalog"], "/materials");
  const [materialId, setMaterialId] = useState<string | null>(row?.materialId ?? null);
  const [planned, setPlanned] = useState(String(row?.quantityPlanned ?? ""));
  const [used, setUsed] = useState(String(row?.quantityUsed ?? "0"));
  const [status, setStatus] = useState<Row["status"]>(row?.status ?? "planned");
  const save = useMutation({
    mutationFn: () => {
      const body = { materialId, quantityPlanned: Number(planned) || 0, quantityUsed: Number(used) || 0, status };
      return row ? api.put(`/projects/${projectId}/materials/${row.id}`, body) : api.post(`/projects/${projectId}/materials`, body);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["materials", projectId] });
      void qc.invalidateQueries({ queryKey: ["budget", projectId] });
      onClose();
    },
  });
  return (
    <BottomSheet visible onClose={onClose} title={row ? row.materialName : "Add material"}>
      <View className="gap-3">
        {!row && <Select label="Material" value={materialId} onChange={setMaterialId} options={(catalog.data ?? []).map((m) => ({ value: m.id, label: m.name, description: `${money(m.unitCostCents)}/${m.unit}` }))} />}
        <View className="flex-row gap-3">
          <TextField className="flex-1" label="Planned qty" value={planned} onChangeText={setPlanned} keyboardType="decimal-pad" />
          <TextField className="flex-1" label="Used qty" value={used} onChangeText={setUsed} keyboardType="decimal-pad" />
        </View>
        <Chips value={status} onChange={setStatus} options={STATUSES.map((s) => ({ value: s, label: titleCase(s) }))} />
        {save.error ? <Text className="text-sm text-destructive">Could not save — check your connection.</Text> : null}
        <Button label="Save" loading={save.isPending} disabled={!materialId} onPress={() => save.mutate()} />
      </View>
    </BottomSheet>
  );
}
