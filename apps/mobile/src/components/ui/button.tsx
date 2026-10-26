import { clsx } from "clsx";
import * as Haptics from "expo-haptics";
import { ActivityIndicator, Platform, Pressable, View, type PressableProps } from "react-native";
import { PressableScale } from "./motion";
import { Icon, type IconName } from "../icon";
import { Text } from "./text";

type Variant = "primary" | "secondary" | "outline" | "ghost" | "destructive" | "accent" | "dark";
type Size = "sm" | "md" | "lg";

const CONTAINER: Record<Variant, string> = {
  primary: "bg-primary",
  secondary: "bg-primary-soft",
  outline: "border border-border bg-card",
  ghost: "bg-transparent",
  destructive: "bg-destructive",
  accent: "bg-accent",
  dark: "bg-hero",
};
const LABEL: Record<Variant, string> = {
  primary: "text-primary-foreground",
  secondary: "text-primary",
  outline: "text-foreground",
  ghost: "text-primary",
  destructive: "text-primary-foreground",
  accent: "text-accent-foreground",
  dark: "text-hero-foreground",
};
// Heights honour the 48dp minimum; "lg" (56dp) is the default for field actions.
const SIZE: Record<Size, string> = { sm: "min-h-12 px-4", md: "min-h-12 px-5", lg: "min-h-14 px-6" };
const TEXT_SIZE: Record<Size, string> = { sm: "text-sm", md: "text-base", lg: "text-lg" };

export interface ButtonProps extends Omit<PressableProps, "children"> {
  label: string;
  variant?: Variant;
  size?: Size;
  icon?: IconName;
  iconRight?: IconName;
  loading?: boolean;
  fullWidth?: boolean;
  className?: string;
  haptic?: boolean;
}

export function Button({
  label,
  variant = "primary",
  size = "lg",
  icon,
  iconRight,
  loading,
  disabled,
  fullWidth,
  className,
  haptic = true,
  onPress,
  ...props
}: ButtonProps) {
  const inactive = disabled || loading;
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      disabled={inactive}
      onPress={(e) => {
        if (haptic && Platform.OS !== "web") void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress?.(e);
      }}
      className={clsx(
        "flex-row items-center justify-center gap-2 rounded-2xl",
        CONTAINER[variant],
        SIZE[size],
        fullWidth && "w-full",
        inactive && "opacity-50",
        className,
      )}
      {...props}
    >
      {loading ? (
        <ActivityIndicator color={variant === "primary" || variant === "destructive" || variant === "dark" ? "#fff" : undefined} />
      ) : (
        icon && <Icon name={icon} className={clsx("text-xl", LABEL[variant])} />
      )}
      <Text className={clsx("font-sans-semibold", TEXT_SIZE[size], LABEL[variant])} numberOfLines={1}>
        {label}
      </Text>
      {iconRight && !loading && <Icon name={iconRight} className={clsx("text-xl", LABEL[variant])} />}
    </PressableScale>
  );
}

/** Square icon-only button with an accessible label (min 48×48). */
export function IconButton({
  icon,
  label,
  onPress,
  tone = "default",
  className,
  disabled,
}: {
  icon: IconName;
  label: string;
  onPress?: () => void;
  tone?: "default" | "primary" | "danger";
  className?: string;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      disabled={disabled}
      onPress={onPress}
      className={clsx("size-12 items-center justify-center rounded-full active:bg-muted", disabled && "opacity-40", className)}
    >
      <Icon
        name={icon}
        className={clsx("text-2xl", tone === "primary" ? "text-primary" : tone === "danger" ? "text-destructive" : "text-foreground")}
      />
    </Pressable>
  );
}

/** Large floating action button (camera, add). */
export function Fab({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <View pointerEvents="box-none" className="absolute bottom-28 right-5">
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onPress}
        haptics
        scaleTo={0.92}
        className="size-16 items-center justify-center rounded-full bg-primary shadow-lg"
      >
        <Icon name={icon} className="text-3xl text-primary-foreground" />
      </PressableScale>
    </View>
  );
}
