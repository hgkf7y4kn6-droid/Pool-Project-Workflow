import * as Sharing from "expo-sharing";
import * as WebBrowser from "expo-web-browser";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Platform, View } from "react-native";
import { WebView } from "react-native-webview";
import { DOCUMENT_CATEGORY_LABELS, type DocumentRecord, type DocumentVersion } from "@pool/types";
import { Badge, Button, Card, ErrorState, KeyValue, LoadingState, Screen, SectionHeader, Text } from "@/components/ui";
import { useApi } from "@/features/data";
import { useLocalQuery } from "@/hooks/use-local-query";
import { date } from "@/lib/format";
import { getOfflineFile, removeOffline, saveOffline } from "@/lib/offline-files";

type Detail = DocumentRecord & { currentVersion: DocumentVersion | null; downloadUrl: string | null; versions: (DocumentVersion & { uploadedByName: string | null })[] };

/**
 * In-app document/blueprint viewer. PDFs and images render inline (WebKit
 * renders PDFs natively on iOS; Android and web use the system viewer via
 * the share sheet / browser). Any document can be kept on the device for
 * offline use on the job site.
 */
export default function DocumentViewer() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useApi<Detail>(["document", id], `/documents/${id}`);
  const offline = useLocalQuery(() => getOfflineFile(id), [id], ["offline_files"]);
  const [saving, setSaving] = useState(false);
  const d = q.data;
  const localUri = offline.data?.local_uri;
  const source = localUri ?? d?.downloadUrl ?? null;
  const mime = d?.currentVersion?.mimeType ?? offline.data?.mime_type ?? "";
  const inline = source && (mime.startsWith("image/") || (mime === "application/pdf" && Platform.OS === "ios"));

  if (q.isLoading && !offline.data) return <Screen title="Document" back><LoadingState /></Screen>;
  if (!d && !offline.data) return <Screen title="Document" back><ErrorState offline onRetry={() => void q.refetch()} /></Screen>;

  return (
    <Screen title={d?.title ?? offline.data!.file_name} subtitle={d ? DOCUMENT_CATEGORY_LABELS[d.category] : "Offline copy"} back>
      {inline ? (
        <View style={{ height: 520 }} className="overflow-hidden rounded-2xl border border-border bg-card">
          <WebView source={{ uri: source! }} originWhitelist={["*"]} allowFileAccess allowingReadAccessToURL={localUri ? localUri.slice(0, localUri.lastIndexOf("/") + 1) : undefined} startInLoadingState />
        </View>
      ) : (
        <Card className="items-center gap-3 py-8">
          <Text variant="h3">{d?.currentVersion?.fileName ?? offline.data?.file_name}</Text>
          <Button
            label="Open"
            icon="open-outline"
            disabled={!source}
            onPress={async () => {
              if (localUri && (await Sharing.isAvailableAsync())) await Sharing.shareAsync(localUri, { mimeType: mime });
              else if (source) await WebBrowser.openBrowserAsync(source);
            }}
          />
        </Card>
      )}
      <View className="mt-3 flex-row flex-wrap gap-2">
        {offline.data ? <Badge label="Available offline" tone="success" icon="cloud-done" /> : null}
        {d?.visibility === "client" ? <Badge label="Shared with client" tone="info" /> : null}
      </View>
      {Platform.OS !== "web" && d?.downloadUrl && d.currentVersion && (
        <Button
          className="mt-3"
          label={offline.data ? (offline.data.version_id === d.currentVersion.id ? "Remove offline copy" : "Update offline copy") : "Keep on this device"}
          icon={offline.data ? "trash-outline" : "download-outline"}
          variant="outline"
          loading={saving}
          onPress={async () => {
            setSaving(true);
            try {
              if (offline.data && offline.data.version_id === d.currentVersion!.id) await removeOffline(d.id);
              else await saveOffline({ id: d.id, versionId: d.currentVersion!.id, url: d.downloadUrl!, fileName: d.currentVersion!.fileName, mimeType: d.currentVersion!.mimeType });
            } finally {
              setSaving(false);
            }
          }}
        />
      )}
      {d ? (
        <>
          <SectionHeader title="Versions" />
          <Card>
            {d.versions.map((v) => (
              <KeyValue key={v.id} label={`v${v.versionNumber} · ${v.fileName}`} value={`${date(v.uploadedAt)}${v.uploadedByName ? ` · ${v.uploadedByName}` : ""}`} />
            ))}
          </Card>
          {d.description ? <Text className="mt-3">{d.description}</Text> : null}
        </>
      ) : null}
    </Screen>
  );
}
