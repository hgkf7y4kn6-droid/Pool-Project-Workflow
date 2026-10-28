import { useMutation } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { ApiError } from "@pool/api-client";
import type { IntelligenceAnswer } from "@pool/types";
import { AiLabel, RecordLinks } from "@/components/intelligence";
import { Button, Card, Chips, Screen, Text, TextField } from "@/components/ui";
import { useProject } from "@/features/data";
import { askIntelligence } from "@/features/intelligence";

const SUGGESTIONS = [
  "What should happen next?",
  "What is preventing this project from progressing?",
  "Are we ready for excavation?",
  "Which milestones are at risk?",
  "What needs to happen before the next inspection?",
  "Which homeowner decisions are outstanding?",
  "What materials need confirmation this week?",
  "What should I tell the homeowner today?",
  "Which tasks matter most today?",
] as const;

/** Ask the project superintendent. Answers come from records you can see, with links to them. */
export default function Assistant() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const project = useProject(id);
  const [question, setQuestion] = useState<string>(SUGGESTIONS[0]);
  const ask = useMutation({ mutationFn: (q: string) => askIntelligence(id, q) });
  const answer: IntelligenceAnswer | undefined = ask.data;
  const submit = (q: string) => {
    setQuestion(q);
    if (q.trim().length >= 3) ask.mutate(q);
  };

  return (
    <Screen kicker={project.data?.number ?? "Project"} title="Ask the superintendent" subtitle={project.data?.name} back>
      <View className="gap-3">
        <Chips value={null} onChange={(q) => submit(q)} options={SUGGESTIONS.map((s) => ({ value: s, label: s }))} />
        <TextField label="Your question" value={question} onChangeText={setQuestion} multiline returnKeyType="send" onSubmitEditing={() => submit(question)} />
        <Button label="Ask" icon="sparkles" loading={ask.isPending} onPress={() => submit(question)} disabled={question.trim().length < 3} />
        {ask.error ? <Text className="text-sm text-destructive">{ask.error instanceof ApiError ? ask.error.message : "Needs a connection"}</Text> : null}
        {answer ? (
          <Card className="gap-3">
            <Text selectable>{answer.answer}</Text>
            <RecordLinks items={answer.citations} projectId={id} />
            {answer.warnings.map((w) => (
              <Text key={w} variant="caption">
                {w}
              </Text>
            ))}
            {answer.source === "agent" ? <AiLabel /> : <Text variant="caption">Answered directly from project records and readiness rules.</Text>}
          </Card>
        ) : null}
      </View>
    </Screen>
  );
}
