import { router, type Href } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { Icon } from "@/components/icon";
import { Card, PressableScale, Text } from "@/components/ui";
import { useProjects } from "@/features/data";
import { getJSON, kv, KV_KEYS, setJSON } from "@/lib/kv";
import { useSession, useUser } from "@/providers/session";

interface Step {
  key: string;
  title: string;
  hint: string;
  href: Href;
  done: boolean;
}

export function startHereHidden(userId: string) {
  return kv.getString(`${KV_KEYS.startHereHidden}.${userId}`) === "1";
}

export function showStartHere(userId: string) {
  kv.remove(`${KV_KEYS.startHereHidden}.${userId}`);
}

/**
 * Getting-started checklist for admins and project managers: the three
 * things that make Pool PM useful on day one. Dismissible; Settings brings it back.
 */
export function StartHereCard() {
  const user = useUser();
  const { can } = useSession();
  const projects = useProjects("all");
  const visitedKey = `${KV_KEYS.startHereVisited}.${user.id}`;
  const [visited, setVisited] = useState<string[]>(getJSON(visitedKey, []));
  const [hidden, setHidden] = useState(startHereHidden(user.id));
  if (hidden || !(can("project:create") || can("user:manage"))) return null;

  const steps: Step[] = [
    { key: "project", title: "Create your first project", hint: "Client, site and a full stage plan in one step", href: "/projects/new", done: (projects.data?.length ?? 0) > 0 },
    { key: "team", title: "Invite your crew", hint: "Supervisors, workers and subs get their own view", href: "/team", done: visited.includes("team") },
    { key: "mfa", title: "Protect your account", hint: "Turn on two-step verification", href: "/two-step", done: !!user.mfaEnabled },
  ];
  const done = steps.filter((s) => s.done).length;
  const open = (s: Step) => {
    if (!visited.includes(s.key)) {
      const next = [...visited, s.key];
      setVisited(next);
      setJSON(visitedKey, next);
    }
    router.push(s.href);
  };
  const dismiss = () => {
    kv.set(`${KV_KEYS.startHereHidden}.${user.id}`, "1");
    setHidden(true);
  };

  return (
    <Card className="mt-3 border-accent">
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1">
          <Text variant="kicker">Getting started · {done} of {steps.length}</Text>
          <Text variant="h3">Set up Pool PM in a few minutes</Text>
        </View>
        <PressableScale accessibilityRole="button" accessibilityLabel="Hide getting started" onPress={dismiss} hitSlop={8} className="size-9 items-center justify-center rounded-full bg-muted">
          <Icon name="close" className="text-base text-muted-foreground" />
        </PressableScale>
      </View>
      <View className="mt-3 gap-1">
        {steps.map((s, i) => (
          <PressableScale key={s.key} accessibilityRole="button" accessibilityLabel={`${s.title}${s.done ? ", done" : ""}`} onPress={() => open(s)} scaleTo={0.985} className="min-h-14 flex-row items-center gap-3 rounded-2xl px-1 py-2">
            <View className={s.done ? "size-8 items-center justify-center rounded-full bg-success" : "size-8 items-center justify-center rounded-full bg-accent"}>
              {s.done ? <Icon name="checkmark" className="text-base text-primary-foreground" /> : <Text className="font-sans-extrabold text-sm text-accent-foreground">{i + 1}</Text>}
            </View>
            <View className="flex-1">
              <Text className={s.done ? "font-sans-semibold text-[15px] text-muted-foreground line-through" : "font-sans-bold text-[15px] text-foreground"}>{s.title}</Text>
              <Text variant="caption" numberOfLines={2}>
                {s.hint}
              </Text>
            </View>
            <Icon name="chevron-forward" className="text-lg text-muted-foreground/70" />
          </PressableScale>
        ))}
      </View>
    </Card>
  );
}
