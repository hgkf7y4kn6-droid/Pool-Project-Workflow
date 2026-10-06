import { useMutation, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { ApiError } from "@pool/api-client";
import { parseMoneyToCents } from "@pool/core";
import { Button, Screen, Text, TextField } from "@/components/ui";
import { api } from "@/lib/api";

export default function NewChangeOrder() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const qc = useQueryClient();
  const [f, setF] = useState({ title: "", description: "", reason: "", cost: "", price: "", hours: "", materials: "", days: "" });
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const m = useMutation({
    mutationFn: () =>
      api.post<{ id: string }>(`/projects/${projectId}/change-orders`, {
        title: f.title,
        description: f.description,
        reason: f.reason || null,
        costCents: parseMoneyToCents(f.cost) ?? 0,
        priceCents: parseMoneyToCents(f.price) ?? 0,
        laborHoursImpact: Number(f.hours) || 0,
        materialImpact: f.materials || null,
        scheduleImpactDays: Number(f.days) || 0,
      }),
    onSuccess: (co) => {
      void qc.invalidateQueries({ queryKey: ["change-orders", projectId] });
      router.replace(`/change-orders/${co.id}`);
    },
  });
  return (
    <Screen title="New change order" back>
      <View className="gap-4">
        <TextField label="Title" value={f.title} onChangeText={set("title")} required />
        <TextField label="Description" value={f.description} onChangeText={set("description")} multiline required />
        <TextField label="Reason" value={f.reason} onChangeText={set("reason")} placeholder="Client request, site condition…" />
        <View className="flex-row gap-3">
          <TextField className="flex-1" label="Internal cost" value={f.cost} onChangeText={set("cost")} keyboardType="decimal-pad" helper="Never shown to the client" />
          <TextField className="flex-1" label="Client price" value={f.price} onChangeText={set("price")} keyboardType="decimal-pad" />
        </View>
        <View className="flex-row gap-3">
          <TextField className="flex-1" label="Labor hours" value={f.hours} onChangeText={set("hours")} keyboardType="decimal-pad" />
          <TextField className="flex-1" label="Schedule impact (days)" value={f.days} onChangeText={set("days")} keyboardType="number-pad" />
        </View>
        <TextField label="Materials impact" value={f.materials} onChangeText={set("materials")} multiline />
        {m.error ? <Text className="text-sm text-destructive">{m.error instanceof ApiError ? m.error.message : "Needs a connection"}</Text> : null}
        <Button label="Save draft" loading={m.isPending} disabled={!f.title.trim() || !f.description.trim()} onPress={() => m.mutate()} />
      </View>
    </Screen>
  );
}
