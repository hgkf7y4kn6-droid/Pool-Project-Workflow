import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { ApiError } from "@pool/api-client";
import { Button, Text } from "@/components/ui";
import { api } from "@/lib/api";
import { useSession } from "@/providers/session";
import { AuthShell } from "@/components/auth-shell";

/** Deep link target: poolpm://magic-link?token=… */
export default function MagicLink() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const { completeLogin } = useSession();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    api
      .verifyMagicLink(token)
      .then((res) => {
        if (res.mfaRequired && res.mfaTicket) router.replace({ pathname: "/mfa", params: { ticket: res.mfaTicket } });
        else return completeLogin(res);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "This link could not be used"));
  }, [token, completeLogin]);

  return (
    <AuthShell title="Signing you in">
      <View className="items-center gap-4">
        {error ? (
          <>
            <Text className="text-center text-destructive">{error}</Text>
            <Button label="Back to sign in" variant="outline" onPress={() => router.replace("/sign-in")} />
          </>
        ) : (
          <ActivityIndicator size="large" />
        )}
      </View>
    </AuthShell>
  );
}
