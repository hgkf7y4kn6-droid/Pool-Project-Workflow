import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { Image } from "expo-image";
import { useState } from "react";
import { ScrollView, View } from "react-native";
import { ApiError } from "@pool/api-client";
import type { DesignModel, DesignProject } from "@pool/types";
import { Pool3DViewer } from "@/components/pool-3d-viewer";
import { Badge, BottomSheet, Button, Card, EmptyState, ErrorState, KeyValue, LoadingState, Screen, SectionHeader, Select, Text, TextField } from "@/components/ui";
import { useApi } from "@/features/data";
import { api } from "@/lib/api";
import { titleCase } from "@/lib/format";
import { useSession } from "@/providers/session";

type Design = DesignProject & { models: (DesignModel & { url: string | null })[] };

/** Designs for the project: 3D model, renderings gallery, dimensions, equipment. */
export default function DesignScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { can } = useSession();
  const qc = useQueryClient();
  const q = useApi<{ providers: { id: string; displayName: string }[]; designs: Design[] }>(["designs", id], `/projects/${id}/designs`);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const sync = useMutation({ mutationFn: (designId: string) => api.post(`/designs/${designId}/sync`), onSuccess: () => void qc.invalidateQueries({ queryKey: ["designs", id] }) });

  if (q.isLoading) return <Screen title="Design" back><LoadingState /></Screen>;
  if (q.error || !q.data) return <Screen title="Design" back><ErrorState offline onRetry={() => void q.refetch()} /></Screen>;
  const design = q.data.designs.find((d) => d.id === selected) ?? q.data.designs[0];
  const model = design?.models.find((m) => m.kind === "model_3d" && m.url && m.format !== "parametric");
  const renderings = design?.models.filter((m) => m.kind !== "model_3d" && m.url) ?? [];

  return (
    <Screen title="Design & 3D" back onRefresh={() => void q.refetch()} refreshing={q.isFetching} actions={can("design:manage") ? <Button label="New" size="sm" variant="secondary" onPress={() => setCreating(true)} /> : null}>
      {!design ? (
        <EmptyState icon="cube-outline" title="No design yet" message="Create a design here or connect an external design platform." />
      ) : (
        <>
          {q.data.designs.length > 1 && <Select label="Design" value={design.id} onChange={setSelected} options={q.data.designs.map((d) => ({ value: d.id, label: d.title }))} />}
          <View className="my-3 flex-row items-center gap-2">
            <Text variant="h2" className="flex-1">
              {design.title}
            </Text>
            <Badge label={titleCase(design.status)} tone={design.status === "approved" ? "success" : design.status === "in_review" ? "warning" : "neutral"} />
          </View>
          <Pool3DViewer modelUrl={model?.url} summary={design.summary} />
          {design.provider !== "manual" && can("design:manage") && (
            <Button className="mt-3" label={`Sync from ${q.data.providers.find((p) => p.id === design.provider)?.displayName ?? design.provider}`} icon="sync" variant="outline" loading={sync.isPending} onPress={() => sync.mutate(design.id)} />
          )}
          {design.summary ? (
            <>
              <SectionHeader title="Dimensions" />
              <Card>
                {design.summary.poolShape ? <KeyValue label="Shape" value={design.summary.poolShape} /> : null}
                {design.summary.lengthFt ? <KeyValue label="Size" value={`${design.summary.lengthFt} × ${design.summary.widthFt ?? "?"} ft`} /> : null}
                {design.summary.shallowDepthFt ? <KeyValue label="Depth" value={`${design.summary.shallowDepthFt} – ${design.summary.deepDepthFt ?? "?"} ft`} /> : null}
                {design.summary.surfaceAreaSqft ? <KeyValue label="Surface area" value={`${design.summary.surfaceAreaSqft} sq ft`} /> : null}
                {design.summary.volumeGallons ? <KeyValue label="Volume" value={`${design.summary.volumeGallons.toLocaleString()} gal`} /> : null}
                {design.summary.deckAreaSqft ? <KeyValue label="Deck" value={`${design.summary.deckAreaSqft} sq ft`} /> : null}
              </Card>
              {design.summary.features?.length ? (
                <View className="mt-3 flex-row flex-wrap gap-2">
                  {design.summary.features.map((f) => (
                    <Badge key={f} label={f} tone="info" />
                  ))}
                </View>
              ) : null}
              {design.summary.equipment?.length ? (
                <>
                  <SectionHeader title="Equipment placement" />
                  <Card>
                    {design.summary.equipment.map((e, i) => (
                      <KeyValue key={i} label={e.name} value={e.location ?? "—"} />
                    ))}
                  </Card>
                </>
              ) : null}
            </>
          ) : null}
          {renderings.length ? (
            <>
              <SectionHeader title="Renderings & layouts" />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-3">
                {renderings.map((r) => (
                  <View key={r.id} className="w-64 gap-1">
                    <Image source={{ uri: r.url! }} style={{ width: 256, height: 170, borderRadius: 12 }} contentFit="cover" accessibilityLabel={r.title} />
                    <Text variant="caption">
                      {titleCase(r.kind)} · {r.title}
                    </Text>
                  </View>
                ))}
              </ScrollView>
            </>
          ) : null}
        </>
      )}
      {creating && <NewDesignSheet projectId={id} providers={q.data.providers} onClose={() => setCreating(false)} />}
    </Screen>
  );
}

function NewDesignSheet({ projectId, providers, onClose }: { projectId: string; providers: { id: string; displayName: string }[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [provider, setProvider] = useState("manual");
  const [title, setTitle] = useState("Concept A");
  const [length, setLength] = useState("32");
  const [width, setWidth] = useState("16");
  const [shallow, setShallow] = useState("3.5");
  const [deep, setDeep] = useState("6");
  const m = useMutation({
    mutationFn: () =>
      api.post(`/projects/${projectId}/designs`, {
        provider,
        title,
        summary: { lengthFt: Number(length), widthFt: Number(width), shallowDepthFt: Number(shallow), deepDepthFt: Number(deep), poolShape: "Rectangle" },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["designs", projectId] });
      onClose();
    },
  });
  return (
    <BottomSheet visible onClose={onClose} title="New design">
      <View className="gap-3">
        <Select label="Design platform" value={provider} onChange={(v) => v && setProvider(v)} options={providers.map((p) => ({ value: p.id, label: p.displayName }))} />
        <TextField label="Title" value={title} onChangeText={setTitle} />
        <View className="flex-row gap-3">
          <TextField className="flex-1" label="Length (ft)" value={length} onChangeText={setLength} keyboardType="decimal-pad" />
          <TextField className="flex-1" label="Width (ft)" value={width} onChangeText={setWidth} keyboardType="decimal-pad" />
        </View>
        <View className="flex-row gap-3">
          <TextField className="flex-1" label="Shallow (ft)" value={shallow} onChangeText={setShallow} keyboardType="decimal-pad" />
          <TextField className="flex-1" label="Deep (ft)" value={deep} onChangeText={setDeep} keyboardType="decimal-pad" />
        </View>
        {m.error ? <Text className="text-sm text-destructive">{m.error instanceof ApiError ? m.error.message : "Needs a connection"}</Text> : null}
        <Button label="Create design" loading={m.isPending} onPress={() => m.mutate()} />
      </View>
    </BottomSheet>
  );
}
