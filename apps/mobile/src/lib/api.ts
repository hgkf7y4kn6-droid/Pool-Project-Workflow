import { ApiClient } from "@pool/api-client";
import * as Device from "expo-device";
import { config } from "./config";
import { secureTokenStore } from "./secure-tokens";

type Listener = () => void;
const expiredListeners = new Set<Listener>();

export function onSessionExpired(listener: Listener): () => void {
  expiredListeners.add(listener);
  return () => expiredListeners.delete(listener);
}

export const api = new ApiClient({
  baseUrl: config.apiUrl,
  tokens: secureTokenStore,
  deviceName: Device.deviceName ?? Device.modelName ?? config.platform,
  onSessionExpired: () => expiredListeners.forEach((l) => l()),
});
