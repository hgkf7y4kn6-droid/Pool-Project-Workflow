import { Platform } from "react-native";

/**
 * Small synchronous key/value store for preferences and lightweight state
 * (theme, last project, pinned offline projects, onboarding flags). Backed by
 * MMKV on device; falls back to localStorage/in-memory where the native
 * module is unavailable (web, Expo Go). Relational data lives in SQLite.
 */
interface KV {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
  remove(key: string): void;
}

function createStore(): KV {
  if (Platform.OS !== "web") {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { createMMKV } = require("react-native-mmkv") as typeof import("react-native-mmkv");
      const mmkv = createMMKV({ id: "pool-pm" });
      return { getString: (k) => mmkv.getString(k), set: (k, v) => mmkv.set(k, v), remove: (k) => void mmkv.remove(k) };
    } catch {
      // Native module missing (Expo Go): fall through to memory.
    }
  }
  if (typeof globalThis.localStorage !== "undefined") {
    return {
      getString: (k) => globalThis.localStorage.getItem(k) ?? undefined,
      set: (k, v) => globalThis.localStorage.setItem(k, v),
      remove: (k) => globalThis.localStorage.removeItem(k),
    };
  }
  const mem = new Map<string, string>();
  return { getString: (k) => mem.get(k), set: (k, v) => void mem.set(k, v), remove: (k) => void mem.delete(k) };
}

export const kv = createStore();

export function getJSON<T>(key: string, fallback: T): T {
  const raw = kv.getString(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function setJSON(key: string, value: unknown): void {
  kv.set(key, JSON.stringify(value));
}

export const KV_KEYS = {
  sessionUser: "session.user",
  biometricsEnabled: "prefs.biometrics",
  deviceId: "device.id",
  pinnedProjects: "offline.pinnedProjects",
  lastProjectId: "nav.lastProjectId",
  themePreference: "prefs.theme",
  pushToken: "push.token",
} as const;
