import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { View } from "react-native";
import { parseMoneyToCents } from "@pool/core";
import type { Material } from "@pool/types";
import { BottomSheet, Button, Card, EmptyState, ErrorState, Fab, ListItem, LoadingState, Screen, SearchBar, Text, TextField } from "@/components/ui";
import { useApi } from "@/features/data";
import { api } from "@/lib/api";
import { money } from "@/lib/format";
import { useSession } from "@/providers/session";

/** Company materials catalog with unit costs. */
export default function MaterialsCatalog() {
  const { can } = useSession();
  const [q, setQ] = useState("");
  const list = useApi<Material[]>(["catalog", q], "/materials", { q: q || undefined });
  const [adding, setAdding] = useState(false);
  return (
    <>
      <Screen title="Materials" back>
        <SearchBar value={q} onChangeText={setQ} placeholder="Search name or SKU" className="mb-3" />
        {list.isLoading ? (
          <LoadingState />
        ) : list.error ? (
          <ErrorState offline onRetry={() => void list.refetch()} />
        ) : !list.data?.length ? (
          <EmptyState icon="cube-outline" title="No materials" />
        ) : (
          <Card className="py-1">
            {list.data.map((m) => (
              <ListItem key={m.id} icon="cube-outline" title={m.name} subtitle={`${m.category}${m.sku ? ` · ${m.sku}` : ""}`} right={can("budget:read") ? <Text className="font-sans-semibold">{money(m.unitCostCents)}/{m.unit}</Text> : undefined} />
            ))}
          </Card>
        )}
      </Screen>
      {can("material:manage") && <Fab icon="add" label="Add material" onPress={() => setAdding(true)} />}
      {adding && <AddSheet onClose={() => setAdding(false)} />}
    </>
  );
}

function AddSheet({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ name: "", sku: "", category: "", unit: "ea", cost: "" });
  const m = useMutation({
    mutationFn: () => api.post("/materials", { name: f.name, sku: f.sku || null, category: f.category, unit: f.unit, unitCostCents: parseMoneyToCents(f.cost) ?? 0 }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["catalog"] });
      onClose();
    },
  });
  return (
    <BottomSheet visible onClose={onClose} title="Add material">
      <View className="gap-3">
        <TextField label="Name" value={f.name} onChangeText={(name) => setF({ ...f, name })} />
        <TextField label="SKU" value={f.sku} onChangeText={(sku) => setF({ ...f, sku })} />
        <TextField label="Category" value={f.category} onChangeText={(category) => setF({ ...f, category })} />
        <View className="flex-row gap-3">
          <TextField className="flex-1" label="Unit" value={f.unit} onChangeText={(unit) => setF({ ...f, unit })} />
          <TextField className="flex-1" label="Unit cost" value={f.cost} onChangeText={(cost) => setF({ ...f, cost })} keyboardType="decimal-pad" />
        </View>
        <Button label="Save" loading={m.isPending} disabled={!f.name.trim() || !f.category.trim()} onPress={() => m.mutate()} />
      </View>
    </BottomSheet>
  );
}
