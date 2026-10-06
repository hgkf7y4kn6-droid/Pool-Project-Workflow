import { Link, router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { ApiError, NetworkError } from "@pool/api-client";
import { loginSchema } from "@pool/validation";
import { Button, TextField, Text } from "@/components/ui";
import { useSession } from "@/providers/session";
import { AuthShell } from "@/components/auth-shell";

export default function SignIn() {
  const { signIn } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      setFieldErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setFieldErrors({});
    setError(null);
    setBusy(true);
    try {
      const res = await signIn(parsed.data.email, parsed.data.password);
      if (res.mfaRequired && res.mfaTicket) router.push({ pathname: "/mfa", params: { ticket: res.mfaTicket } });
    } catch (e) {
      setError(e instanceof NetworkError ? "Can't reach the server. Check your connection." : e instanceof ApiError ? e.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Pool PM" subtitle="Sign in to manage your projects">
      <View className="gap-4">
        <TextField label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="username" icon="mail-outline" error={fieldErrors.email} />
        <TextField label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" textContentType="password" icon="lock-closed-outline" error={fieldErrors.password} onSubmitEditing={submit} returnKeyType="go" />
        {error ? (
          <Text accessibilityLiveRegion="assertive" className="font-sans-medium text-sm text-destructive">
            {error}
          </Text>
        ) : null}
        <Button label="Sign in" onPress={submit} loading={busy} fullWidth />
        <Link href="/forgot-password" asChild>
          <Button label="Forgot password or email me a link" variant="ghost" size="md" />
        </Link>
      </View>
      <View className="items-center">
        <Link href="/register" asChild>
          <Button label="New company? Create an account" variant="outline" size="md" fullWidth />
        </Link>
      </View>
    </AuthShell>
  );
}
