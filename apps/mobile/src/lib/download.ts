import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";
import { api } from "./api";
import { secureTokenStore } from "./secure-tokens";

/**
 * Download an authenticated export (CSV, XLSX, PDF, CAD JSON) and open the
 * share sheet. Signed storage URLs don't need this; API exports do.
 */
export async function downloadAndShare(path: string, query: Record<string, string>, fileName: string, mimeType: string): Promise<void> {
  const url = api.url(path, query);
  let tokens = await secureTokenStore.get();
  if (Platform.OS === "web") {
    let res = await fetch(url, { headers: { Authorization: `Bearer ${tokens?.accessToken ?? ""}` } });
    if (res.status === 401 && (tokens = await api.refresh())) res = await fetch(url, { headers: { Authorization: `Bearer ${tokens.accessToken}` } });
    if (!res.ok) throw new Error(`Download failed (${res.status})`);
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = fileName;
    a.click();
    return;
  }
  const dest = `${FileSystem.cacheDirectory}${fileName}`;
  let res = await FileSystem.downloadAsync(url, dest, { headers: { Authorization: `Bearer ${tokens?.accessToken ?? ""}` } });
  if (res.status === 401 && (tokens = await api.refresh())) {
    res = await FileSystem.downloadAsync(url, dest, { headers: { Authorization: `Bearer ${tokens.accessToken}` } });
  }
  if (res.status >= 300) throw new Error(`Download failed (${res.status})`);
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(res.uri, { mimeType, dialogTitle: fileName });
}
