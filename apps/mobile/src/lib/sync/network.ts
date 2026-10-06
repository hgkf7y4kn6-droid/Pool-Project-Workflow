import NetInfo from "@react-native-community/netinfo";
import { Platform } from "react-native";
import type { NetworkMonitor } from "@pool/sync";
import { config } from "../config";

// Reachability means "can we reach *our* API", not a third-party site that
// may be blocked on job-site or corporate networks.
NetInfo.configure({
  reachabilityUrl: `${config.apiUrl}/health`,
  reachabilityMethod: "GET",
  reachabilityTest: async (response) => response.status === 200,
  reachabilityShortTimeout: 5_000,
  reachabilityLongTimeout: 60_000,
  reachabilityRequestTimeout: 8_000,
});

const isOnline = (state: { isConnected: boolean | null; isInternetReachable: boolean | null }) =>
  !!state.isConnected && state.isInternetReachable !== false;

/**
 * Connectivity for the sync engine. Native uses NetInfo (with reachability of
 * our API). Browsers use the window online/offline events directly, because
 * NetInfo on web listens to navigator.connection, which does not fire on
 * every reconnect.
 */
export const netInfoMonitor: NetworkMonitor =
  Platform.OS === "web"
    ? {
        async isOnline() {
          return typeof navigator === "undefined" ? true : navigator.onLine;
        },
        subscribe(listener) {
          const on = () => listener(true);
          const off = () => listener(false);
          window.addEventListener("online", on);
          window.addEventListener("offline", off);
          return () => {
            window.removeEventListener("online", on);
            window.removeEventListener("offline", off);
          };
        },
      }
    : {
        async isOnline() {
          return isOnline(await NetInfo.fetch());
        },
        subscribe(listener) {
          return NetInfo.addEventListener((state) => listener(isOnline(state)));
        },
      };
