import { useMutation, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Linking, Platform, View } from "react-native";
import type { Property } from "@pool/types";
import { Button, Card, ErrorState, KeyValue, LoadingState, Screen, SectionHeader, Text, TextField } from "@/components/ui";
import { SiteMap } from "@/components/site-map";
import { useApi, useProject } from "@/features/data";
import { api } from "@/lib/api";
import { currentLocation } from "@/lib/location";
import { useSession } from "@/providers/session";

/** Property profile (site conditions, utilities, access) and the client contact. */
export default function PropertyScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { can } = useSession();
  const qc = useQueryClient();
  const project = useProject(id);
  const q = useApi<Property>(["property", id], `/projects/${id}/property`);
  const [notes, setNotes] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (patch: Partial<Property>) => api.patch(`/properties/${q.data!.id}`, patch),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["property", id] }),
  });
  if (q.isLoading) return <Screen title="Property" back><LoadingState /></Screen>;
  if (q.error || !q.data) return <Screen title="Property" back><ErrorState offline onRetry={() => void q.refetch()} /></Screen>;
  const p = q.data;
  const address = `${p.address.line1}, ${p.address.city}, ${p.address.region} ${p.address.postalCode}`;
  const directions = () =>
    void Linking.openURL(
      Platform.OS === "ios" ? `maps:0,0?q=${encodeURIComponent(address)}` : `https://www.google.com/maps/dir/?api=1&destination=${p.location ? `${p.location.latitude},${p.location.longitude}` : encodeURIComponent(address)}`,
    );

  return (
    <Screen title="Property" subtitle={address} back>
      {p.location ? <SiteMap points={[{ id: p.id, title: project.data?.name ?? "Site", latitude: p.location.latitude, longitude: p.location.longitude }]} height={220} /> : null}
      <View className="mt-3 flex-row gap-2">
        <Button label="Directions" icon="navigate" className="flex-1" onPress={directions} />
        {can("property:manage") && (
          <Button
            label={p.location ? "Re-capture GPS" : "Capture GPS"}
            icon="locate"
            variant="outline"
            className="flex-1"
            loading={save.isPending}
            onPress={async () => {
              const loc = await currentLocation({ ask: true });
              if (loc) save.mutate({ location: loc });
            }}
          />
        )}
      </View>
      <SectionHeader title="Client" />
      <Card>
        <KeyValue label="Name" value={project.data?.clientName ?? "—"} />
        <Button label="Open client record" variant="ghost" size="sm" onPress={() => router.push(`/clients/${p.clientId}`)} />
      </Card>
      <SectionHeader title="Site" />
      <Card>
        <KeyValue label="Lot" value={p.lotWidthFt && p.lotDepthFt ? `${p.lotWidthFt} × ${p.lotDepthFt} ft` : "—"} />
        <KeyValue label="Lot area" value={p.lotAreaSqft ? `${p.lotAreaSqft.toLocaleString()} sq ft` : "—"} />
        <KeyValue label="Gate" value={p.gateWidthIn ? `${p.gateWidthIn}" wide` : "—"} />
        {p.gateNotes ? <Text variant="caption">{p.gateNotes}</Text> : null}
        <KeyValue label="Equipment location" value={p.equipmentLocation ?? "—"} />
        <KeyValue label="HOA" value={p.hoaName ?? "—"} />
      </Card>
      <SectionHeader title="Existing conditions" />
      <Card className="gap-2">
        <Text variant="label">Structures</Text>
        <Text>{p.existingStructures ?? "—"}</Text>
        <Text variant="label">Existing pool</Text>
        <Text>{p.existingPool ?? "None"}</Text>
        <Text variant="label">Landscaping</Text>
        <Text>{p.existingLandscaping ?? "—"}</Text>
        <Text variant="label">Access restrictions</Text>
        <Text>{p.accessRestrictions ?? "—"}</Text>
      </Card>
      <SectionHeader title="Utilities" />
      <Card>
        {p.utilityLocations.length ? p.utilityLocations.map((u, i) => <KeyValue key={i} label={u.kind} value={u.description} />) : <Text variant="caption">No utilities recorded. Call 811 before digging.</Text>}
      </Card>
      <SectionHeader title="Site notes" />
      <TextField value={notes ?? p.siteNotes ?? ""} onChangeText={setNotes} multiline editable={can("property:manage")} />
      {notes !== null && can("property:manage") && <Button className="mt-2" label="Save notes" loading={save.isPending} onPress={() => save.mutate({ siteNotes: notes })} />}
    </Screen>
  );
}
