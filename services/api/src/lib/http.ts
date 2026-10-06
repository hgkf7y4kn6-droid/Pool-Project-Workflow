import type { ApiMeta, ApiSuccess } from "@pool/types";

export function ok<T>(data: T, meta?: ApiMeta): ApiSuccess<T> {
  return meta ? { data, meta } : { data };
}

/** Opaque offset cursor. Kept opaque so pagination can move to keyset later. */
export function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ o: offset })).toString("base64url");
}

export function decodeCursor(cursor: string | undefined | null): number {
  if (!cursor) return 0;
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { o?: unknown };
    return typeof value.o === "number" && value.o >= 0 ? Math.floor(value.o) : 0;
  } catch {
    return 0;
  }
}

/** Fetch limit+1 rows, then call this to build the page. */
export function page<T>(rows: T[], limit: number, offset: number): { items: T[]; nextCursor: string | null } {
  const hasMore = rows.length > limit;
  return { items: hasMore ? rows.slice(0, limit) : rows, nextCursor: hasMore ? encodeCursor(offset + limit) : null };
}
