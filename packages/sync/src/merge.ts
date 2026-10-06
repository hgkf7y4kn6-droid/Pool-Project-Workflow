/**
 * Per-field three-way merge used by the server when applying an update whose
 * base version is stale.
 *
 * For each field the client changed we know its value before the edit
 * (`base`), the client's new value (`mine`) and the server's current value
 * (`theirs`). A field conflicts only if someone else changed it too
 * (theirs ≠ base) and to something different from what we wrote
 * (theirs ≠ mine).
 */
export function threeWayMerge(
  mine: Record<string, unknown>,
  base: Record<string, unknown> | null,
  theirs: Record<string, unknown>,
): { merged: Record<string, unknown>; conflictingFields: string[] } {
  const conflictingFields: string[] = [];
  const merged: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(mine)) {
    const theirValue = theirs[field];
    if (base === null || !(field in base)) {
      // Without a base we cannot tell who changed what: only identical values are safe.
      if (!deepEqual(theirValue, value)) conflictingFields.push(field);
      else merged[field] = value;
      continue;
    }
    const changedByThem = !deepEqual(theirValue, base[field]);
    if (changedByThem && !deepEqual(theirValue, value)) conflictingFields.push(field);
    else merged[field] = value;
  }
  return { merged, conflictingFields };
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return a == b;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
