import { useEffect } from "react";
import { View } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { Icon, type IconName } from "../icon";
import { Button } from "./button";
import { Text } from "./text";

export function EmptyState({ icon = "file-tray-outline", title, message, action }: { icon?: IconName; title: string; message?: string; action?: { label: string; onPress: () => void } }) {
  return (
    <View className="items-center gap-3 px-6 py-10">
      <View className="size-16 items-center justify-center rounded-full bg-muted">
        <Icon name={icon} className="text-3xl text-muted-foreground" />
      </View>
      <Text variant="h3" className="text-center">
        {title}
      </Text>
      {message ? (
        <Text variant="caption" className="text-center">
          {message}
        </Text>
      ) : null}
      {action && <Button label={action.label} onPress={action.onPress} variant="secondary" size="md" />}
    </View>
  );
}

export function ErrorState({ message, onRetry, offline }: { message?: string; onRetry?: () => void; offline?: boolean }) {
  return (
    <View className="items-center gap-3 px-6 py-10">
      <View className="size-16 items-center justify-center rounded-full bg-destructive-soft">
        <Icon name={offline ? "cloud-offline-outline" : "alert-circle-outline"} className="text-3xl text-destructive" />
      </View>
      <Text variant="h3" className="text-center">
        {offline ? "You're offline" : "Something went wrong"}
      </Text>
      <Text variant="caption" className="text-center">
        {offline ? "This screen needs a connection. Your field data is still available offline." : (message ?? "Please try again.")}
      </Text>
      {onRetry && <Button label="Try again" icon="refresh" onPress={onRetry} variant="outline" size="md" />}
    </View>
  );
}

/** Skeleton placeholder; pulses unless the user prefers reduced motion. */
export function Skeleton({ height = 16, width = "100%", className }: { height?: number; width?: number | `${number}%`; className?: string }) {
  const reduced = useReducedMotion();
  const opacity = useSharedValue(0.5);
  useEffect(() => {
    if (!reduced) opacity.value = withRepeat(withTiming(1, { duration: 800 }), -1, true);
  }, [opacity, reduced]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View style={[{ height, width }, style]} className={`rounded-lg bg-muted ${className ?? ""}`} />;
}

export function LoadingState({ rows = 4 }: { rows?: number }) {
  return (
    <View accessibilityLabel="Loading" accessibilityRole="progressbar" className="gap-3 p-4">
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} className="card gap-2">
          <Skeleton height={18} width="60%" />
          <Skeleton height={14} width="90%" />
          <Skeleton height={14} width="40%" />
        </View>
      ))}
    </View>
  );
}
