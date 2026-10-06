import * as Crypto from "expo-crypto";

/** RFC 4122 v4 UUID, generated on device so records can be created offline. */
export function uuid(): string {
  return Crypto.randomUUID();
}
