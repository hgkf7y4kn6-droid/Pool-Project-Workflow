import { motion } from "@pool/ui";
import * as Haptics from "expo-haptics";
import { useEffect } from "react";
import { Platform, Pressable, type PressableProps, View } from "react-native";
import Animated, {
  Easing,
  FadeInDown,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle } from "react-native-svg";

/*
 * Motion vocabulary. One easing family (expo-out, as on the marketing site),
 * springs for touch, and everything collapses to instant when the user has
 * "reduce motion" on.
 */

export const EASE_OUT = Easing.out(Easing.exp);
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

function haptic() {
  if (Platform.OS !== "web") void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}

/** Pressable that gently compresses under the finger (spring) with optional haptic tick. */
export function PressableScale({
  scaleTo = motion.pressScale,
  haptics = false,
  onPressIn,
  onPressOut,
  onPress,
  disabled,
  style,
  ...props
}: PressableProps & { scaleTo?: number; haptics?: boolean; className?: string }) {
  const reduced = useReducedMotion();
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <AnimatedPressable
      disabled={disabled}
      onPressIn={(e) => {
        if (!reduced) scale.value = withSpring(scaleTo, { damping: 18, stiffness: 420 });
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        scale.value = withSpring(1, { damping: 14, stiffness: 300 });
        onPressOut?.(e);
      }}
      onPress={(e) => {
        if (haptics) haptic();
        onPress?.(e);
      }}
      style={[animated, style as object]}
      {...props}
    />
  );
}

/**
 * Fade-and-rise on first mount, staggered by index (capped so long lists do
 * not wait). Wrap list rows and dashboard sections with it.
 */
export function Reveal({ index = 0, children, className }: { index?: number; children: React.ReactNode; className?: string }) {
  const reduced = useReducedMotion();
  if (reduced) return <View className={className}>{children}</View>;
  const delay = Math.min(index, 8) * motion.stagger;
  if (Platform.OS === "web") {
    // Reanimated's web layout animations take the view out of flow while they
    // run; CSS keyframes (supported by react-native-web) keep layout intact.
    return (
      <View className={className} style={webReveal(delay) as object}>
        {children}
      </View>
    );
  }
  return (
    <Animated.View
      className={className}
      entering={FadeInDown.delay(delay)
        .duration(motion.slow)
        .easing(EASE_OUT)
        .withInitialValues({ opacity: 0, transform: [{ translateY: 14 }] })}
    >
      {children}
    </Animated.View>
  );
}

/** expo-out as a CSS curve, matching EASE_OUT. */
const webReveal = (delay: number) => ({
  animationKeyframes: [{ from: { opacity: 0, transform: "translateY(14px)" }, to: { opacity: 1, transform: "translateY(0px)" } }],
  animationDuration: `${motion.slow}ms`,
  animationDelay: `${delay}ms`,
  animationTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)",
  animationFillMode: "both",
});

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/** Circular progress (0–100) that sweeps in on mount. */
export function ProgressRing({
  value,
  size = 64,
  stroke = 7,
  color,
  track,
  children,
  label,
}: {
  value: number;
  size?: number;
  stroke?: number;
  color: string;
  track: string;
  children?: React.ReactNode;
  label?: string;
}) {
  const reduced = useReducedMotion();
  const pct = Math.max(0, Math.min(100, value));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const progress = useSharedValue(reduced ? pct : 0);
  useEffect(() => {
    progress.value = reduced ? pct : withTiming(pct, { duration: 900, easing: EASE_OUT });
  }, [pct, progress, reduced]);
  const animatedProps = useAnimatedProps(() => ({ strokeDashoffset: c * (1 - progress.value / 100) }));
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(pct) }}
      style={{ width: size, height: size }}
      className="items-center justify-center"
    >
      <Svg width={size} height={size} style={{ position: "absolute", transform: [{ rotate: "-90deg" }] }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={track} strokeWidth={stroke} fill="none" />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${c} ${c}`}
          animatedProps={animatedProps}
        />
      </Svg>
      {children}
    </View>
  );
}
