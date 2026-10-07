import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { Platform } from "react-native";
import { api } from "./api";
import { kv, KV_KEYS } from "./kv";
import { deviceId } from "./sync/engine";

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: true }),
});

/** Ask for permission and register this device's Expo push token with the API. */
export async function registerForPush(): Promise<string | null> {
  if (Platform.OS === "web" || !Device.isDevice) return null;
  // Expo Go can't receive this app's push notifications (and Android Expo Go has no remote push at all);
  // use a development build to test them.
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) return null;
  const { status: existing } = await Notifications.getPermissionsAsync();
  const status = existing === "granted" ? existing : (await Notifications.requestPermissionsAsync()).status;
  if (status !== "granted") return null;
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", { name: "Project updates", importance: Notifications.AndroidImportance.HIGH });
  }
  const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
  if (!projectId) return null;
  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  if (kv.getString(KV_KEYS.pushToken) !== token) {
    await api.post("/push-tokens", { token, platform: Platform.OS, deviceId: deviceId() });
    kv.set(KV_KEYS.pushToken, token);
  }
  return token;
}
