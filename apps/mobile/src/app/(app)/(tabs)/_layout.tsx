import { clsx } from "clsx";
import * as Haptics from "expo-haptics";
import { Tabs } from "expo-router";
import { Platform, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon, type IconName } from "@/components/icon";
import { Text } from "@/components/ui";
import { useLayout, useTheme } from "@/hooks/use-theme";
import { useSession } from "@/providers/session";

interface TabDef {
  name: string;
  title: string;
  icon: IconName;
  roles?: "internal" | "client";
}

// Every route file in this folder must be listed so role-hidden ones get href: null.
const TABS: TabDef[] = [
  { name: "dashboard", title: "Home", icon: "grid" },
  { name: "projects", title: "Projects", icon: "construct", roles: "internal" },
  { name: "schedule", title: "Schedule", icon: "calendar", roles: "internal" },
  { name: "tasks", title: "Tasks", icon: "checkbox", roles: "internal" },
  { name: "approvals", title: "Approvals", icon: "create", roles: "client" },
  { name: "inbox", title: "Messages", icon: "chatbubbles", roles: "client" },
  { name: "more", title: "More", icon: "menu" },
];

/**
 * Floating deep-water tab bar. The active tab sits in a lagoon pill; labels
 * stay visible for clarity in the field, and taps give a selection tick.
 */
export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { isTablet } = useLayout();
  const { user } = useSession();
  const isClient = user?.role === "client";

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        tabBarHideOnKeyboard: true,
        tabBarStyle: {
          position: "absolute",
          bottom: Math.max(insets.bottom, 16),
          height: 74,
          marginHorizontal: isTablet ? "22%" : 14,
          borderRadius: 37,
          backgroundColor: colors.hero,
          borderTopWidth: 0,
          elevation: 10,
          shadowColor: "#0a2230",
          shadowOpacity: 0.22,
          shadowRadius: 18,
          shadowOffset: { width: 0, height: 8 },
        },
        tabBarItemStyle: { paddingVertical: 9 },
      }}
      screenListeners={{
        tabPress: () => {
          if (Platform.OS !== "web") void Haptics.selectionAsync();
        },
      }}
    >
      {TABS.map((tab) => {
        const visible = !tab.roles || (tab.roles === "client" ? isClient : !isClient);
        return (
          <Tabs.Screen
            key={tab.name}
            name={tab.name}
            options={{
              title: tab.title,
              href: visible ? undefined : null,
              tabBarAccessibilityLabel: tab.title,
              tabBarIcon: ({ focused }) => (
                <View className="items-center justify-center gap-1">
                  <View className={clsx("h-8 w-14 items-center justify-center rounded-full", focused && "bg-glow")}>
                    <Icon name={focused ? tab.icon : (`${tab.icon}-outline` as IconName)} className={clsx("text-[22px]", focused ? "text-hero" : "text-hero-muted")} />
                  </View>
                  <Text className={clsx("text-[11px]", focused ? "font-sans-bold text-hero-foreground" : "font-sans-semibold text-hero-muted")} maxFontSizeMultiplier={1.2}>
                    {tab.title}
                  </Text>
                </View>
              ),
            }}
          />
        );
      })}
    </Tabs>
  );
}
