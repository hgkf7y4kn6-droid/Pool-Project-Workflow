import { Linking, Pressable, View } from "react-native";
import { Icon } from "./icon";
import { Text } from "./ui/text";
import type { MapPoint } from "./site-map";

export type { MapPoint };

/** Web fallback: location list with links to OpenStreetMap (react-native-maps is native-only). */
export function SiteMap({ points }: { points: MapPoint[]; height?: number }) {
  if (!points.length) return null;
  return (
    <View className="gap-1 rounded-2xl border border-border bg-card p-3">
      {points.map((p) => (
        <Pressable
          key={p.id}
          accessibilityRole="link"
          onPress={() => (p.onPress ? p.onPress() : void Linking.openURL(`https://www.openstreetmap.org/?mlat=${p.latitude}&mlon=${p.longitude}#map=17/${p.latitude}/${p.longitude}`))}
          className="min-h-12 flex-row items-center gap-2"
        >
          <Icon name={p.kind === "vendor" ? "storefront" : "location"} className="text-xl text-primary" />
          <View className="flex-1">
            <Text variant="bodyStrong">{p.title}</Text>
            <Text variant="caption">{p.subtitle ?? `${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)}`}</Text>
          </View>
        </Pressable>
      ))}
    </View>
  );
}
