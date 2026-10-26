import { View } from "react-native";
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from "react-native-svg";
import { Text } from "./ui/text";

/**
 * The Pool PM mark: a pool in limestone coping with the sun on the corner.
 * Same drawing as assets/brand/mark.svg (source for the app icon and splash).
 */
export function BrandMark({ size = 56 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" accessibilityLabel="Pool PM">
      <Defs>
        <LinearGradient id="water" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#2bd4e3" />
          <Stop offset="1" stopColor="#0a6c78" />
        </LinearGradient>
      </Defs>
      <Rect width="64" height="64" rx="18" fill="#0a2230" />
      <Rect x="11" y="17" width="42" height="34" rx="11" fill="#f5f2ec" />
      <Rect x="14" y="20" width="36" height="28" rx="8.5" fill="url(#water)" />
      <Path d="M17 32.5c3.2-2.6 6.4-2.6 9.6 0s6.4 2.6 9.6 0 6.4-2.6 9.6 0" fill="none" stroke="#ffffff" strokeOpacity={0.9} strokeWidth={2.4} strokeLinecap="round" />
      <Path d="M17 40c3.2-2.6 6.4-2.6 9.6 0s6.4 2.6 9.6 0 6.4-2.6 9.6 0" fill="none" stroke="#ffffff" strokeOpacity={0.55} strokeWidth={2.4} strokeLinecap="round" />
      <Circle cx="49" cy="15" r="6" fill="#f2a93b" />
    </Svg>
  );
}

/** Mark + wordmark ("Pool" in the display serif, "PM" as a teal tag). */
export function BrandLockup({ size = 40, tagline, inverse }: { size?: number; tagline?: string; inverse?: boolean }) {
  return (
    <View className="flex-row items-center gap-3" accessible accessibilityRole="header" accessibilityLabel="Pool PM">
      <BrandMark size={size} />
      <View>
        <View className="flex-row items-baseline gap-1.5">
          <Text className={inverse ? "font-display-bold text-[26px] leading-8 text-hero-foreground" : "font-display-bold text-[26px] leading-8 text-foreground"}>Pool</Text>
          <Text className={inverse ? "font-sans-extrabold text-sm tracking-[2px] text-glow" : "font-sans-extrabold text-sm tracking-[2px] text-primary"}>PM</Text>
        </View>
        {tagline ? <Text className={inverse ? "hero-text -mt-0.5" : "caption -mt-0.5"}>{tagline}</Text> : null}
      </View>
    </View>
  );
}
