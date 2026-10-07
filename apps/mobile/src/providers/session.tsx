import * as LocalAuthentication from "expo-local-authentication";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { AppState, Platform } from "react-native";
import { ApiError, NetworkError } from "@pool/api-client";
import type { LoginResponse, SessionUser } from "@pool/types";
import { can, type Permission } from "@pool/core";
import { api, onSessionExpired } from "@/lib/api";
import { resetLocalData } from "@/lib/db/database";
import { getJSON, kv, KV_KEYS, setJSON } from "@/lib/kv";
import { secureTokenStore } from "@/lib/secure-tokens";
import { stopSyncEngine } from "@/lib/sync/engine";

type Status = "loading" | "signedOut" | "locked" | "signedIn";

interface SessionContextValue {
  status: Status;
  user: SessionUser | null;
  signIn(email: string, password: string): Promise<LoginResponse>;
  verifyMfa(ticket: string, code: string): Promise<void>;
  completeLogin(response: LoginResponse): Promise<void>;
  signOut(options?: { wipe?: boolean }): Promise<void>;
  unlock(): Promise<boolean>;
  biometricsAvailable: boolean;
  biometricsEnabled: boolean;
  setBiometricsEnabled(enabled: boolean): Promise<boolean>;
  can(permission: Permission): boolean;
  /** Re-fetch the profile (e.g. after enabling two-step verification). */
  refreshUser(): Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

/**
 * Session lifecycle:
 * - Tokens live in SecureStore; the last user profile is cached so the app
 *   opens offline ("offline login") without contacting the server.
 * - With biometrics enabled, the app starts (and resumes after 5 min in the
 *   background) locked until Face ID / fingerprint succeeds.
 * - A rejected refresh token signs the user out.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUser] = useState<SessionUser | null>(null);
  const [biometricsAvailable, setBiometricsAvailable] = useState(false);
  const [biometricsEnabled, setBiometricsEnabledState] = useState(kv.getString(KV_KEYS.biometricsEnabled) === "1");

  useEffect(() => {
    (async () => {
      if (Platform.OS !== "web") {
        const hw = await LocalAuthentication.hasHardwareAsync();
        const enrolled = hw && (await LocalAuthentication.isEnrolledAsync());
        setBiometricsAvailable(enrolled);
      }
      const tokens = await secureTokenStore.get();
      const cached = getJSON<SessionUser | null>(KV_KEYS.sessionUser, null);
      if (!tokens || !cached) {
        setStatus("signedOut");
        return;
      }
      setUser(cached);
      setStatus(kv.getString(KV_KEYS.biometricsEnabled) === "1" ? "locked" : "signedIn");
      // Refresh the profile in the background; offline is fine.
      api
        .me()
        .then((fresh) => {
          setUser(fresh);
          setJSON(KV_KEYS.sessionUser, fresh);
        })
        .catch((error) => {
          if (error instanceof ApiError && error.status === 401) void signOut();
          else if (!(error instanceof NetworkError)) console.warn("profile refresh failed", error);
        });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-lock after the app has been in the background for a while.
  useEffect(() => {
    let backgroundedAt = 0;
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "background") backgroundedAt = Date.now();
      if (state === "active" && biometricsEnabled && backgroundedAt && Date.now() - backgroundedAt > 5 * 60_000) {
        setStatus((s) => (s === "signedIn" ? "locked" : s));
      }
    });
    return () => sub.remove();
  }, [biometricsEnabled]);

  const completeLogin = useCallback(async (response: LoginResponse) => {
    if (!response.user || !response.tokens) return;
    const previous = getJSON<SessionUser | null>(KV_KEYS.sessionUser, null);
    // Different account on this device: start from a clean local database.
    if (previous && previous.id !== response.user.id) await resetLocalData();
    setJSON(KV_KEYS.sessionUser, response.user);
    setUser(response.user);
    setStatus("signedIn");
  }, []);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const response = await api.login(email, password);
      if (!response.mfaRequired) await completeLogin(response);
      return response;
    },
    [completeLogin],
  );

  const verifyMfa = useCallback(
    async (ticket: string, code: string) => {
      await completeLogin(await api.verifyMfa(ticket, code));
    },
    [completeLogin],
  );

  const signOut = useCallback(async (options: { wipe?: boolean } = {}) => {
    stopSyncEngine();
    try {
      await api.logout();
    } catch {
      await secureTokenStore.set(null);
    }
    if (options.wipe) {
      await resetLocalData();
      kv.remove(KV_KEYS.sessionUser);
    }
    setUser(null);
    setStatus("signedOut");
  }, []);

  useEffect(() => onSessionExpired(() => void signOut()), [signOut]);

  const unlock = useCallback(async () => {
    const result = await LocalAuthentication.authenticateAsync({ promptMessage: "Unlock Pool PM", fallbackLabel: "Use passcode" });
    if (result.success) setStatus("signedIn");
    return result.success;
  }, []);

  const setBiometricsEnabled = useCallback(async (enabled: boolean) => {
    if (enabled) {
      const result = await LocalAuthentication.authenticateAsync({ promptMessage: "Confirm to enable biometric unlock" });
      if (!result.success) return false;
    }
    kv.set(KV_KEYS.biometricsEnabled, enabled ? "1" : "0");
    setBiometricsEnabledState(enabled);
    return true;
  }, []);

  const refreshUser = useCallback(async () => {
    const fresh = await api.me();
    setUser(fresh);
    setJSON(KV_KEYS.sessionUser, fresh);
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({
      status,
      user,
      signIn,
      verifyMfa,
      completeLogin,
      signOut,
      unlock,
      biometricsAvailable,
      biometricsEnabled,
      setBiometricsEnabled,
      can: (permission) => (user ? can(user.role, permission) : false),
      refreshUser,
    }),
    [status, user, signIn, verifyMfa, completeLogin, signOut, unlock, biometricsAvailable, biometricsEnabled, setBiometricsEnabled, refreshUser],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside SessionProvider");
  return ctx;
}

/** The signed-in user (only call inside the authenticated app shell). */
export function useUser(): SessionUser {
  const { user } = useSession();
  if (!user) throw new Error("No signed-in user");
  return user;
}

export function useActor() {
  const user = useUser();
  return { userId: user.id, role: user.role, fullName: user.fullName };
}
