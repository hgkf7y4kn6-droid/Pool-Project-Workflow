import { useState } from "react";
import { Linking, Platform, View } from "react-native";
import { ApiError } from "@pool/api-client";
import { Button, Card, Screen, Text, TextField } from "@/components/ui";
import { api } from "@/lib/api";
import { useSession } from "@/providers/session";

/** Turn TOTP two-step verification on or off for the signed-in user. */
export default function TwoStepVerification() {
  const { user, refreshUser } = useSession();
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const enabled = !!user?.mfaEnabled;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No connection. Two-step verification changes need to be online.");
    } finally {
      setBusy(false);
    }
  };

  const start = () => run(async () => setSetup(await api.post<{ secret: string; otpauthUrl: string }>("/auth/mfa/setup", {})));
  const confirm = () =>
    run(async () => {
      await api.post(enabled ? "/auth/mfa/disable" : "/auth/mfa/confirm", { code });
      await refreshUser();
      setSetup(null);
      setCode("");
      setDone(enabled ? "Two-step verification is off." : "Two-step verification is on. You'll be asked for a code when you sign in.");
    });

  const codeField = (
    <TextField
      label="6-digit code"
      value={code}
      onChangeText={(v) => setCode(v.replace(/\D/g, "").slice(0, 6))}
      keyboardType="number-pad"
      autoComplete="one-time-code"
      textContentType="oneTimeCode"
      error={error ?? undefined}
    />
  );

  return (
    <Screen title="Two-step verification" back>
      <View className="gap-4">
        {done ? (
          <Card>
            <Text variant="bodyStrong" accessibilityLiveRegion="polite">{done}</Text>
          </Card>
        ) : null}

        {enabled ? (
          <Card className="gap-3">
            <Text>Two-step verification is on. To turn it off, enter a current code from your authenticator app.</Text>
            {codeField}
            <Button label="Turn off" variant="destructive" loading={busy} disabled={code.length !== 6} onPress={() => void confirm()} />
          </Card>
        ) : setup ? (
          <Card className="gap-3">
            <Text variant="bodyStrong">1. Add this account to your authenticator app</Text>
            {Platform.OS !== "web" ? <Button label="Open authenticator app" variant="secondary" icon="open-outline" onPress={() => void Linking.openURL(setup.otpauthUrl)} /> : null}
            <Text variant="caption">Or enter this key manually:</Text>
            <Text selectable className="font-sans-semibold text-lg tracking-widest" accessibilityLabel={`Setup key ${setup.secret.split("").join(" ")}`}>
              {setup.secret.match(/.{1,4}/g)?.join(" ")}
            </Text>
            <Text variant="bodyStrong">2. Enter the code it shows</Text>
            {codeField}
            <Button label="Turn on" loading={busy} disabled={code.length !== 6} onPress={() => void confirm()} />
          </Card>
        ) : (
          <Card className="gap-3">
            <Text>Protect your account with a code from an authenticator app (Google Authenticator, 1Password, Authy…) in addition to your password.</Text>
            {error ? <Text className="text-sm text-destructive">{error}</Text> : null}
            <Button label="Set up two-step verification" icon="key-outline" loading={busy} onPress={() => void start()} />
          </Card>
        )}
      </View>
    </Screen>
  );
}
