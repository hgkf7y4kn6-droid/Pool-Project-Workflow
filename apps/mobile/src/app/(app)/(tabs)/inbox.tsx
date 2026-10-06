import { router } from "expo-router";
import type { Message } from "@pool/types";
import { Card, EmptyState, ErrorState, ListItem, LoadingState, Screen, Text } from "@/components/ui";
import { useApi } from "@/features/data";
import { fromNow } from "@/lib/format";

/** Latest conversation per project. */
export default function Inbox() {
  const q = useApi<(Message & { projectName: string; authorName: string })[]>(["inbox"], "/inbox");
  return (
    <Screen title="Messages" onRefresh={() => void q.refetch()} refreshing={q.isFetching}>
      {q.isLoading ? (
        <LoadingState />
      ) : q.error ? (
        <ErrorState onRetry={() => void q.refetch()} />
      ) : !q.data?.length ? (
        <EmptyState icon="chatbubbles-outline" title="No messages yet" />
      ) : (
        <Card className="py-1">
          {q.data.map((m) => (
            <ListItem key={m.id} icon="chatbubble-ellipses-outline" title={m.projectName} subtitle={`${m.authorName}: ${m.body}`} right={<Text variant="caption">{fromNow(m.createdAt)}</Text>} onPress={() => router.push(`/projects/${m.projectId}/messages`)} />
          ))}
        </Card>
      )}
    </Screen>
  );
}

