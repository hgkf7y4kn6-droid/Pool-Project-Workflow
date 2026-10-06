import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import type { InspectionTemplate } from "@pool/types";
import { Button, DateField, Screen, Select, Text, TextField } from "@/components/ui";
import { useApi, useStages } from "@/features/data";
import { createInspection } from "@/lib/mutations";

export default function NewInspection() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const templates = useApi<InspectionTemplate[]>(["inspection-templates"], "/inspection-templates", undefined, { staleTime: 24 * 3600_000 });
  const stages = useStages(projectId);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [inspector, setInspector] = useState("");
  const [when, setWhen] = useState<string | null>(null);
  const [stageId, setStageId] = useState<string | null>(null);
  const tpl = templates.data?.find((t) => t.id === templateId);
  return (
    <Screen title="New inspection" back>
      <View className="gap-4">
        <Select label="Inspection form" value={templateId} onChange={setTemplateId} options={(templates.data ?? []).map((t) => ({ value: t.id, label: t.name, description: `${t.items.length} items` }))} />
        {templates.error ? <Text variant="caption">Templates need a connection the first time. You can still name the inspection type below.</Text> : null}
        <TextField label="Inspector" value={inspector} onChangeText={setInspector} placeholder="e.g. City of Phoenix" />
        <DateField label="Scheduled for" value={when} onChange={setWhen} />
        <Select label="Stage" value={stageId} allowClear onChange={setStageId} options={(stages.data ?? []).map((s) => ({ value: s.id, label: s.name }))} />
        <Button
          label="Create"
          disabled={!inspector.trim() || !tpl}
          onPress={async () => {
            const id = await createInspection(projectId, {
              templateId: tpl!.id,
              inspectionType: tpl!.inspectionType,
              inspectorName: inspector.trim(),
              scheduledFor: when,
              stageId,
              items: tpl!.items.map((i) => ({ key: i.key, label: i.label, result: "pending" })),
            });
            router.replace(`/inspections/${id}`);
          }}
        />
      </View>
    </Screen>
  );
}
