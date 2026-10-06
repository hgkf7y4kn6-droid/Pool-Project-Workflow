import type { BackoffOptions } from "./types";

export const DEFAULT_BACKOFF: BackoffOptions = {
  baseMs: 2_000,
  maxMs: 15 * 60_000,
  jitter: 0.25,
  maxAutoRetries: 12,
};

/**
 * Exponential backoff: base × 2^(attempt−1), capped, with ± jitter.
 * attempt 1 → ~2s, 2 → ~4s, 3 → ~8s … capped at 15 min.
 */
export function computeBackoffMs(attempt: number, options: BackoffOptions = DEFAULT_BACKOFF, random = Math.random): number {
  const exp = Math.min(options.maxMs, options.baseMs * 2 ** Math.max(0, attempt - 1));
  const spread = exp * options.jitter;
  return Math.max(0, Math.round(exp - spread + random() * spread * 2));
}
