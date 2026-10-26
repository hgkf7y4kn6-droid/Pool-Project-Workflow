import { router, useLocalSearchParams, type Href } from "expo-router";
import { View } from "react-native";
import type { BudgetSummary, Permission, ScheduleSummary } from "@pool/core";
import { PROJECT_STATUS_LABELS, PROJECT_TYPE_LABELS } from "@pool/types";
import { Icon, type IconName } from "@/components/icon";
import {
  Card,
  ErrorState,
  HeroCard,
  HeroStat,
  KeyValue,
  LoadingState,
  PressableScale,
  ProgressRing,
  QuickAction,
  Reveal,
  Screen,
  SectionHeader,
  StageTimeline,
  Stat,
  Text,
} from "@/components/ui";
import { useApi, useProject, useStages } from "@/features/data";
import { useLayout, useTheme } from "@/hooks/use-theme";
import { date, money, shortDate } from "@/lib/format";
import { kv, KV_KEYS } from "@/lib/kv";
import { useSession } from "@/providers/session";
import { useSync } from "@/providers/sync";

interface ProjectDashboard {
  project: { projectManagerName: string | null };
  financial: BudgetSummary | null;
  schedule: ScheduleSummary;
  tasks: { total: number; done: number; overdue: number; today: number; blocked: number } | null;
  pendingApprovals: number;
  pendingChangeOrders: number;
}

const SECTIONS: { key: string; title: string; icon: IconName; permission?: Permission; internal?: boolean }[] = [
  { key: "tasks", title: "Tasks", icon: "checkbox-outline", permission: "task:read" },
  { key: "schedule", title: "Schedule", icon: "git-network-outline", permission: "task:read" },
  { key: "photos", title: "Photos", icon: "images-outline", permission: "photo:read" },
  { key: "measurements", title: "Measurements", icon: "resize-outline", permission: "measurement:read" },
  { key: "inspections", title: "Inspections", icon: "shield-checkmark-outline", permission: "inspection:read" },
  { key: "budget", title: "Budget", icon: "wallet-outline", permission: "budget:read" },
  { key: "labor", title: "Labor", icon: "time-outline", permission: "labor:create_own" },
  { key: "materials", title: "Materials", icon: "cube-outline", permission: "material:read" },
  { key: "change-orders", title: "Change orders", icon: "swap-horizontal-outline", permission: "change_order:read" },
  { key: "payments", title: "Payments", icon: "card-outline", permission: "payment:read" },
  { key: "documents", title: "Documents", icon: "document-text-outline", permission: "document:read" },
  { key: "design", title: "Design & 3D", icon: "cube", permission: "design:read" },
  { key: "messages", title: "Messages", icon: "chatbubbles-outline", permission: "message:read" },
  { key: "property", title: "Property & client", icon: "home-outline", permission: "property:read" },
  { key: "approvals", title: "Approvals", icon: "create-outline", permission: "approval:read" },
  { key: "assistant", title: "AI assistant", icon: "sparkles-outline", permission: "ai:use" },
  { key: "activity", title: "Activity", icon: "pulse-outline", permission: "activity:read" },
];

