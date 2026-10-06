import { clsx } from "clsx";
import { router } from "expo-router";
import { RefreshControl, ScrollView, View } from "react-native";
import { SafeAreaView } from "../safe-area-view";
import { IconButton } from "./button";
import { Text } from "./text";
import { SyncPill } from "./sync-status";

/**
 * Standard screen: safe area, header (back, title, actions, sync status),
 * optional scroll with pull-to-refresh, and centered max width on tablets.
 */
export function Screen({
  title,
  subtitle,
  back,
  actions,
  children,
  scroll = true,
  onRefresh,
  refreshing = false,
  showSync = true,
  padded = true,
  footer,
}: {
  title?: string;
  subtitle?: string | null;
  back?: boolean;
  actions?: React.ReactNode;
  children: React.ReactNode;
  scroll?: boolean;
  onRefresh?: () => void;
  refreshing?: boolean;
  showSync?: boolean;
  padded?: boolean;
  footer?: React.ReactNode;
}) {
  const header = (title || back) && (
    <View className="flex-row items-center gap-1 px-3 pb-2 pt-1">
      {back && <IconButton icon="chevron-back" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} />}
      <View className={clsx("flex-1", !back && "pl-2")}>
        {title ? (
          <Text variant="h1" numberOfLines={1}>
            {title}
          </Text>
        ) : null}
        {subtitle ? (
          <Text variant="caption" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {showSync && <SyncPill />}
      {actions}
    </View>
  );
  const body = <View className={clsx("w-full max-w-5xl self-center", padded && "px-4")}>{children}</View>;
  return (
    <SafeAreaView edges={["top", "left", "right"]} className="screen">
      {header}
      {scroll ? (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerClassName="pb-32"
          refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} /> : undefined}
        >
          {body}
        </ScrollView>
      ) : (
        <View className="flex-1">{body}</View>
      )}
      {footer}
    </SafeAreaView>
  );
}
