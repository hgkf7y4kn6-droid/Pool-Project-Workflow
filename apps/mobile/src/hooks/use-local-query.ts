import { useCallback, useEffect, useRef, useState } from "react";
import { subscribeChanges } from "@/lib/db/database";

/**
 * Run a query against the local database and re-run it whenever records of
 * the given types change (sync pulls, local edits, acknowledgements).
 */
export function useLocalQuery<T>(query: () => Promise<T>, deps: unknown[], watch: string[]): { data: T | undefined; loading: boolean; error: Error | null; refresh: () => void } {
  const [data, setData] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const queryRef = useRef(query);
  queryRef.current = query;
  const runId = useRef(0);

  const run = useCallback(() => {
    const id = ++runId.current;
    queryRef
      .current()
      .then((result) => {
        if (id !== runId.current) return;
        setData(result);
        setError(null);
      })
      .catch((e: unknown) => id === runId.current && setError(e instanceof Error ? e : new Error(String(e))))
      .finally(() => id === runId.current && setLoading(false));
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(run, deps);

  const watchKey = watch.join(",");
  useEffect(() => {
    const types = new Set(watchKey.split(","));
    return subscribeChanges((changed) => {
      if (changed.has("*") || [...changed].some((t) => types.has(t))) run();
    });
  }, [watchKey, run]);

  return { data, loading, error, refresh: run };
}
