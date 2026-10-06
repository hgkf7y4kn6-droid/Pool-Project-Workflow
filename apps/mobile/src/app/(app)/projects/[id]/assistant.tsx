import { useMutation } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { ApiError } from "@pool/api-client";
import { Button, Card, Chips, Screen, Text, TextField } from "@/components/ui";
import { useProject } from "@/features/data";
import { api } from "@/lib/api";

type Mode = "assistant" | "daily_summary" | "client_update" | "schedule_review";
const PRESETS: Record<Mode, string> = {
  assistant: "What still needs to be completed before plaster?",
  daily_summary: "Summarize today's field activity.",
  client_update: "Write this week's progress update for the homeowner.",
  schedule_review: "Are there schedule risks I should act on?",
};

/** AI project assistant. Answers only from data this user may already see. */
export default function Assistant() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const project = useProject(id);
  const [mode, setMode] = useState<Mode>("assistant");
  const [question, setQuestion] = useState(PRESETS.assistant);
  const ask = useMutation({ mutationFn: () => api.post<{ answer: string; model: string }>(`/projects/${id}/ai/ask`, { question, mode }) });
  return (
    <Screen title="AI assistant" subtitle={project.data?.name} back>
      <View className="gap-3">
        <Chips
          value={mode}
          onChange={(m) => {
            setMode(m);
            setQuestion(PRESETS[m]);
          }}
          options={[
            { value: "assistant", label: "Ask" },
            { value: "daily_summary", label: "Daily summary" },
            { value: "client_update", label: "Client update" },
            { value: "schedule_review", label: "Schedule risks" },
          ]}
        />
        <TextField label="Question" value={question} onChangeText={setQuestion} multiline />
        <Button label="Ask" icon="sparkles" loading={ask.isPending} onPress={() => ask.mutate()} disabled={question.trim().length < 3} />
        {ask.error ? <Text className="text-sm text-destructive">{ask.error instanceof ApiError ? ask.error.message : "Needs a connection"}</Text> : null}
        {ask.data ? (
          <Card className="gap-2">
            <Text selectable>{ask.data.answer}</Text>
            <Text variant="caption">AI-generated from project data you can access. Check before sending to a client.</Text>
          </Card>
        ) : null}
      </View>
    </Screen>
  );
}
