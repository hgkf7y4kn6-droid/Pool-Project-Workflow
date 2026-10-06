import { router } from "expo-router";
import { useState } from "react";
import type { Vendor } from "@pool/types";
import { SiteMap, type MapPoint } from "@/components/site-map";
import { Chips, Screen, Text } from "@/components/ui";
import { useApi, useProjects } from "@/features/data";

/**
 * Job sites and suppliers. Crew locations are never tracked; only fixed
 * places (properties, vendor yards) are shown.
 */
export default function MapScreen() {
  const [show, setShow] = useState<"projects" | "all">("projects");
  const projects = useProjects("active");
  const vendors = useApi<(Vendor & { location: { latitude: number; longitude: number } | null })[]>(["vendors", "all"], show === "all" ? "/vendors" : null);
  const points: MapPoint[] = [
    ...(projects.data ?? [])
      .filter((p) => p.location)
      .map((p) => ({ id: p.id, title: p.name, subtitle: p.propertyAddress, latitude: p.location!.latitude, longitude: p.location!.longitude, kind: "project" as const, onPress: () => router.push(`/projects/${p.id}`) })),
    ...(show === "all" ? (vendors.data ?? []).filter((v) => v.location).map((v) => ({ id: v.id, title: v.name, subtitle: v.trade ?? v.kind, latitude: v.location!.latitude, longitude: v.location!.longitude, kind: "vendor" as const })) : []),
  ];
  return (
    <Screen title="Map" back>
      <Chips className="mb-3" value={show} onChange={setShow} options={[{ value: "projects", label: "Active job sites" }, { value: "all", label: "Sites & suppliers" }]} />
      {points.length ? <SiteMap points={points} height={520} /> : <Text variant="caption">No locations captured yet. Capture GPS from a project&apos;s property screen.</Text>}
    </Screen>
  );
}
