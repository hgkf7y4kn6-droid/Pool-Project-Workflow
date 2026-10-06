import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import type { Payment } from "@pool/types";
import { PaymentBadge } from "@/components/status-badges";
import { Button, Card, EmptyState, ErrorState, LoadingState, Screen, Stat, Text } from "@/components/ui";
import { useApi } from "@/features/data";
import { api } from "@/lib/api";
import { date, money } from "@/lib/format";
import { useSession } from "@/providers/session";

/** Payment schedule (deposit, progress draws, change orders, final). */
export default function Payments() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { can } = useSession();
  const qc = useQueryClient();
  const q = useApi<{ items: Payment[]; totals: { scheduledCents: number; paidCents: number; outstandingCents: number } }>(["payments", id], `/projects/${id}/payments`);
  const markPaid = useMutation({
    mutationFn: (p: Payment) => api.patch(`/projects/${id}/payments/${p.id}`, { status: "paid" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["payments", id] }),
  });
  return (
    <Screen title="Payments" back onRefresh={() => void q.refetch()} refreshing={q.isFetching}>
      {q.isLoading ? (
        <LoadingState />
      ) : q.error || !q.data ? (
        <ErrorState offline onRetry={() => void q.refetch()} />
      ) : (
        <>
          <View className="flex-row flex-wrap gap-3">
            <Stat label="Paid" value={money(q.data.totals.paidCents)} tone="success" />
            <Stat label="Outstanding" value={money(q.data.totals.outstandingCents)} />
          </View>
          {!q.data.items.length && <EmptyState icon="card-outline" title="No payments scheduled" />}
          <View className="mt-4 gap-2">
            {q.data.items.map((p) => (
              <Card key={p.id} className="gap-1">
                <View className="flex-row items-center justify-between gap-2">
                  <Text variant="bodyStrong" className="flex-1">
                    {p.label}
                  </Text>
                  <Text className="font-sans-bold text-base">{money(p.amountCents)}</Text>
                </View>
                <View className="flex-row items-center justify-between">
                  <Text variant="caption">{p.status === "paid" ? `Paid ${date(p.paidAt)}${p.method ? ` · ${p.method}` : ""}` : p.dueDate ? `Due ${date(p.dueDate)}` : "No due date"}</Text>
                  <PaymentBadge status={p.status} />
                </View>
                {can("payment:manage") && p.status !== "paid" && p.status !== "void" && (
                  <Button label="Mark paid" variant="secondary" size="sm" loading={markPaid.isPending} onPress={() => markPaid.mutate(p)} />
                )}
              </Card>
            ))}
          </View>
        </>
      )}
    </Screen>
  );
}
