import { DarkTheme, DefaultTheme, ThemeProvider } from "@react-navigation/native";
import { useFonts } from "expo-font";
import { SplashScreen, Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { palette } from "@pool/ui";
import { useColorScheme } from "react-native";
import { QueryProvider } from "@/providers/query";
import { SessionProvider } from "@/providers/session";
import { SyncProvider } from "@/providers/sync";

import "../../global.css";

// Keep the splash screen up until fonts have loaded.
void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  const [fontsLoaded, fontError] = useFonts({
    "sans-light": require("../../assets/fonts/Manrope-Light.ttf"),
    "sans-regular": require("../../assets/fonts/Manrope-Regular.ttf"),
    "sans-medium": require("../../assets/fonts/Manrope-Medium.ttf"),
    "sans-semibold": require("../../assets/fonts/Manrope-SemiBold.ttf"),
    "sans-bold": require("../../assets/fonts/Manrope-Bold.ttf"),
    "sans-extrabold": require("../../assets/fonts/Manrope-ExtraBold.ttf"),
    "display-semibold": require("../../assets/fonts/Fraunces-SemiBold.ttf"),
    "display-bold": require("../../assets/fonts/Fraunces-Bold.ttf"),
  });

  // If fonts fail to load the system font is used rather than blocking the app.
  const ready = fontsLoaded || !!fontError;
  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;

  // Navigation surfaces use the brand palette so transitions never flash white.
  const p = palette[scheme];
  const base = scheme === "dark" ? DarkTheme : DefaultTheme;
  const navTheme = { ...base, colors: { ...base.colors, background: p.background, card: p.card, text: p.foreground, border: p.border, primary: p.primary } };

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryProvider>
          <SessionProvider>
            <SyncProvider>
              <ThemeProvider value={navTheme}>
                <StatusBar style="auto" />
                <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: p.background } }} />
              </ThemeProvider>
            </SyncProvider>
          </SessionProvider>
        </QueryProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
