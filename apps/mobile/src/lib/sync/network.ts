import NetInfo from "@react-native-community/netinfo";
import type { NetworkMonitor } from "@pool/sync";

/** NetInfo-backed connectivity for the sync engine. */
export const netInfoMonitor: NetworkMonitor = {
  async isOnline() {
    const state = await NetInfo.fetch();
    return !!state.isConnected && state.isInternetReachable !== false;
  },
  subscribe(listener) {
    return NetInfo.addEventListener((state) => listener(!!state.isConnected && state.isInternetReachable !== false));
  },
};
