import type {
  clients,
  documents,
  measurements,
  photos,
  properties,
  vendors,
} from "@pool/database";
import type { Address, GeoPoint } from "@pool/types";

/*
 * Row → API shape conversions where the DB layout differs from the shared
 * entity types (lat/lng columns → GeoPoint, internal columns removed, …).
 */

export function geo(lat: number | null, lng: number | null, accuracy?: number | null): GeoPoint | null {
  return lat === null || lng === null ? null : { latitude: lat, longitude: lng, accuracyMeters: accuracy ?? null };
}

export function formatAddress(a: Address | null | undefined): string {
  if (!a) return "";
  return [a.line1, a.line2, `${a.city}, ${a.region} ${a.postalCode}`].filter(Boolean).join(", ");
}

export function propertyOut(p: typeof properties.$inferSelect) {
  const { latitude, longitude, locationAccuracyM, city: _city, changeSeq: _seq, deletedAt: _d, ...rest } = p;
  return { ...rest, location: geo(latitude, longitude, locationAccuracyM) };
}

export function clientOut(c: typeof clients.$inferSelect) {
  const { changeSeq: _seq, deletedAt: _d, ...rest } = c;
  return { ...rest, fullName: `${c.firstName} ${c.lastName}` };
}

export function photoOut(
  p: typeof photos.$inferSelect,
  urls?: { url?: string | null; thumbnailUrl?: string | null },
) {
  const { latitude, longitude, locationAccuracyM, changeSeq: _seq, organizationId: _org, ...rest } = p;
  return { ...rest, location: geo(latitude, longitude, locationAccuracyM), url: urls?.url ?? null, thumbnailUrl: urls?.thumbnailUrl ?? null };
}

export function measurementOut(m: typeof measurements.$inferSelect) {
  const { latitude, longitude, locationAccuracyM, changeSeq: _seq, ...rest } = m;
  return { ...rest, location: geo(latitude, longitude, locationAccuracyM) };
}

export function documentOut(d: typeof documents.$inferSelect) {
  const { changeSeq: _seq, ...rest } = d;
  return rest;
}

export function vendorOut(v: typeof vendors.$inferSelect) {
  const { latitude, longitude, ...rest } = v;
  return { ...rest, location: geo(latitude, longitude) };
}

/** Drop sync bookkeeping columns from a row before returning it. */
export function strip<T extends Record<string, unknown>>(row: T): Omit<T, "changeSeq"> {
  const { changeSeq: _seq, ...rest } = row;
  return rest;
}
