import * as DocumentPicker from "expo-document-picker";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { ApiError } from "@pool/api-client";
import { DOCUMENT_CATEGORIES, DOCUMENT_CATEGORY_LABELS, type DocumentCategory, type DocumentRecord, type DocumentVersion } from "@pool/types";
import { BottomSheet, Button, Card, Chips, EmptyState, ErrorState, Fab, ListItem, LoadingState, Screen, SearchBar, Select, Text, TextField } from "@/components/ui";
import { useApi } from "@/features/data";
import { useLocalQuery } from "@/hooks/use-local-query";
import { api } from "@/lib/api";
import { listOfflineFiles } from "@/lib/offline-files";
import { date, titleCase } from "@/lib/format";
import { useSession } from "@/providers/session";

type Row = DocumentRecord & { currentVersion: DocumentVersion | null };

/** Documents for one project (or the whole company), with search and categories. */
export default function Documents() {
  const { id: projectId } = useLocalSearchParams<{ id?: string }>();
  const { can } = useSession();
  const [q, setQ] = useState("");
  const [category, setCategory] = useState<DocumentCategory | "all">("all");
  const [uploading, setUploading] = useState(false);
  const list = useApi<Row[]>(["documents", projectId, q, category], "/documents", { projectId, q: q.length >= 2 ? q : undefined, category: category === "all" ? undefined : category, limit: 100 });
  const offline = useLocalQuery(listOfflineFiles, [], ["offline_files"]);
  const offlineIds = new Set((offline.data ?? []).map((f) => f.document_id));

  return (
    <>
      <Screen title="Documents" back onRefresh={() => void list.refetch()} refreshing={list.isFetching}>
        <View className="gap-3 pb-3">
          <SearchBar value={q} onChangeText={setQ} placeholder="Search documents" />
          <Chips value={category} onChange={setCategory} options={[{ value: "all", label: "All" }, ...DOCUMENT_CATEGORIES.map((c) => ({ value: c, label: DOCUMENT_CATEGORY_LABELS[c] }))]} />
        </View>
        {list.isLoading ? (
          <LoadingState />
        ) : list.error ? (
          offline.data?.length ? (
            <>
              <Text variant="caption" className="mb-2">
                Offline — showing documents saved on this device.
              </Text>
              <Card className="py-1">
                {offline.data.map((f) => (
                  <ListItem key={f.document_id} icon="document-outline" title={f.file_name} subtitle={`Saved ${date(f.saved_at)}`} onPress={() => router.push(`/documents/${f.document_id}`)} />
                ))}
              </Card>
            </>
          ) : (
            <ErrorState offline onRetry={() => void list.refetch()} />
          )
        ) : !list.data?.length ? (
          <EmptyState icon="document-text-outline" title="No documents" />
        ) : (
          <Card className="py-1">
            {list.data.map((d) => (
              <ListItem
                key={d.id}
                icon={d.currentVersion?.mimeType === "application/pdf" ? "document-text-outline" : "document-outline"}
                title={d.title}
                subtitle={`${DOCUMENT_CATEGORY_LABELS[d.category]} · v${d.currentVersion?.versionNumber ?? "–"}${d.visibility === "client" ? " · shared with client" : ""}${offlineIds.has(d.id) ? " · available offline" : ""}`}
                onPress={() => router.push(`/documents/${d.id}`)}
              />
            ))}
          </Card>
        )}
      </Screen>
      {can("document:upload") && <Fab icon="cloud-upload" label="Upload document" onPress={() => setUploading(true)} />}
      {uploading && <UploadSheet projectId={projectId} onClose={() => setUploading(false)} />}
    </>
  );
}

function UploadSheet({ projectId, onClose }: { projectId?: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [file, setFile] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<DocumentCategory>("blueprint");
  const [visibility, setVisibility] = useState<"internal" | "client">("internal");
  const m = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Choose a file");
      const created = await api.post<{ document: { id: string }; version: { id: string }; upload: { url: string; method: "PUT"; headers: Record<string, string> } }>("/documents", {
        projectId: projectId ?? null,
        title: title || file.name,
        category,
        visibility,
        file: { fileName: file.name, mimeType: file.mimeType ?? "application/octet-stream", byteSize: file.size ?? 1 },
      });
      const blob = await (await fetch(file.uri)).blob();
      await api.uploadToSignedUrl(created.upload, blob);
      await api.post(`/documents/${created.document.id}/versions/${created.version.id}/complete`);
      return created.document.id;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["documents"] });
      onClose();
    },
  });
  return (
    <BottomSheet visible onClose={onClose} title="Upload document">
      <View className="gap-3">
        <Button
          label={file ? file.name : "Choose file"}
          icon="attach"
          variant="outline"
          onPress={async () => {
            const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, type: ["application/pdf", "image/*", "application/*", "text/*"] });
            if (!res.canceled) {
              setFile(res.assets[0]!);
              if (!title) setTitle(res.assets[0]!.name.replace(/\.[^.]+$/, ""));
            }
          }}
        />
        <TextField label="Title" value={title} onChangeText={setTitle} />
        <Select label="Category" value={category} onChange={(v) => v && setCategory(v)} options={DOCUMENT_CATEGORIES.map((c) => ({ value: c, label: DOCUMENT_CATEGORY_LABELS[c] }))} />
        <Chips value={visibility} onChange={setVisibility} options={[{ value: "internal", label: "Team only" }, { value: "client", label: titleCase("share with client") }]} />
        {m.error ? <Text className="text-sm text-destructive">{m.error instanceof ApiError ? m.error.message : (m.error as Error).message}</Text> : null}
        <Button label="Upload" icon="cloud-upload" loading={m.isPending} disabled={!file} onPress={() => m.mutate()} />
      </View>
    </BottomSheet>
  );
}
