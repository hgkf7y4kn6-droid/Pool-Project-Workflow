import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import type { TokenStore } from "@pool/api-client";
import type { AuthTokens } from "@pool/types";

const KEY = "pool-pm.tokens";

/**
 * Tokens live in the iOS Keychain / Android Keystore via SecureStore —
 * never in AsyncStorage/MMKV. On web (admin use) they fall back to
 * sessionStorage, which is cleared when the tab closes.
 */
let cache: AuthTokens | null | undefined;

export const secureTokenStore: TokenStore = {
  async get() {
    if (cache !== undefined) return cache;
    let raw: string | null = null;
    if (Platform.OS === "web") raw = globalThis.sessionStorage?.getItem(KEY) ?? null;
    else raw = await SecureStore.getItemAsync(KEY);
    cache = raw ? (JSON.parse(raw) as AuthTokens) : null;
    return cache;
  },
  async set(tokens) {
    cache = tokens;
    if (Platform.OS === "web") {
      if (tokens) globalThis.sessionStorage?.setItem(KEY, JSON.stringify(tokens));
      else globalThis.sessionStorage?.removeItem(KEY);
      return;
    }
    if (tokens) {
      await SecureStore.setItemAsync(KEY, JSON.stringify(tokens), { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY });
    } else {
      await SecureStore.deleteItemAsync(KEY);
    }
  },
};
