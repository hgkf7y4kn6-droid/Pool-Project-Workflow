import { View } from "react-native";
import type { Tone } from "@pool/ui";
import { useTheme } from "@/hooks/use-theme";
import { Icon, type IconName } from "../icon";
import { Text } from "./text";

/** Status pill. Colors come from tokens so contrast is guaranteed (≥ 4.5:1). */
export function Badge({ label, tone = "neutral", icon, size = "md" }: { label: string; tone?: Tone; icon?: IconName; size?: "sm" | "md" }) {
  const { tone: toneColors } = useTheme();
  const { fg, bg } = toneColors(tone);
  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={label}
      style={{ backgroundColor: bg }}
      className={size === "sm" ? "flex-row items-center gap-1 self-start rounded-full px-2 py-0.5" : "flex-row items-center gap-1 self-start rounded-full px-3 py-1"}
    >
      {icon && <Icon name={icon} size={size === "sm" ? 12 : 14} color={fg} />}
      <Text style={{ color: fg }} className={size === "sm" ? "font-sans-semibold text-xs" : "font-sans-semibold text-sm"}>
        {label}
      </Text>
    </View>
  );
}
