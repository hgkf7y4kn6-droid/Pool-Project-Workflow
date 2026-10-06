import { Redirect, Stack } from "expo-router";
import { useEffect } from "react";
import { View } from "react-native";
import { Icon } from "@/components/icon";
import { Button, Text } from "@/components/ui";
import { registerForPush } from "@/lib/notifications";
import { useSession } from "@/providers/session";

/** Authenticated area: redirects signed-out users and shows the biometric lock. */
export default function AppLayout() {
  const { status, user, unlock, signOut } = useSession();

  useEffect(() => {
    if (status === "signedIn") registerForPush().catch(() => undefined);
  }, [status]);

  if (status === "loading") return null;
  if (status === "signedOut" || !user) return <Redirect href="/sign-in" />;
  if (status === "locked") {
    return (
      <View className="flex-1 items-center justify-center gap-6 bg-background p-8">
        <View className="size-20 items-center justify-center rounded-3xl bg-primary">
          <Icon name="finger-print" className="text-5xl text-primary-foreground" />
        </View>
        <Text variant="h1" className="text-center">
          Pool PM is locked
        </Text>
        <Text variant="caption" className="text-center text-base">
          Signed in as {user.fullName}
        </Text>
        <Button label="Unlock" icon="lock-open-outline" onPress={() => void unlock()} fullWidth />
        <Button label="Sign out" variant="ghost" onPress={() => void signOut()} />
      </View>
    );
  }
  return <Stack screenOptions={{ headerShown: false, animation: "slide_from_right" }} />;
}
