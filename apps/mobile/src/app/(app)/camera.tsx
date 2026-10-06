import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { PHOTO_KINDS, type PhotoKind } from "@pool/types";
import { Button, Chips, Screen, Text, TextField } from "@/components/ui";
import { titleCase } from "@/lib/format";
import { savePhoto, type CapturedImage } from "@/lib/mutations";
import { useActor, useSession } from "@/providers/session";
import { PHOTO } from "@pool/config";

/**
 * Camera workflow: open → shoot → (optional caption) → saved on device →
 * uploads automatically. Project, task, stage, checklist item, author, time
 * and GPS are attached without extra taps. Images are resized/compressed
 * before upload (max 2560 px, JPEG 0.8); thumbnails are made server-side.
 */
export default function Camera() {
  const params = useLocalSearchParams<{ projectId: string; taskId?: string; stageId?: string; checklistItemId?: string; inspectionId?: string; changeOrderId?: string; kind?: PhotoKind }>();
  const actor = useActor();
  const { can } = useSession();
  const [shots, setShots] = useState<CapturedImage[]>([]);
  const [caption, setCaption] = useState("");
  const [kind, setKind] = useState<PhotoKind>(params.kind ?? (params.inspectionId ? "inspection" : "progress"));
  const [clientVisible, setClientVisible] = useState(false);
  const [saving, setSaving] = useState(false);

  const compress = async (asset: ImagePicker.ImagePickerAsset): Promise<CapturedImage> => {
    const longest = Math.max(asset.width, asset.height);
    const edge = PHOTO.maxEdgePx;
    const actions = longest > edge ? [{ resize: asset.width >= asset.height ? { width: edge } : { height: edge } }] : [];
    const out = await ImageManipulator.manipulateAsync(asset.uri, actions, { compress: PHOTO.jpegQuality, format: ImageManipulator.SaveFormat.JPEG });
    return { uri: out.uri, width: out.width, height: out.height, mimeType: "image/jpeg" };
  };

  const take = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return pick();
    const res = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 1, exif: false });
    if (!res.canceled) {
      const compressed = await Promise.all(res.assets.map(compress));
      setShots((s) => [...s, ...compressed]);
    }
  };

  const pick = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsMultipleSelection: true, selectionLimit: 20, quality: 1 });
    if (!res.canceled) {
      const compressed = await Promise.all(res.assets.map(compress));
      setShots((s) => [...s, ...compressed]);
    }
  };

  // Open the camera immediately: fewest taps from the task screen.
  useEffect(() => {
    void take();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    setSaving(true);
    for (const shot of shots) {
      await savePhoto(
        shot,
        {
          projectId: params.projectId,
          taskId: params.taskId || null,
          stageId: params.stageId || null,
          checklistItemId: params.checklistItemId || null,
          inspectionId: params.inspectionId || null,
          changeOrderId: params.changeOrderId || null,
          kind,
          caption: caption.trim() || null,
          visibility: clientVisible ? "client" : "internal",
        },
        actor,
      );
    }
    setSaving(false);
    router.back();
  };

  return (
    <Screen title="Add photos" back>
      <View className="gap-4">
        <View className="flex-row flex-wrap gap-2">
          {shots.map((s, i) => (
            <Image key={i} source={{ uri: s.uri }} style={{ width: 100, height: 100, borderRadius: 12 }} accessibilityLabel={`Photo ${i + 1}`} />
          ))}
        </View>
        <View className="flex-row gap-2">
          <Button label="Take photo" icon="camera" className="flex-1" onPress={() => void take()} />
          <Button label="Library" icon="images" variant="outline" className="flex-1" onPress={() => void pick()} />
        </View>
        <TextField label="Caption (optional)" value={caption} onChangeText={setCaption} placeholder="What does this show?" />
        <Text variant="label">Type</Text>
        <Chips value={kind} onChange={setKind} options={PHOTO_KINDS.map((k) => ({ value: k, label: titleCase(k) }))} />
        {can("project:update") && (
          <Chips value={clientVisible ? "client" : "internal"} onChange={(v) => setClientVisible(v === "client")} options={[{ value: "internal", label: "Team only" }, { value: "client", label: "Share with client" }]} />
        )}
        <Text variant="caption">Saved on this device first, then uploaded automatically when there is signal.</Text>
        <Button label={shots.length > 1 ? `Save ${shots.length} photos` : "Save photo"} icon="checkmark" disabled={!shots.length} loading={saving} onPress={() => void save()} />
      </View>
    </Screen>
  );
}
