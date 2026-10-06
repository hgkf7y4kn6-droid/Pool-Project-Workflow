import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { Button, TextField, Text } from "@/components/ui";
import { api } from "@/lib/api";
import { AuthShell } from "@/components/auth-shell";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<"reset" | "magic" | null>(null);
  const [busy, setBusy] = useState(false);

  const send = async (kind: "reset" | "magic") => {
    if (!email.includes("@")) return;
    setBusy(true);
    try {
      if (kind === "reset") await api.forgotPassword(email.trim());
      else await api.requestMagicLink(email.trim());
    } finally {
      // The API answers the same way whether or not the account exists.
      setSent(kind);
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Account help" subtitle="We'll email you a password reset link or a one-time sign-in link.">
      {sent ? (
        <View className="gap-4">
          <Text className="text-center">If an account exists for {email}, a {sent === "reset" ? "reset" : "sign-in"} link is on its way.</Text>
          <Button label="Back to sign in" variant="outline" onPress={() => router.replace("/sign-in")} />
        </View>
      ) : (
        <View className="gap-4">
          <TextField label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
          <Button label="Email me a sign-in link" onPress={() => send("magic")} loading={busy} />
          <Button label="Reset my password" variant="outline" onPress={() => send("reset")} disabled={busy} />
        </View>
      )}
    </AuthShell>
  );
}
