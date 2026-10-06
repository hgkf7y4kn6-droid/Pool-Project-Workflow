import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useSession } from "@/providers/session";

/** Splash/router: decides between the auth flow and the app. */
export default function Index() {
  const { status } = useSession();
  if (status === "loading") {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator size="large" />
      </View>
    );
  }
  return <Redirect href={status === "signedOut" ? "/sign-in" : "/dashboard"} />;
}
