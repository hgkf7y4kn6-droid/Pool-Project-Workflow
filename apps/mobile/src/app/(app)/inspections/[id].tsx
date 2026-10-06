import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { deriveInspectionResult } from "@pool/core";
import type { InspectionItemResult } from "@pool/types";
import { InspectionBadge } from "@/components/status-badges";
import { Button, Card, EmptyState, EntitySyncBadge, PhotoGrid, Screen, SectionHeader, SignaturePad, Text, TextField } from "@/components/ui";
import { useInspection, usePhotos } from "@/features/data";
import { date, titleCase } from "@/lib/format";
import { updateInspection } from "@/lib/mutations";
import { useSession } from "@/providers/session";

const RESULTS: InspectionItemResult["result"][] = ["pass", "fail", "na"];

/**
 * Inspection form: pass/fail per item, notes, corrective actions, photos and
 * inspector signature. When it fails, the server creates corrective tasks.
 */
export default function InspectionDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { can } = useSession();
  const inspection = useInspection(id);
  const i = inspection.data;
  const photos = usePhotos({ projectId: i?.projectId });
  const [items, setItems] = useState<InspectionItemResult[] | null>(null);
  const [notes, setNotes] = useState<string | null>(null);
  const [signer, setSigner] = useState("");
  const [signature, setSignature] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  if (!i) return <Screen title="Inspection" back>{inspection.loading ? null : <EmptyState title="Not found on this device" />}</Screen>;
  const current = items ?? i.items;
  const result = deriveInspectionResult(current);
  const editable = can("inspection:create");
  const setItem = (key: string, patch: Partial<InspectionItemResult>) => setItems(current.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  return (
    <Screen title={titleCase(i.inspectionType)} subtitle={`${i.inspectorName} · ${date(i.scheduledFor ?? i.inspectedAt)}`} back>
      <View className="mb-3 flex-row items-center gap-2">
        <InspectionBadge result={items ? result : i.result} />
        <EntitySyncBadge type="inspection" id={i.id} />
      </View>
      <View className="gap-3">
        {current.map((item) => (
          <Card key={item.key} className="gap-2">
            <Text variant="bodyStrong">{item.label}</Text>
            <View className="flex-row gap-2">
              {RESULTS.map((r) => (
                <Pressable
                  key={r}
                  disabled={!editable}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: item.result === r }}
                  onPress={() => setItem(item.key, { result: r })}
                  className={`min-h-12 flex-1 items-center justify-center rounded-xl border-2 ${item.result === r ? (r === "pass" ? "border-success bg-success-soft" : r === "fail" ? "border-destructive bg-destructive-soft" : "border-primary bg-primary-soft") : "border-border"}`}
                >
                  <Text className="font-sans-bold">{r === "na" ? "N/A" : titleCase(r)}</Text>
                </Pressable>
              ))}
            </View>
            {item.result === "fail" && (
              <>
                <TextField label="What failed?" value={item.notes ?? ""} onChangeText={(v) => setItem(item.key, { notes: v })} />
                <TextField label="Corrective action" value={item.correctiveAction ?? ""} onChangeText={(v) => setItem(item.key, { correctiveAction: v })} />
              </>
            )}
          </Card>
        ))}
      </View>
      <SectionHeader title="Notes" />
      <TextField value={notes ?? i.notes ?? ""} onChangeText={setNotes} multiline label="Inspector notes" />
      <SectionHeader title="Photos" onPress={() => router.push({ pathname: "/camera", params: { projectId: i.projectId, inspectionId: i.id, kind: "inspection" } })} actionLabel="Add" />
      <PhotoGrid photos={(photos.data ?? []).filter((p) => p.inspectionId === i.id)} />
      {editable && (
        <>
          <SectionHeader title="Sign-off" />
          {i.signatureName ? (
            <Text>Signed by {i.signatureName}</Text>
          ) : (
            <View className="gap-2">
              <TextField label="Inspector name" value={signer} onChangeText={setSigner} />
              <SignaturePad onChange={setSignature} />
            </View>
          )}
          {result === "fail" || result === "partial" ? (
            <Text className="mt-3 text-sm text-warning">Failed items will create urgent corrective tasks when this syncs.</Text>
          ) : null}
          <Button
            className="mt-4"
            label={saved ? "Saved" : "Save inspection"}
            icon="checkmark"
            onPress={async () => {
              await updateInspection(i, {
                items: current,
                notes: notes ?? i.notes,
                result,
                inspectedAt: result !== "pending" ? new Date().toISOString() : null,
                ...(signature && signer.trim() ? { signatureName: signer.trim(), signatureDataUrl: signature } : {}),
              });
              setSaved(true);
              setItems(null);
            }}
          />
        </>
      )}
    </Screen>
  );
}
