import Ionicons from "@expo/vector-icons/Ionicons";
import { styled } from "nativewind";
import type { ComponentProps } from "react";

export type IconName = ComponentProps<typeof Ionicons>["name"];

// Ionicons with className support: text-* colors map to `color`.
const StyledIonicons = styled(Ionicons, { className: { target: "style", nativeStyleMapping: { color: "color" } } });

const SIZES: Record<string, number> = { xs: 12, sm: 14, base: 16, lg: 18, xl: 20, "2xl": 24, "3xl": 30, "4xl": 36, "5xl": 48 };

/**
 * Icon with Tailwind-style sizing. The glyph size comes from the `text-{size}`
 * class (or an explicit `size`), so icons render at the same size on iOS,
 * Android and web.
 */
export function Icon({ className, size, ...props }: ComponentProps<typeof Ionicons> & { className?: string }) {
  const match = className?.match(/(?:^|\s)text-(xs|sm|base|lg|xl|[2-5]xl)(?:\s|$)/);
  return <StyledIonicons {...props} size={size ?? (match ? SIZES[match[1]!] : 24)} className={className} />;
}
