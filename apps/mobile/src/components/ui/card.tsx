import { clsx } from "clsx";
import { Pressable, View, type ViewProps } from "react-native";
import { Icon, type IconName } from "../icon";
import { Text } from "./text";

export function Card({ className, onPress, children, ...props }: ViewProps & { className?: string; onPress?: () => void }) {
  if (onPress) {
    return (
      <Pressable accessibilityRole="button" onPress={onPress} className={clsx("card active:opacity-90", className)} {...props}>
        {children}
      </Pressable>
    );
  }
  return (
    <View className={clsx("card", className)} {...props}>
      {children}
    </View>
  );
}

export function CardHeader({ title, subtitle, icon, right }: { title: string; subtitle?: string | null; icon?: IconName; right?: React.ReactNode }) {
  return (
    <View className="mb-3 flex-row items-center gap-3">
      {icon && (
        <View className="size-10 items-center justify-center rounded-xl bg-primary-soft">
          <Icon name={icon} className="text-xl text-primary" />
        </View>
      )}
      <View className="flex-1">
        <Text variant="h3" numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
    </View>
  );
}
