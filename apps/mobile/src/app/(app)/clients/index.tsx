import { router } from "expo-router";
import { useState } from "react";
import { Card, EmptyState, ErrorState, ListItem, LoadingState, Screen, SearchBar } from "@/components/ui";
import { useApi } from "@/features/data";

interface ClientRow {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  projectCount: number;
}

export default function Clients() {
  const [q, setQ] = useState("");
  const list = useApi<ClientRow[]>(["clients", q], "/clients", { q: q || undefined, limit: 200 });
  return (
    <Screen title="Clients" back onRefresh={() => void list.refetch()} refreshing={list.isFetching}>
      <SearchBar value={q} onChangeText={setQ} placeholder="Search name, email, phone" className="mb-3" />
      {list.isLoading ? (
        <LoadingState />
      ) : list.error ? (
        <ErrorState offline onRetry={() => void list.refetch()} />
      ) : !list.data?.length ? (
        <EmptyState icon="people-outline" title="No clients found" />
      ) : (
        <Card className="py-1">
          {list.data.map((c) => (
            <ListItem key={c.id} icon="person-outline" title={c.fullName} subtitle={[c.phone, c.email, `${c.projectCount} project(s)`].filter(Boolean).join(" · ")} onPress={() => router.push(`/clients/${c.id}`)} />
          ))}
        </Card>
      )}
    </Screen>
  );
}
