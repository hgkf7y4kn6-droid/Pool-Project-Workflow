import MapView, { Marker, type Region } from "react-native-maps";
import { View } from "react-native";

export interface MapPoint {
  id: string;
  title: string;
  subtitle?: string;
  latitude: number;
  longitude: number;
  kind?: "project" | "vendor";
  onPress?: () => void;
}

/** Native map (Apple Maps / Google Maps) with project and supplier pins. */
export function SiteMap({ points, height = 300 }: { points: MapPoint[]; height?: number }) {
  if (!points.length) return null;
  const lats = points.map((p) => p.latitude);
  const lngs = points.map((p) => p.longitude);
  const region: Region = {
    latitude: (Math.min(...lats) + Math.max(...lats)) / 2,
    longitude: (Math.min(...lngs) + Math.max(...lngs)) / 2,
    latitudeDelta: Math.max(0.01, (Math.max(...lats) - Math.min(...lats)) * 1.5),
    longitudeDelta: Math.max(0.01, (Math.max(...lngs) - Math.min(...lngs)) * 1.5),
  };
  return (
    <View style={{ height }} className="overflow-hidden rounded-2xl border border-border">
      <MapView style={{ flex: 1 }} initialRegion={region} showsUserLocation={false} accessibilityLabel={`Map with ${points.length} locations`}>
        {points.map((p) => (
          <Marker key={p.id} coordinate={{ latitude: p.latitude, longitude: p.longitude }} title={p.title} description={p.subtitle} pinColor={p.kind === "vendor" ? "orange" : "blue"} onCalloutPress={p.onPress} />
        ))}
      </MapView>
    </View>
  );
}
