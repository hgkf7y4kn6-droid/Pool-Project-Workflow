import { router, useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import type { ChangeOrder } from "@pool/types";
import { ChangeOrderBadge } from "@/components/status-badges";
import { Card, EmptyState, ErrorState, Fab, LoadingState, Screen, Text } from "@/components/ui";
import { useApi } from "@/features/data";
import { money } from "@/lib/format";
import { useSession } from "@/providers/session";

export default function ProjectChangeOrders() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { can } = useSession();
  const q = useApi<ChangeOrder[]>(["change-orders", id], `/projects/${id}/change-orders`);
  return (
    <>
      <Screen title="Change orders" back onRefresh={() => void q.refetch()} refreshing={q.isFetching}>
        {q.isLoading ? (
          <LoadingState />
        ) : q.error ? (
          <ErrorState offline onRetry={() => void q.refetch()} />
        ) : !q.data?.length ? (
          <EmptyState icon="swap-horizontal-outline" title="No change orders" />
        ) : (
          <View className="gap-2">
            {q.data.map((co) => (
              <Card key={co.id} onPress={() => router.push(`/change-orders/${co.id}`)} className="gap-1">
                <View className="flex-row items-center justify-between gap-2">
                  <Text variant="bodyStrong" className="flex-1">
                    #{co.number} {co.title}
                  </Text>
                  <ChangeOrderBadge status={co.status} />
                </View>
                <Text variant="caption">
                  {money(co.priceCents)}
                  {co.scheduleImpactDays ? ` · +${co.scheduleImpactDays} day(s)` : ""}
                </Text>
              </Card>
            ))}
          </View>
        )}
      </Screen>
      {can("change_order:create") && <Fab icon="add" label="New change order" onPress={() => router.push({ pathname: "/change-orders/new", params: { projectId: id } })} />}
    </>
  );
}
