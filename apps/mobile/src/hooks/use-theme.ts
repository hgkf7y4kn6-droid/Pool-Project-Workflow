import { useColorScheme, useWindowDimensions } from "react-native";
import { breakpoints, palette, toneColors, type Tone } from "@pool/ui";

/** Raw token values for places that need them (navigator options, icons, SVG). */
export function useTheme() {
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  return { scheme, colors: palette[scheme], tone: (t: Tone) => toneColors(t, scheme) } as const;
}

/** Layout class for responsive phone/tablet/desktop layouts. */
export function useLayout() {
  const { width } = useWindowDimensions();
  return {
    width,
    isTablet: width >= breakpoints.tablet,
    isDesktop: width >= breakpoints.desktop,
    columns: width >= breakpoints.desktop ? 3 : width >= breakpoints.tablet ? 2 : 1,
  };
}
