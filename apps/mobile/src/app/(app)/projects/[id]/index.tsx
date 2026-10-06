import { router, useLocalSearchParams, type Href } from "expo-router";
import { View, Pressable } from "react-native";
import type { Permission, ScheduleSummary } from "@pool/core";
import type { BudgetSummary } from "@pool/core";
import { PROJECT_TYPE_LABELS } from "@pool/types";
import { Icon, type IconName } from "@/components/icon";
import { ProjectStatusBadge } from "@/components/status-badges";
import { Card, ErrorState, KeyValue, LoadingState, ProgressBar, Screen, SectionHeader, StageTimeline, Stat, Text } from "@/components/ui";
import { useApi, useProject, useStages } from "@/features/data";
import { useLayout } from "@/hooks/use-theme";
import { date, money } from "@/lib/format";
import { kv, KV_KEYS } from "@/lib/kv";
import { useSession } from "@/providers/session";
import { useSync } from "@/providers/sync";

interface ProjectDashboard {
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
    <Screen title={p.name} subtitle={`${p.number} · ${PROJECT_TYPE_LABELS[p.type]}`} back onRefresh={() => { void syncNow(); void remote.refetch(); }} refreshing={remote.isFetching}>
      <Card>
        <View className="flex-row items-start justify-between gap-3">
          <View className="flex-1 gap-0.5">
            <Text variant="bodyStrong">{p.clientName}</Text>
            <Text variant="caption">{p.propertyAddress}</Text>
            {p.projectManagerName || p.projectManagerId ? <Text variant="caption">PM: {p.projectManagerName ?? "Assigned"}</Text> : null}
          </View>
          <ProjectStatusBadge status={p.status} />
        </View>
        <View className="mt-4">
          <ProgressBar value={p.completionPct} showValue label="Overall completion" tone={behind ? "warning" : "primary"} />
        </View>
      </Card>

      <View className="mt-4 flex-row flex-wrap gap-3">
        {f && can("budget:read") ? (
          <>
            <Stat label="Contract" value={money(f.revenueCents)} hint={f.changeOrderRevenueCents ? `incl. ${money(f.changeOrderRevenueCents)} COs` : undefined} />
            <Stat label="Actual cost" value={money(f.actualCostCents)} hint={`of ${money(f.totalBudgetCents)} budget`} tone={f.actualCostCents > f.totalBudgetCents ? "danger" : "default"} />
            <Stat label="Remaining" value={money(f.remainingBudgetCents)} tone={f.remainingBudgetCents < 0 ? "danger" : "success"} />
            <Stat label="Projected margin" value={f.projectedMarginPct === null ? "—" : `${f.projectedMarginPct}%`} hint={money(f.projectedProfitCents)} tone={(f.projectedMarginPct ?? 0) < 10 ? "warning" : "success"} />
          </>
        ) : null}
        {t ? (
          <>
            <Stat label="Tasks done" value={`${t.done}/${t.total}`} />
            <Stat label="Overdue / blocked" value={`${t.overdue} / ${t.blocked}`} tone={t.overdue || t.blocked ? "danger" : "success"} />
          </>
        ) : null}
      </View>

      <SectionHeader title="Schedule" onPress={() => go("schedule")} actionLabel="Details" />
      <Card className="gap-0.5">
        <KeyValue label="Planned start" value={date(p.plannedStartDate)} />
        <KeyValue label="Planned completion" value={date(p.plannedCompletionDate)} />
        <KeyValue label="Projected completion" value={date(p.projectedCompletionDate)} emphasize />
        <KeyValue label="Days remaining" value={s?.daysRemaining === null || s?.daysRemaining === undefined ? "—" : String(s.daysRemaining)} />
        <KeyValue label="Schedule variance" value={s?.scheduleVarianceDays ? `${s.scheduleVarianceDays > 0 ? "+" : ""}${s.scheduleVarianceDays} days` : behind ? "Behind" : "On track"} />
      </Card>

      <SectionHeader title="Construction progress" />
      <Card>{stages.data?.length ? <StageTimeline stages={stages.data} /> : <Text variant="caption">No stages yet.</Text>}</Card>

      <SectionHeader title="Project workspace" />
      <View className="flex-row flex-wrap gap-3">
        {SECTIONS.filter((x) => !x.permission || can(x.permission)).map((x) => (
          <Pressable
            key={x.key}
            accessibilityRole="button"
            accessibilityLabel={x.title}
            onPress={() => go(x.key)}
            style={{ width: columns === 1 ? "47.5%" : columns === 2 ? "31.5%" : "23.5%" }}
            className="min-h-24 items-start justify-between rounded-2xl border border-border bg-card p-4 active:bg-muted"
          >
            <Icon name={x.icon} className="text-2xl text-primary" />
            <Text variant="bodyStrong">{x.title}</Text>
          </Pressable>
        ))}
      </View>
    </Screen>
  );
}
