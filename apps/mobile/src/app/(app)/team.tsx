import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { ApiError } from "@pool/api-client";
import { ROLES, ROLE_LABELS, type Role } from "@pool/types";
import { Avatar, Badge, BottomSheet, Button, Card, ErrorState, ListItem, LoadingState, Screen, SectionHeader, Select, Text, TextField } from "@/components/ui";
import { useApi } from "@/features/data";
import { api } from "@/lib/api";
import { fromNow } from "@/lib/format";
import { useSession } from "@/providers/session";

interface UserRow {
  id: string;
  fullName: string;
  email: string;
  role: Role;
  isActive: boolean;
  invitePending: boolean;
  lastLoginAt: string | null;
}
interface TeamRow {
  id: string;
  name: string;
  kind: string;
  members: { userId: string; fullName: string; role: Role }[];
}

/** Users, crews and invitations. */
export default function Team() {
  const params = useLocalSearchParams<{ inviteClientId?: string; inviteEmail?: string; inviteName?: string }>();
  const { can } = useSession();
  const users = useApi<UserRow[]>(["users", "all"], "/users", { includeInactive: true });
  const teams = useApi<TeamRow[]>(["teams"], "/teams");
  const [inviting, setInviting] = useState(!!params.inviteClientId);

  if (users.isLoading) return <Screen title="Team" back><LoadingState /></Screen>;
  if (users.error) return <Screen title="Team" back><ErrorState offline onRetry={() => void users.refetch()} /></Screen>;
  return (
    <Screen title="Team" back actions={can("user:manage") ? <Button label="Invite" size="sm" icon="person-add" onPress={() => setInviting(true)} /> : null}>
      <SectionHeader title="Crews & teams" />
      <View className="gap-2">
        {(teams.data ?? []).map((t) => (
          <Card key={t.id}>
            <Text variant="h3">{t.name}</Text>
            <Text variant="caption">{t.members.map((m) => m.fullName).join(", ") || "No members"}</Text>
          </Card>
        ))}
      </View>
      <SectionHeader title="People" />
      <Card className="py-1">
        {(users.data ?? []).map((u) => (
          <ListItem
            key={u.id}
            title={u.fullName}
            subtitle={`${ROLE_LABELS[u.role]} · ${u.email}${u.lastLoginAt ? ` · active ${fromNow(u.lastLoginAt)}` : ""}`}
            right={u.invitePending ? <Badge label="Invited" tone="info" size="sm" /> : !u.isActive ? <Badge label="Inactive" size="sm" /> : <Avatar name={u.fullName} size={32} />}
          />
        ))}
      </Card>
      {inviting && <InviteSheet initial={params} onClose={() => setInviting(false)} />}
    </Screen>
  );
}

function InviteSheet({ initial, onClose }: { initial: { inviteClientId?: string; inviteEmail?: string; inviteName?: string }; onClose: () => void }) {
  const qc = useQueryClient();
  const { user } = useSession();
  const [email, setEmail] = useState(initial.inviteEmail ?? "");
  const [name, setName] = useState(initial.inviteName ?? "");
  const [role, setRole] = useState<Role>(initial.inviteClientId ? "client" : "field_worker");
  const m = useMutation({
    mutationFn: () => api.post("/users/invite", { email, fullName: name, role, clientId: role === "client" ? initial.inviteClientId : null }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["users"] });
      onClose();
    },
  });
  const roles = ROLES.filter((r) => r !== "admin" || user?.role === "admin").filter((r) => r !== "client" || initial.inviteClientId);
  return (
    <BottomSheet visible onClose={onClose} title="Invite someone">
      <View className="gap-3">
        <TextField label="Full name" value={name} onChangeText={setName} />
        <TextField label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
        <Select label="Role" value={role} onChange={(v) => v && setRole(v)} options={roles.map((r) => ({ value: r, label: ROLE_LABELS[r] }))} />
        <Text variant="caption">They&apos;ll get an email with a link to set their password.</Text>
        {m.error ? <Text className="text-sm text-destructive">{m.error instanceof ApiError ? m.error.message : "Needs a connection"}</Text> : null}
        <Button label="Send invitation" loading={m.isPending} disabled={!email.includes("@") || !name.trim()} onPress={() => m.mutate()} />
      </View>
    </BottomSheet>
  );
}
