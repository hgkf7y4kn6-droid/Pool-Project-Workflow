import { router, type Href } from "expo-router";
import { View } from "react-native";
import type { Permission } from "@pool/core";
import { ROLE_LABELS } from "@pool/types";
import type { IconName } from "@/components/icon";
import { Avatar, Card, ListItem, Screen, SectionHeader, Text } from "@/components/ui";
import { useSession, useUser } from "@/providers/session";

interface Entry {
  title: string;
  subtitle: string;
  icon: IconName;
  href: Href;
  permission?: Permission;
  internalOnly?: boolean;
}

const SECTIONS: { title: string; items: Entry[] }[] = [
  {
    title: "Work",
    items: [
      { title: "Search", subtitle: "Projects, clients, tasks, documents", icon: "search", href: "/search" },
      { title: "Approvals", subtitle: "Change orders and sign-offs", icon: "create-outline", href: "/approvals", permission: "approval:read" },
      { title: "Documents", subtitle: "Plans, permits, contracts, manuals", icon: "document-text-outline", href: "/documents", permission: "document:read" },
      { title: "Clients", subtitle: "Homeowners and properties", icon: "people-outline", href: "/clients", permission: "client:read", internalOnly: true },
      { title: "Reports", subtitle: "Portfolio, profit, labor utilization", icon: "bar-chart-outline", href: "/reports", permission: "report:read" },
      { title: "Map", subtitle: "Job sites and suppliers", icon: "map-outline", href: "/map", internalOnly: true },
    ],
  },
  {
    title: "Company",
    items: [
      { title: "Team", subtitle: "Users, crews and invitations", icon: "people-circle-outline", href: "/team", permission: "user:read" },
      { title: "Roles & permissions", subtitle: "What each role can do", icon: "shield-checkmark-outline", href: "/roles", permission: "org:manage" },
      { title: "Vendors & subcontractors", subtitle: "Suppliers, subs, rentals", icon: "storefront-outline", href: "/vendors", permission: "vendor:read" },
      { title: "Materials catalog", subtitle: "Items and unit costs", icon: "cube-outline", href: "/materials", permission: "material:read" },
      { title: "Integrations", subtitle: "Design platforms, weather, storage", icon: "extension-puzzle-outline", href: "/integrations", permission: "integration:manage" },
    ],
  },
  {
    title: "Device",
    items: [
      { title: "Offline queue", subtitle: "Changes waiting to sync", icon: "cloud-upload-outline", href: "/offline-queue" },
      { title: "Notifications", subtitle: "Inbox and preferences", icon: "notifications-outline", href: "/notifications" },
      { title: "Settings", subtitle: "Security, biometrics, offline projects", icon: "settings-outline", href: "/settings" },
    ],
  },
];

export default function More() {
  const user = useUser();
  const { can } = useSession();
  const internal = user.role !== "client" && user.role !== "subcontractor";
  return (
    <Screen title="More">
      <Card className="flex-row items-center gap-3">
        <Avatar name={user.fullName} size={52} />
        <View className="flex-1">
          <Text variant="h3">{user.fullName}</Text>
          <Text variant="caption">
            {ROLE_LABELS[user.role]} · {user.email}
          </Text>
        </View>
      </Card>
      {SECTIONS.map((section) => {
        const items = section.items.filter((i) => (!i.permission || can(i.permission)) && (!i.internalOnly || internal));
        if (!items.length) return null;
        return (
          <View key={section.title}>
            <SectionHeader title={section.title} />
            <Card className="py-1">
              {items.map((i) => (
                <ListItem key={i.title} title={i.title} subtitle={i.subtitle} icon={i.icon} onPress={() => router.push(i.href)} />
              ))}
            </Card>
          </View>
        );
      })}
    </Screen>
  );
}
