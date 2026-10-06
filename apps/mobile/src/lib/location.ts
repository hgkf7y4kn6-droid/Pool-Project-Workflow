import * as Location from "expo-location";
import type { GeoPoint } from "@pool/types";

/**
 * One-shot location for tagging a photo/measurement or capturing a property
 * position. Only foreground "when in use" permission is requested; the app
 * never tracks location in the background.
 */
export async function currentLocation(options: { ask?: boolean } = {}): Promise<GeoPoint | null> {
  try {
    let { status } = await Location.getForegroundPermissionsAsync();
    if (status !== "granted" && options.ask !== false) status = (await Location.requestForegroundPermissionsAsync()).status;
    if (status !== "granted") return null;
    const last = await Location.getLastKnownPositionAsync({ maxAge: 60_000, requiredAccuracy: 50 });
    const pos = last ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
    return { latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracyMeters: pos.coords.accuracy ?? null };
  } catch {
    return null;
  }
}
