import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { ApiError } from "@pool/api-client";
import { SEVERITIES, SEVERITY_LABELS, type Recommendation } from "@pool/types";
import { BriefingCard, ReadinessBadge, ReadinessChecklist, RecommendationRow } from "@/components/intelligence";
import { Card, Chips, EmptyState, ErrorState, HeroCard, HeroStat, LoadingState, QuickAction, Reveal, Screen, SectionHeader, Text } from "@/components/ui";
import { useProject } from "@/features/data";
import { useIntelMutation, useProjectIntelligence } from "@/features/intelligence";
import { api } from "@/lib/api";
import { fromNow, shortDate } from "@/lib/format";
import { useSession } from "@/providers/session";

type Tab = "briefing" | "readiness" | "alerts";

/** Project intelligence: briefing, next-milestone readiness and open recommendations. */
export default function ProjectIntelligence() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { can } = useSession();
  const project = useProject(id);
  const intel = useProjectIntelligence(id);
  const [tab, setTab] = useState<Tab>("briefing");
  const analyze = useIntelMutation(() => api.post<{ briefingQueued: boolean }>(`/projects/${id}/intelligence/analyze`));
  const data = intel.data;

  if (intel.isLoading) return <Screen title="Intelligence" back><LoadingState /></Screen>;
  if (!data) {
    const message = intel.error instanceof ApiError ? intel.error.message : "Project intelligence needs a connection.";
    return <Screen title="Intelligence" back><ErrorState message={message} onRetry={() => void intel.refetch()} /></Screen>;
  }
  const next = data.readiness.nextMilestone;
  const active = data.recommendations.filter((r) => r.status !== "snoozed");
  const bySeverity = (s: Recommendation["severity"]) => active.filter((r) => r.severity === s);

  return (
    <Screen kicker={project.data?.number ?? "Project"} title="Intelligence" subtitle={project.data?.name} back onRefresh={() => void intel.refetch()} refreshing={intel.isFetching}>
      <Reveal index={0}>
        <HeroCard
          kicker={next ? `Next milestone · ${next.stageName}` : "Project readiness"}
          title={next ? `${next.label === "ready" ? "Ready" : next.label === "blocked" ? "Blocked" : "At risk"}${next.plannedStartDate ? ` for ${shortDate(next.plannedStartDate)}` : ""}` : "No upcoming stage"}
          subtitle={data.readiness.explanation.join(" · ")}
        >
          <View className="hero-divider" />
          <View className="flex-row gap-3">
            <HeroStat value={String(data.readiness.score)} label="Readiness" tone={data.readiness.label === "blocked" ? "danger" : data.readiness.label === "at_risk" ? "warning" : "success"} />
            <HeroStat value={String(data.counts.critical)} label="Critical" tone={data.counts.critical ? "danger" : undefined} />
            <HeroStat value={String(data.counts.high)} label="High" tone={data.counts.high ? "warning" : undefined} />
            <HeroStat value={String(data.counts.medium + data.counts.low)} label="Other" />
          </View>
        </HeroCard>
      </Reveal>

      <Reveal index={1} className="mt-3 flex-row flex-wrap gap-3">
        {can("ai:use") ? <QuickAction icon="chatbubble-ellipses-outline" label="Ask" hint="Are we ready?" onPress={() => router.push(`/projects/${id}/assistant`)} /> : null}
        <QuickAction icon="mail-outline" label="Messages" hint="Drafts to review" tone="accent" onPress={() => router.push(`/projects/${id}/communications`)} />
        {can("intelligence:manage") ? (
          <QuickAction icon="refresh" label={analyze.isPending ? "Analyzing…" : "Analyze now"} hint={data.lastEvaluatedAt ? `Checked ${fromNow(data.lastEvaluatedAt)}` : "Re-check every rule"} onPress={() => analyze.mutate(undefined)} />
        ) : null}
        <QuickAction icon="pulse-outline" label="All alerts" hint="Every project" onPress={() => router.push({ pathname: "/alerts", params: { projectId: id } })} />
      </Reveal>
      {analyze.data?.briefingQueued ? <Text variant="caption" className="mt-2">The AI briefing is being written; it appears here in a minute.</Text> : null}
      {analyze.error ? <Text className="mt-2 text-sm text-destructive">{analyze.error instanceof ApiError ? analyze.error.message : "Couldn't analyze right now."}</Text> : null}

      <Reveal index={2} className="mt-4">
        <Chips
          value={tab}
          onChange={setTab}
          options={[
            { value: "briefing", label: "Briefing" },
            { value: "readiness", label: next ? `Readiness · ${next.stageName}` : "Readiness" },
            { value: "alerts", label: `Alerts (${active.length})` },
          ]}
        />
      </Reveal>

      {tab === "briefing" ? (
        <Reveal index={3} className="mt-3 gap-3">
          <BriefingCard briefing={data.briefing} projectId={id} readiness={next} />
          {data.agentProvider === "none" ? <Text variant="caption">Briefings come from your project rules. An administrator can turn on AI narratives.</Text> : null}
          {data.briefing.upcomingMilestones.length ? (
            <>
              <SectionHeader kicker="Next up" title="Milestones" onPress={() => router.push(`/projects/${id}/schedule`)} actionLabel="Schedule" />
              <Card className="gap-2">
                {data.briefing.upcomingMilestones.map((m) => (
                  <View key={m.stageId} className="flex-row items-center justify-between gap-2">
                    <Text className="flex-1 text-sm text-foreground">{m.name}</Text>
                    <Text variant="caption">{m.plannedStartDate ? shortDate(m.plannedStartDate) : "Not dated"}</Text>
                    {m.readiness ? <ReadinessBadge label={m.readiness} /> : null}
                  </View>
                ))}
              </Card>
            </>
          ) : null}
          {data.briefing.upcomingDeadlines.length ? (
            <>
              <SectionHeader kicker="This week" title="Deadlines" />
              <Card className="gap-2">
                {data.briefing.upcomingDeadlines.map((d) => (
                  <View key={`${d.type}:${d.id}`} className="flex-row items-center gap-2">
                    <Text variant="mono" className="w-16">{shortDate(d.date)}</Text>
                    <Text className="flex-1 text-sm text-foreground" numberOfLines={2}>{d.label}</Text>
                  </View>
                ))}
              </Card>
            </>
          ) : null}
          {data.briefing.approvalsNeeded.length ? (
            <>
              <SectionHeader kicker="Your decision" title="Needs approval" />
              <Card className="gap-2">
                {data.briefing.approvalsNeeded.map((a) => (
                  <Text key={a.id} className="text-sm text-foreground">• {a.label}</Text>
                ))}
              </Card>
            </>
          ) : null}
          {data.briefing.recentChanges.length ? (
            <>
              <SectionHeader kicker="Since last time" title="Recent changes" onPress={() => router.push(`/projects/${id}/activity`)} actionLabel="Activity" />
              <Card className="gap-1.5">
                {data.briefing.recentChanges.slice(0, 6).map((c) => (
                  <Text key={c.id} className="text-sm text-foreground" numberOfLines={2}>
                    {c.summary} <Text variant="caption">· {fromNow(c.createdAt)}</Text>
                  </Text>
                ))}
              </Card>
            </>
          ) : null}
        </Reveal>
      ) : null}

      {tab === "readiness" ? (
        <Reveal index={3} className="mt-3">
          {next ? <ReadinessChecklist readiness={next} projectId={id} /> : <EmptyState icon="flag-outline" title="No upcoming stage" message="Every stage has started or finished. Closeout items show under Alerts." />}
        </Reveal>
      ) : null}

      {tab === "alerts" ? (
        <Reveal index={3} className="mt-3 gap-3">
          {active.length ? (
            SEVERITIES.filter((s) => bySeverity(s).length).map((s) => (
              <View key={s}>
                <SectionHeader title={SEVERITY_LABELS[s]} kicker={`${bySeverity(s).length} open`} />
                <Card className="py-1">
                  {bySeverity(s).map((r) => (
                    <RecommendationRow key={r.id} rec={r} />
                  ))}
                </Card>
              </View>
            ))
          ) : (
            <EmptyState icon="checkmark-done-outline" title="No open alerts" message="Every rule passes for this project right now." />
          )}
        </Reveal>
      ) : null}
    </Screen>
  );
}
