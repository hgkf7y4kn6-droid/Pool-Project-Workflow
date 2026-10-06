import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { FlatList, KeyboardAvoidingView, Platform, View } from "react-native";
import { clsx } from "clsx";
import { Button, EntitySyncBadge, Screen, Segmented, Text, TextField } from "@/components/ui";
import { useMessages, useProject } from "@/features/data";
import { dateTime } from "@/lib/format";
import { sendMessage } from "@/lib/mutations";
import { useActor, useSession } from "@/providers/session";

/** Project conversation: client thread and internal crew thread (offline-capable). */
export default function Messages() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const actor = useActor();
  const { can } = useSession();
  const project = useProject(id);
  const internal = can("message:read_internal");
  const [thread, setThread] = useState<"client" | "crew">(internal ? "crew" : "client");
  const msgs = useMessages(id, thread);
  const [body, setBody] = useState("");
  const send = async () => {
    if (!body.trim()) return;
    await sendMessage(id, body.trim(), thread === "client" ? "client" : "internal", actor);
    setBody("");
  };
  return (
    <Screen title="Messages" subtitle={project.data?.name} back scroll={false}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className="flex-1" keyboardVerticalOffset={90}>
        {internal && <Segmented value={thread} onChange={setThread} options={[{ value: "crew", label: "Team (internal)" }, { value: "client", label: "Client" }]} />}
        <FlatList
          className="flex-1"
          data={[...(msgs.data ?? [])].reverse()}
          inverted
          keyExtractor={(m) => m.id}
          contentContainerClassName="gap-2 py-3"
          renderItem={({ item: m }) => {
            const mine = m.authorId === actor.userId;
            return (
              <View className={clsx("max-w-[85%] gap-1 rounded-2xl p-3", mine ? "self-end bg-primary" : "self-start border border-border bg-card")}>
                {!mine && <Text className="font-sans-semibold text-xs text-muted-foreground">{m.authorName ?? "Team"}</Text>}
                <Text className={mine ? "text-primary-foreground" : "text-foreground"}>{m.body}</Text>
                <View className="flex-row items-center gap-2">
                  <Text className={mine ? "text-xs text-primary-foreground/80" : "text-xs text-muted-foreground"}>{dateTime(m.createdAt)}</Text>
                  {mine && <EntitySyncBadge type="message" id={m.id} />}
                </View>
              </View>
            );
          }}
        />
        <View className="flex-row items-end gap-2 pb-28">
          <TextField className="flex-1" value={body} onChangeText={setBody} placeholder={thread === "client" ? "Message the homeowner…" : "Message the team…"} multiline />
          <Button label="Send" icon="send" size="md" onPress={() => void send()} disabled={!body.trim()} />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
