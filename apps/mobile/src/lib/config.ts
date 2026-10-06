import Constants from "expo-constants";
import { Platform } from "react-native";

const extra = (Constants.expoConfig?.extra ?? {}) as { apiUrl?: string; appEnv?: string };

/** Public runtime configuration. Never put secrets here: it ships in the bundle. */
export const config = {
  apiUrl: (process.env.EXPO_PUBLIC_API_URL ?? extra.apiUrl ?? "http://localhost:4000").replace(/\/$/, ""),
  appEnv: extra.appEnv ?? "development",
  platform: Platform.OS as "ios" | "android" | "web",
};
