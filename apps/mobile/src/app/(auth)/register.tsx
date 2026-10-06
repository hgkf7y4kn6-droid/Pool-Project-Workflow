import { useState } from "react";
import { View } from "react-native";
import { ApiError } from "@pool/api-client";
import { registerSchema } from "@pool/validation";
import { Button, TextField, Text } from "@/components/ui";
import { api } from "@/lib/api";
import { useSession } from "@/providers/session";
import { AuthShell } from "@/components/auth-shell";

export default function Register() {
  const { completeLogin } = useSession();
  const [form, setForm] = useState({ organizationName: "", fullName: "", email: "", password: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const parsed = registerSchema.safeParse({ ...form, timezone: tz });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await completeLogin(await api.register(parsed.data));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not create the account");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Create your company" subtitle="You'll be the administrator and can invite your team next.">
      <View className="gap-4">
        <TextField label="Company name" value={form.organizationName} onChangeText={set("organizationName")} error={errors.organizationName} required />
        <TextField label="Your name" value={form.fullName} onChangeText={set("fullName")} autoComplete="name" error={errors.fullName} required />
        <TextField label="Work email" value={form.email} onChangeText={set("email")} autoCapitalize="none" keyboardType="email-address" error={errors.email} required />
        <TextField label="Password" value={form.password} onChangeText={set("password")} secureTextEntry helper="At least 10 characters with a letter and a number" error={errors.password} required />
        {error ? <Text className="text-sm text-destructive">{error}</Text> : null}
        <Button label="Create account" onPress={submit} loading={busy} fullWidth />
      </View>
    </AuthShell>
  );
}