export default function ProjectDashboardScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { can } = useSession();
  const { syncNow } = useSync();
  const { columns } = useLayout();
  const { colors } = useTheme();
  const project = useProject(id);
  const stages = useStages(id);
  const remote = useApi<ProjectDashboard>(["project-dashboard", id], `/projects/${id}/dashboard`);
  kv.set(KV_KEYS.lastProjectId, id);

  if (project.loading) return <Screen title="Project" back><LoadingState /></Screen>;
  const p = project.data;
  if (!p) return <Screen title="Project" back><ErrorState message="This project is not on your device. Pull to refresh or check your access." onRetry={() => void syncNow()} /></Screen>;
  const f = remote.data?.financial;
  const s = remote.data?.schedule;
  const t = remote.data?.tasks;
  const behind = p.projectedCompletionDate && p.plannedCompletionDate && p.projectedCompletionDate > p.plannedCompletionDate;

  const go = (key: string) => {
    if (key === "approvals") router.push({ pathname: "/approvals", params: { projectId: p.id } });
    else router.push(`/projects/${p.id}/${key}` as Href);
  };

  return (
    <Screen
      kicker={`${p.number} · ${PROJECT_TYPE_LABELS[p.type]}`}
      title={p.name}
      back
      onRefresh={() => {
        void syncNow();
        void remote.refetch();
      }}
      refreshing={remote.isFetching}
    >
      <Reveal index={0}>
        <HeroCard
          kicker={`${PROJECT_STATUS_LABELS[p.status]} · ${behind ? `Behind${s?.scheduleVarianceDays ? ` ${s.scheduleVarianceDays} days` : ""}` : "On track"}`}
          title={p.clientName ?? "Client"}
          subtitle={[p.propertyAddress, p.projectManagerId ? `PM ${remote.data?.project.projectManagerName ?? p.projectManagerName ?? ""}`.trim() : null].filter(Boolean).join(" · ")}
          right={
            <ProgressRing value={p.completionPct} size={76} stroke={8} color={behind ? colors.accent : colors.glow} track="rgba(255,255,255,0.14)" label="Overall completion">
              <Text className="font-display text-lg text-hero-foreground">{Math.round(p.completionPct)}%</Text>
            </ProgressRing>
          }
        >
          <View className="hero-divider" />
          <View className="flex-row gap-3">
            <HeroStat value={p.projectedCompletionDate ? shortDate(p.projectedCompletionDate) : "—"} label="Finish" tone={behind ? "warning" : undefined} />
            <HeroStat value={s?.daysRemaining === null || s?.daysRemaining === undefined ? "—" : String(s.daysRemaining)} label="Days left" />
            {t ? <HeroStat value={`${t.done}/${t.total}`} label="Tasks" /> : null}
            {t ? <HeroStat value={String(t.overdue + t.blocked)} label="Issues" tone={t.overdue || t.blocked ? "danger" : undefined} /> : null}
          </View>
        </HeroCard>
      </Reveal>

      <Reveal index={1} className="mt-3 flex-row flex-wrap gap-3">
        <QuickAction icon="checkbox-outline" label="Tasks" hint={t ? `${t.today} today` : "Checklists & status"} onPress={() => go("tasks")} />
        {can("photo:create") ? <QuickAction icon="camera-outline" label="Photo" hint="Tagged to this job" tone="accent" onPress={() => router.push({ pathname: "/camera", params: { projectId: p.id } })} /> : null}
        <QuickAction icon="git-network-outline" label="Schedule" hint="Stages & timing" onPress={() => go("schedule")} />
        {can("message:read") ? <QuickAction icon="chatbubbles-outline" label="Messages" hint="Team & client" onPress={() => go("messages")} /> : null}
      </Reveal>

      {f && can("budget:read") ? (
        <Reveal index={2}>
          <SectionHeader kicker="Money" title="Budget" onPress={() => go("budget")} actionLabel="Details" />
          <View className="flex-row flex-wrap gap-3">
            <Stat label="Contract" value={money(f.revenueCents)} hint={f.changeOrderRevenueCents ? `incl. ${money(f.changeOrderRevenueCents)} COs` : undefined} />
            <Stat label="Actual cost" value={money(f.actualCostCents)} hint={`of ${money(f.totalBudgetCents)} budget`} tone={f.actualCostCents > f.totalBudgetCents ? "danger" : "default"} />
            <Stat label="Remaining" value={money(f.remainingBudgetCents)} tone={f.remainingBudgetCents < 0 ? "danger" : "success"} />
            <Stat label="Margin" value={f.projectedMarginPct === null ? "—" : `${f.projectedMarginPct}%`} hint={`${money(f.projectedProfitCents)} projected profit`} tone={(f.projectedMarginPct ?? 0) < 10 ? "warning" : "success"} />
          </View>
        </Reveal>
      ) : null}

      <SectionHeader kicker="Timing" title="Schedule" onPress={() => go("schedule")} actionLabel="Details" />
      <Card className="gap-0.5">
        <KeyValue label="Planned start" value={date(p.plannedStartDate)} />
        <KeyValue label="Planned completion" value={date(p.plannedCompletionDate)} />
        <KeyValue label="Projected completion" value={date(p.projectedCompletionDate)} emphasize />
        <KeyValue label="Days remaining" value={s?.daysRemaining === null || s?.daysRemaining === undefined ? "—" : String(s.daysRemaining)} />
        <KeyValue label="Schedule variance" value={s?.scheduleVarianceDays ? `${s.scheduleVarianceDays > 0 ? "+" : ""}${s.scheduleVarianceDays} days` : behind ? "Behind" : "On track"} />
      </Card>

      <SectionHeader kicker="Stages" title="Construction progress" />
      <Card>{stages.data?.length ? <StageTimeline stages={stages.data} /> : <Text variant="caption">No stages yet.</Text>}</Card>

      <SectionHeader kicker="Everything for this job" title="Project workspace" />
      <View className="flex-row flex-wrap gap-3">
        {SECTIONS.filter((x) => !x.permission || can(x.permission)).map((x) => (
          <PressableScale
            key={x.key}
            accessibilityRole="button"
            accessibilityLabel={x.title}
            onPress={() => go(x.key)}
            style={{ width: columns === 1 ? "47.5%" : columns === 2 ? "31.5%" : "23.5%" }}
            className="min-h-28 justify-between gap-3 rounded-3xl border border-border bg-card p-4"
          >
            <View className="icon-tile">
              <Icon name={x.icon} className="text-xl text-primary" />
            </View>
            <Text className="font-sans-bold text-[15px] text-foreground">{x.title}</Text>
          </PressableScale>
        ))}
      </View>
    </Screen>
  );
}
