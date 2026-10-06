import { Modal, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { IconButton } from "./button";
import { Text } from "./text";

/** Bottom sheet (modal) used for pickers, filters and quick forms. */
export function BottomSheet({
  visible,
  onClose,
  title,
  children,
  scroll = true,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  scroll?: boolean;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable accessibilityLabel="Close" className="flex-1 bg-black/40" onPress={onClose} />
      <View className="max-h-[85%] rounded-t-3xl bg-card" style={{ paddingBottom: Math.max(insets.bottom, 16) }}>
        <View className="items-center pt-2">
          <View className="h-1.5 w-12 rounded-full bg-muted" />
        </View>
        {title && (
          <View className="flex-row items-center justify-between px-5 pb-1 pt-2">
            <Text variant="h2">{title}</Text>
            <IconButton icon="close" label="Close" onPress={onClose} />
          </View>
        )}
        {scroll ? (
          <ScrollView className="px-5" keyboardShouldPersistTaps="handled" contentContainerClassName="pb-4">
            {children}
          </ScrollView>
        ) : (
          <View className="px-5 pb-4">{children}</View>
        )}
      </View>
    </Modal>
  );
}

/** Centered confirmation dialog. */
export function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive,
  onConfirm,
  onCancel,
  children,
}: {
  visible: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: React.ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View className="flex-1 items-center justify-center bg-black/50 p-6">
        <View accessibilityViewIsModal className="w-full max-w-md gap-4 rounded-2xl bg-card p-5">
          <Text variant="h2">{title}</Text>
          {message ? <Text variant="body">{message}</Text> : null}
          {children}
          <View className="flex-row justify-end gap-3">
            <Pressable accessibilityRole="button" onPress={onCancel} className="min-h-12 justify-center rounded-xl px-4 active:bg-muted">
              <Text className="font-sans-semibold text-base text-foreground">{cancelLabel}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={onConfirm}
              className={destructive ? "min-h-12 justify-center rounded-xl bg-destructive px-5 active:opacity-80" : "min-h-12 justify-center rounded-xl bg-primary px-5 active:opacity-80"}
            >
              <Text className="font-sans-semibold text-base text-primary-foreground">{confirmLabel}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
