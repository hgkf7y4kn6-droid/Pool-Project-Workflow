import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Linking, View } from "react-native";
import type { Vendor } from "@pool/types";
import { BottomSheet, Button, Card, Chips, EmptyState, ErrorState, Fab, ListItem, LoadingState, Screen, Text, TextField } from "@/components/ui";
import { useApi } from "@/features/data";
import { api } from "@/lib/api";
import { titleCase } from "@/lib/format";
import { useSession } from "@/providers/session";

type Kind = "supplier" | "subcontractor" | "rental" | "other";

export default function Vendors() {
  const { can } = useSession();
  const [kind, setKind] = useState<Kind | "all">("all");
  const q = useApi<Vendor[]>(["vendors", kind], "/vendors", { kind: kind === "all" ? undefined : kind });
  const [adding, setAdding] = useState(false);
  return (
    <>
      <Screen title="Vendors & subs" back onRefresh={() => void q.refetch()} refreshing={q.isFetching}>
        <Chips className="mb-3" value={kind} onChange={setKind} options={[{ value: "all", label: "All" }, ...(["supplier", "subcontractor", "rental", "other"] as Kind[]).map((k) => ({ value: k, label: titleCase(k) }))]} />
        {q.isLoading ? (
          <LoadingState />
        ) : q.error ? (
          <ErrorState offline onRetry={() => void q.refetch()} />
        ) : !q.data?.length ? (
          <EmptyState icon="storefront-outline" title="No vendors" />
        ) : (
          <Card className="py-1">
            {q.data.map((v) => (
              <ListItem key={v.id} icon={v.kind === "subcontractor" ? "construct-outline" : "storefront-outline"} title={v.name} subtitle={[titleCase(v.kind), v.trade, v.contactName, v.phone].filter(Boolean).join(" · ")} onPress={v.phone ? () => void Linking.openURL(`tel:${v.phone}`) : undefined} accessibilityHint={v.phone ? "Calls the vendor" : undefined} />
            ))}
          </Card>
        )}
      </Screen>
      {can("vendor:manage") && <Fab icon="add" label="Add vendor" onPress={() => setAdding(true)} />}
      {adding && <VendorSheet onClose={() => setAdding(false)} />}
    </>
  );
}

function VendorSheet({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ name: "", kind: "supplier" as Kind, trade: "", contactName: "", phone: "", email: "" });
  const m = useMutation({
    mutationFn: () => api.post("/vendors", { ...f, email: f.email || null, trade: f.trade || null, contactName: f.contactName || null, phone: f.phone || null }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["vendors"] });
      onClose();
    },
  });
  return (
    <BottomSheet visible onClose={onClose} title="Add vendor">
      <View className="gap-3">
        <TextField label="Name" value={f.name} onChangeText={(name) => setF({ ...f, name })} />
        <Chips value={f.kind} onChange={(kind) => setF({ ...f, kind })} options={(["supplier", "subcontractor", "rental", "other"] as Kind[]).map((k) => ({ value: k, label: titleCase(k) }))} />
        <TextField label="Trade" value={f.trade} onChangeText={(trade) => setF({ ...f, trade })} />
        <TextField label="Contact" value={f.contactName} onChangeText={(contactName) => setF({ ...f, contactName })} />
        <TextField label="Phone" value={f.phone} onChangeText={(phone) => setF({ ...f, phone })} keyboardType="phone-pad" />
        <TextField label="Email" value={f.email} onChangeText={(email) => setF({ ...f, email })} keyboardType="email-address" autoCapitalize="none" />
        {m.error ? <Text className="text-sm text-destructive">Could not save.</Text> : null}
        <Button label="Save" loading={m.isPending} disabled={!f.name.trim()} onPress={() => m.mutate()} />
      </View>
    </BottomSheet>
  );
}
