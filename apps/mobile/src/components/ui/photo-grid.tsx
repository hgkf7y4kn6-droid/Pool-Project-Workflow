import { Image } from "expo-image";
import { useState } from "react";
import { FlatList, Modal, Pressable, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { dateTime } from "@/lib/format";
import { Icon } from "../icon";
import { IconButton } from "./button";
import { Text } from "./text";

export interface GalleryPhoto {
  id: string;
  caption?: string | null;
  takenAt?: string;
  kind?: string;
  localUri?: string | null;
  thumbnailUrl?: string | null;
  url?: string | null;
  uploadStatus?: string;
}

const src = (p: GalleryPhoto, full = false) => (full ? (p.localUri ?? p.url ?? p.thumbnailUrl) : (p.localUri ?? p.thumbnailUrl ?? p.url)) ?? null;

/** Virtualized photo grid with a full-screen swipeable viewer. */
export function PhotoGrid({ photos, columns = 3, scrollEnabled = false }: { photos: GalleryPhoto[]; columns?: number; scrollEnabled?: boolean }) {
  const { width } = useWindowDimensions();
  const size = Math.floor((Math.min(width, 1024) - 32 - (columns - 1) * 6) / columns);
  const [viewing, setViewing] = useState<number | null>(null);
  return (
    <>
      <FlatList
        data={photos}
        keyExtractor={(p) => p.id}
        numColumns={columns}
        scrollEnabled={scrollEnabled}
        columnWrapperStyle={columns > 1 ? { gap: 6 } : undefined}
        contentContainerStyle={{ gap: 6 }}
        initialNumToRender={12}
        windowSize={5}
        renderItem={({ item, index }) => (
          <Pressable accessibilityRole="imagebutton" accessibilityLabel={item.caption ?? `Photo ${dateTime(item.takenAt)}`} onPress={() => setViewing(index)}>
            {src(item) ? (
              <Image source={{ uri: src(item)! }} style={{ width: size, height: size, borderRadius: 10 }} contentFit="cover" transition={150} recyclingKey={item.id} />
            ) : (
              <View style={{ width: size, height: size }} className="items-center justify-center rounded-xl bg-muted">
                <Icon name="image-outline" className="text-2xl text-muted-foreground" />
              </View>
            )}
            {item.uploadStatus === "pending" && (
              <View className="absolute right-1 top-1 rounded-full bg-black/60 p-1">
                <Icon name="cloud-upload-outline" className="text-sm text-white" />
              </View>
            )}
          </Pressable>
        )}
      />
      <PhotoViewer photos={photos} index={viewing} onClose={() => setViewing(null)} />
    </>
  );
}

export function PhotoViewer({ photos, index, onClose }: { photos: GalleryPhoto[]; index: number | null; onClose: () => void }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  if (index === null) return null;
  return (
    <Modal visible animationType="fade" onRequestClose={onClose} supportedOrientations={["portrait", "landscape"]}>
      <View className="flex-1 bg-black">
        <FlatList
          data={photos}
          horizontal
          pagingEnabled
          initialScrollIndex={index}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          keyExtractor={(p) => p.id}
          renderItem={({ item }) => (
            <View style={{ width, height }} className="justify-center">
              {src(item, true) && <Image source={{ uri: src(item, true)! }} style={{ width, height: height * 0.75 }} contentFit="contain" />}
              <View className="absolute bottom-0 w-full bg-black/60 p-4" style={{ paddingBottom: insets.bottom + 16 }}>
                {item.caption ? <Text className="font-sans-semibold text-base text-white">{item.caption}</Text> : null}
                <Text className="text-sm text-white/70">
                  {dateTime(item.takenAt)} {item.kind ? `· ${item.kind}` : ""}
                </Text>
              </View>
            </View>
          )}
        />
        <View className="absolute right-3" style={{ top: insets.top + 8 }}>
          <View className="rounded-full bg-black/50">
            <IconButton icon="close" label="Close photo viewer" onPress={onClose} className="[&>*]:text-white" />
          </View>
        </View>
      </View>
    </Modal>
  );
}
