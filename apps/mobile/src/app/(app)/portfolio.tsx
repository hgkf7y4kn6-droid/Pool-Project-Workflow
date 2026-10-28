import { router } from "expo-router";
import { View } from "react-native";
import { ApiError } from "@pool/api-client";
import { ReadinessBadge, RecommendationRow } from "@/components/intelligence";
import { Badge, Card, EmptyState, ErrorState, HeroCard, HeroStat, ListItem, LoadingState, QuickAction, Reveal, Screen, SectionHeader, Text } from "@/components/ui";
import { usePortfolio } from "@/features/intelligence";
import { shortDate } from "@/lib/format";

/** Portfolio operations: every active project's readiness and the items management should act on. */
export default function Portfolio() {
  const q = usePortfolio();
  if (q.isLoading) return <Screen title="Operations" back><LoadingState /></Screen>;
  const d = q.data;
  if (!d) return <Screen title="Operations" back><ErrorState message={q.error instanceof ApiError ? q.error.message : "Operations needs a connection."} onRetry={() => void q.refetch()} /></Screen>;
  const t = d.totals;
  return (
    <Screen kicker="Portfolio" title="Operations" back onRefresh={() => void q.refetch()} refreshing={q.isFetching}>
      <Reveal index={0}>
        <HeroCard
          kicker="Across your projects"
          title={t.needsIntervention ? `${t.needsIntervention} project${t.needsIntervention === 1 ? "" : "s"} need${t.needsIntervention === 1 ? "s" : ""} attention` : "Everything is on track"}
          subtitle={`${t.activeProjects} active · ${t.atRiskMilestones} milestone${t.atRiskMilestones === 1 ? "" : "s"} at risk`}
        >
          <View className="hero-divider" />
          <View className="flex-row gap-3">
            <HeroStat value={String(t.overdueDecisions)} label="Decisions" tone={t.overdueDecisions ? "warning" : undefined} />
            <HeroStat value={String(t.materialRisks)} label="Materials" tone={t.materialRisks ? "warning" : undefined} />
            <HeroStat value={String(t.pendingInspections)} label="Gates" tone={t.pendingInspections ? "warning" : undefined} />
            <HeroStat value={String(d.crewConflicts.length)} label="Crews" tone={d.crewConflicts.length ? "danger" : undefined} />
          </View>
        </HeroCard>
      </Reveal>

      <Reveal index={1} className="mt-3 flex-row flex-wrap gap-3">
        <QuickAction icon="pulse-outline" label="Alert center" hint="Everything open" onPress={() => router.push("/alerts")} />
        <QuickAction icon="calendar-outline" label="Schedule" hint="Crews this week" onPress={() => router.push("/schedule")} />
      </Reveal>

      <Reveal index={2}>
        <SectionHeader kicker="Act now" title="Critical & high" onPress={() => router.push("/alerts")} />
        {d.attention.length ? (
          <Card className="py-1">
            {d.attention.slice(0, 10).map((r) => (
              <RecommendationRow key={r.id} rec={r} showProject />
            ))}
          </Card>
        ) : (
          <EmptyState icon="shield-checkmark-outline" title="No critical or high items" message="The rules found nothing urgent across your projects." />
        )}
      </Reveal>

      {d.crewConflicts.length ? (
        <Reveal index={3}>
          <SectionHeader kicker="Shared resources" title="Crew & subcontractor conflicts" />
          <Card className="gap-3">
            {d.crewConflicts.map((c) => (
              <View key={`${c.resource}:${c.date}`} className="gap-1">
                <Text variant="bodyStrong">
                  {c.resourceName} · {shortDate(c.date)}
                </Text>
                {c.tasks.map((task) => (
                  <Text key={task.id} className="text-sm text-foreground" onPress={() => router.push(`/tasks/${task.id}`)} accessibilityRole="link">
                    • {task.title} — {task.projectName}
                  </Text>
                ))}
              </View>
            ))}
          </Card>
        </Reveal>
      ) : null}

      <Reveal index={4}>
        <SectionHeader kicker="Readiness" title="Projects" />
        <Card className="py-1">
          {d.projects.map((p) => (
            <ListItem
              key={p.projectId}
              title={p.name}
              subtitle={[p.nextMilestone ? `Next: ${p.nextMilestone}` : null, p.oldestOpenHighDays ? `oldest urgent item ${p.oldestOpenHighDays}d` : null].filter(Boolean).join(" · ") || p.number}
              icon={p.needsIntervention ? "flag" : "water-outline"}
              iconTone={p.needsIntervention ? "danger" : "primary"}
              right={
                <View className="items-end gap-1">
                  {p.readiness ? <ReadinessBadge label={p.readiness} /> : null}
                  {p.counts.critical || p.counts.high ? <Badge label={`${p.counts.critical + p.counts.high} urgent`} tone={p.counts.critical ? "danger" : "warning"} size="sm" /> : null}
                </View>
              }
              onPress={() => router.push(`/projects/${p.projectId}/intelligence`)}
            />
          ))}
        </Card>
      </Reveal>
    </Screen>
  );
}
