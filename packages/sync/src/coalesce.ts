import type { SyncOperation } from "@pool/types";

export type CoalesceResult =
  | { kind: "replace"; op: SyncOperation }
  | { kind: "cancel" }
  | { kind: "append" };

/**
 * Merge a new local mutation into the still-pending previous mutation of the
 * same entity, so a burst of edits made offline uploads as one change.
 *
 *   create + update → create (merged payload)
 *   update + update → update (merged payload, earliest base values kept)
 *   create + delete → nothing to upload (the server never saw the entity)
 *   update + delete → delete
 *   anything else   → append as a separate operation
 */
export function coalesce(previous: SyncOperation, next: SyncOperation): CoalesceResult {
  if (previous.operation === "create" && next.operation === "update") {
    return { kind: "replace", op: { ...previous, payload: { ...previous.payload, ...next.payload } } };
  }
  if (previous.operation === "update" && next.operation === "update") {
    const baseValues = { ...(next.baseValues ?? {}), ...(previous.baseValues ?? {}) };
    return {
      kind: "replace",
      op: { ...previous, payload: { ...previous.payload, ...next.payload }, baseValues },
    };
  }
  if (previous.operation === "create" && next.operation === "delete") return { kind: "cancel" };
  if (previous.operation === "update" && next.operation === "delete") {
    return {
      kind: "replace",
      op: { ...previous, operation: "delete", payload: next.payload, baseValues: null },
    };
  }
  return { kind: "append" };
}
