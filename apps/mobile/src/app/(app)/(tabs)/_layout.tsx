import { clsx } from "clsx";
import { Tabs } from "expo-router";
import { View } from "react-native";
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

/** Floating pill tab bar (from the MMM design), with labels for clarity in the field. */
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
          height: 72,
          marginHorizontal: isTablet ? "20%" : 12,
          borderRadius: 36,
          backgroundColor: colors.primary,
          borderTopWidth: 0,
          elevation: 6,
          shadowColor: "#000",
          shadowOpacity: 0.15,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 4 },
        },
        tabBarItemStyle: { paddingVertical: 8 },
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
                <View className="items-center justify-center gap-0.5">
                  <View className={clsx("h-9 w-12 items-center justify-center rounded-full", focused && "bg-primary-foreground/20")}>
                    <Icon name={focused ? tab.icon : (`${tab.icon}-outline` as IconName)} className={clsx("text-2xl", focused ? "text-primary-foreground" : "text-primary-foreground/70")} />
                  </View>
                  <Text className={clsx("text-[11px] font-sans-semibold", focused ? "text-primary-foreground" : "text-primary-foreground/70")} maxFontSizeMultiplier={1.2}>
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
