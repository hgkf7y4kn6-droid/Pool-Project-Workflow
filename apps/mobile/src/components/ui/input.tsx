import { clsx } from "clsx";
import { forwardRef, useState } from "react";
import { TextInput, View, type TextInputProps } from "react-native";
import { useTheme } from "@/hooks/use-theme";
import { Icon, type IconName } from "../icon";
import { Text } from "./text";

export interface FieldProps extends TextInputProps {
  label?: string;
  error?: string | null;
  helper?: string | null;
  icon?: IconName;
  className?: string;
  required?: boolean;
}

/** Labelled text input with error/helper text wired for screen readers. */
export const TextField = forwardRef<TextInput, FieldProps>(function TextField(
  { label, error, helper, icon, className, multiline, required, ...props },
  ref,
) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View className={clsx("gap-1.5", className)}>
      {label && (
        <Text variant="label">
          {label}
          {required ? <Text className="text-destructive"> *</Text> : null}
        </Text>
      )}
      <View
        className={clsx(
          "flex-row items-center gap-2 rounded-xl border-2 bg-card px-4",
          multiline ? "min-h-28 items-start py-3" : "min-h-14",
          error ? "border-destructive" : focused ? "border-primary" : "border-border",
        )}
      >
        {icon && <Icon name={icon} className="text-xl text-muted-foreground" />}
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          accessibilityHint={error ?? helper ?? undefined}
          placeholderTextColor={colors.mutedForeground}
          multiline={multiline}
          textAlignVertical={multiline ? "top" : "center"}
          maxFontSizeMultiplier={1.6}
          onFocus={(e) => {
            setFocused(true);
            props.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            props.onBlur?.(e);
          }}
          className="flex-1 py-2 font-sans text-base text-foreground"
          {...props}
        />
      </View>
      {error ? (
        <Text accessibilityLiveRegion="polite" className="font-sans-medium text-sm text-destructive">
          {error}
        </Text>
      ) : helper ? (
        <Text variant="caption">{helper}</Text>
      ) : null}
    </View>
  );
});
