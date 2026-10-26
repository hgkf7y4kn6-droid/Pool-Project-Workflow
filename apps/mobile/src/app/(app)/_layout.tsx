import { Redirect, Stack } from "expo-router";
import { useEffect, useState } from "react";
import { hasSeenIntro, IntroTour } from "@/components/onboarding/intro-tour";
import { ActivityIndicator, View } from "react-native";
import { BrandMark } from "@/components/brand";
import { Icon } from "@/components/icon";
import { Button, Text } from "@/components/ui";
import { registerForPush } from "@/lib/notifications";
import { useSession } from "@/providers/session";

/** Authenticated area: redirects signed-out users and shows the biometric lock. */
export default function AppLayout() {
  const { status, user, unlock, signOut } = useSession();
  const [introOpen, setIntroOpen] = useState(false);
  useEffect(() => {
    if (status === "signedIn" && user && !hasSeenIntro(user.id)) setIntroOpen(true);
  }, [status, user]);

  useEffect(() => {
    if (status === "signedIn") registerForPush().catch(() => undefined);
  }, [status]);

  // Branded gate while the session restores (never a blank white screen).
  if (status === "loading") {
    return (
      <View className="flex-1 items-center justify-center gap-6 bg-background">
        <BrandMark size={72} />
        <ActivityIndicator />
      </View>
    );
  }
  if (status === "signedOut" || !user) return <Redirect href="/sign-in" />;
  if (status === "locked") {
    return (
      <View className="flex-1 items-center justify-center gap-6 bg-background p-8">
        <View>
          <BrandMark size={84} />
          <View className="absolute -bottom-2 -right-2 size-9 items-center justify-center rounded-full border-2 border-background bg-primary">
            <Icon name="finger-print" className="text-lg text-primary-foreground" />
          </View>
        </View>
        <Text variant="h1" className="text-center">
          Welcome back
        </Text>
        <Text variant="caption" className="text-center text-base">
          Signed in as {user.fullName}
        </Text>
        <Button label="Unlock" icon="lock-open-outline" onPress={() => void unlock()} fullWidth />
        <Button label="Sign out" variant="ghost" onPress={() => void signOut()} />
      </View>
    );
  }
  return (
    <>
      <Stack screenOptions={{ headerShown: false, animation: "slide_from_right" }} />
      {introOpen && <IntroTour userId={user.id} role={user.role} onDone={() => setIntroOpen(false)} />}
    </>
  );
}
