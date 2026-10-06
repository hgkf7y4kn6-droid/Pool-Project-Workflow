import { Redirect, Stack } from "expo-router";
import { useSession } from "@/providers/session";

export default function AuthLayout() {
  const { status } = useSession();
  if (status === "signedIn" || status === "locked") return <Redirect href="/dashboard" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
