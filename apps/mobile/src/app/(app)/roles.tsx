import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { ROLE_LABELS, type Role } from "@pool/types";
import { Icon } from "@/components/icon";
import { Card, Chips, ErrorState, LoadingState, Screen, Text } from "@/components/ui";
import { useApi } from "@/features/data";
import { api } from "@/lib/api";
import { titleCase } from "@/lib/format";

type Matrix = { role: Role; permissions: { permission: string; default: boolean; granted: boolean; overridden: boolean }[] }[];

/** Role permission matrix with per-company overrides (admins only). */
export default function Roles() {
  const qc = useQueryClient();
  const q = useApi<Matrix>(["roles"], "/roles");
  const [role, setRole] = useState<Role>("project_manager");
  const toggle = useMutation({
    mutationFn: (p: { permission: string; granted: boolean | null }) => api.put(`/roles/${role}/permissions`, { changes: [p] }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["roles"] }),
  });
  if (q.isLoading) return <Screen title="Roles" back><LoadingState /></Screen>;
  if (q.error || !q.data) return <Screen title="Roles" back><ErrorState offline onRetry={() => void q.refetch()} /></Screen>;
  const row = q.data.find((r) => r.role === role)!;
  const groups = new Map<string, typeof row.permissions>();
  for (const p of row.permissions) {
    const g = p.permission.split(":")[0]!;
    groups.set(g, [...(groups.get(g) ?? []), p]);
  }
  return (
    <Screen title="Roles & permissions" back>
      <Chips value={role} onChange={setRole} options={q.data.map((r) => ({ value: r.role, label: ROLE_LABELS[r.role] }))} />
      <Text variant="caption" className="my-3">
        {role === "admin" ? "Administrators always have full access." : "Tap to grant or revoke. Clients and subcontractors can lose permissions but never gain internal ones."}
      </Text>
      <View className="gap-3">
        {[...groups].map(([group, perms]) => (
          <Card key={group}>
            <Text variant="h3" className="mb-1">
              {titleCase(group)}
            </Text>
            {perms.map((p) => (
              <Pressable
                key={p.permission}
                disabled={role === "admin"}
                accessibilityRole="switch"
                accessibilityState={{ checked: p.granted }}
                onPress={() => toggle.mutate({ permission: p.permission, granted: p.overridden ? null : !p.granted })}
                className="min-h-12 flex-row items-center gap-3"
              >
                <Icon name={p.granted ? "checkmark-circle" : "ellipse-outline"} className={p.granted ? "text-2xl text-success" : "text-2xl text-muted-foreground"} />
                <Text className="flex-1">{titleCase(p.permission.split(":")[1])}</Text>
                {p.overridden ? <Text className="text-xs text-warning">custom</Text> : null}
              </Pressable>
            ))}
          </Card>
        ))}
      </View>
    </Screen>
  );
}
