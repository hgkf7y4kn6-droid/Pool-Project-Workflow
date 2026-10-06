import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { ApiError } from "@pool/api-client";
import { Button, TextField, Text } from "@/components/ui";
import { useSession } from "@/providers/session";
import { AuthShell } from "@/components/auth-shell";

export default function Mfa() {
  const { ticket } = useLocalSearchParams<{ ticket: string }>();
  const { verifyMfa } = useSession();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await verifyMfa(ticket, code.trim());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Verification failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Two-step verification" subtitle="Enter the 6-digit code from your authenticator app.">
      <View className="gap-4">
        <TextField label="Code" value={code} onChangeText={setCode} keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="one-time-code" maxLength={6} error={error} onSubmitEditing={submit} />
        <Button label="Verify" onPress={submit} loading={busy} disabled={code.length !== 6} />
        <Text variant="caption" className="text-center">
          Codes refresh every 30 seconds.
        </Text>
      </View>
    </AuthShell>
  );
}
