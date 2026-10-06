import { useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import type { SyncEngine, SyncState } from "@pool/sync";
import { api } from "@/lib/api";
import { getSyncEngine } from "@/lib/sync/engine";
import { processUploads } from "@/lib/sync/uploads";
import { useSession } from "./session";

interface SyncContextValue {
  engine: SyncEngine | null;
  state: SyncState;
  syncNow(): Promise<void>;
}

const initial: SyncState = { phase: "idle", online: true, pending: 0, failed: 0, conflicts: 0, lastSyncedAt: null, lastError: null };
const SyncContext = createContext<SyncContextValue>({ engine: null, state: initial, syncNow: async () => undefined });

/**
 * Runs background sync while signed in: on start, on reconnect, every
 * minute, on app foreground, and when the server sends a real-time hint.
 */
export function SyncProvider({ children }: { children: ReactNode }) {
  const { status, user } = useSession();
  const queryClient = useQueryClient();
  const [state, setState] = useState<SyncState>(initial);
  const engine = useMemo(() => (status === "signedIn" && user ? getSyncEngine(user.id) : null), [status, user]);

  useEffect(() => {
    if (!engine) return;
    const unsubscribe = engine.subscribe(setState);
    void engine.start(60_000);
    const appState = AppState.addEventListener("change", (s) => {
      if (s === "active") {
        void engine.sync();
        void processUploads();
      }
    });
    return () => {
      unsubscribe();
      appState.remove();
    };
  }, [engine]);

  // Real-time hints: refresh online queries and pull changes immediately.
  useEffect(() => {
    if (!engine) return;
    let socket: WebSocket | null = null;
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const connect = async () => {
      const url = await api.realtimeUrl();
      if (!url || closed) return;
      socket = new WebSocket(url);
      socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(String(event.data)) as { type: string; projectId?: string | null };
          if (msg.type === "ready") return;
          void engine.sync();
          void queryClient.invalidateQueries();
        } catch {
          /* ignore */
        }
      };
      socket.onclose = () => {
        if (!closed) retry = setTimeout(connect, 15_000);
      };
    };
    void connect();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      socket?.close();
    };
  }, [engine, queryClient]);

  const value = useMemo<SyncContextValue>(() => ({ engine, state, syncNow: async () => void (await engine?.sync()) }), [engine, state]);
  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync(): SyncContextValue {
  return useContext(SyncContext);
}
