import { router } from "expo-router";
import { View } from "react-native";
import type { Approval, ChangeOrder } from "@pool/types";
import { Icon } from "@/components/icon";
import { PriorityBadge, ProjectStatusBadge, TaskStatusBadge } from "@/components/status-badges";
import {
  ActivityFeed,
  Avatar,
  Badge,
  Card,
  EmptyState,
  ListItem,
  OfflineBanner,
  PhotoGrid,
  ProgressBar,
  Screen,
  SectionHeader,
  StageTimeline,
  Stat,
  Text,
} from "@/components/ui";
import { useActivity, useApi, usePhotos, useProjects, useStages, useTasks } from "@/features/data";
import { useLayout } from "@/hooks/use-theme";
import { date, money, shortDate } from "@/lib/format";
import { useSession, useUser } from "@/providers/session";
import { useSync } from "@/providers/sync";

interface DashboardResponse {
  counts: { activeProjects: number; tasksToday: number; overdueTasks: number; pendingApprovals: number; pendingChangeOrders: number; behindSchedule: number; weatherAlerts: number };
  outstandingApprovals: Pick<Approval, "id" | "title" | "projectId" | "dueDate">[];
  pendingChangeOrders: (ChangeOrder & { availableTransitions: string[] })[];
  budgetAlerts: { projectId: string; projectName: string; level: string; message: string }[];
  weatherAlerts: { id: string; projectId: string; projectName: string; taskTitle: string | null; forDate: string; severity: string; message: string }[];
}

export default function Dashboard() {
  const user = useUser();
  return user.role === "client" ? <ClientHome /> : <CompanyDashboard />;
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

function CompanyDashboard() {
  const user = useUser();
  const { can } = useSession();
  const { syncNow } = useSync();
  const { isTablet } = useLayout();
  const mine = user.role === "field_worker" || user.role === "subcontractor" ? user.id : undefined;
  const today = useTasks({ due: "today", assigneeId: mine });
  const overdue = useTasks({ due: "overdue", assigneeId: mine });
  const upcoming = useTasks({ due: "upcoming", assigneeId: mine });
  const projects = useProjects("active");
  const allProjects = useProjects("all");
  const activity = useActivity(undefined, 12);
  const photos = usePhotos({ limit: 9 });
  const remote = useApi<DashboardResponse>(["dashboard"], "/dashboard");
  const d = remote.data;

  return (
    <Screen title={`${greeting()}, ${user.fullName.split(" ")[0]}`} subtitle={new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })} onRefresh={() => { void syncNow(); void remote.refetch(); }} refreshing={remote.isFetching}>
      <OfflineBanner />

      <View className="flex-row flex-wrap gap-3">
        <Stat label="Active projects" value={String(projects.data?.length ?? "–")} hint={d ? `${d.counts.behindSchedule} behind schedule` : undefined} tone={d && d.counts.behindSchedule ? "warning" : "default"} />
        <Stat label="Today" value={String(today.data?.length ?? "–")} hint="scheduled tasks" />
        <Stat label="Overdue" value={String(overdue.data?.length ?? "–")} tone={overdue.data?.length ? "danger" : "success"} />
        <Stat label="Approvals" value={d ? String(d.counts.pendingApprovals) : "–"} hint={d ? `${d.counts.pendingChangeOrders} change orders pending` : "needs connection"} tone={d?.counts.pendingApprovals ? "warning" : "default"} />
      </View>

      {d?.weatherAlerts.length ? (
        <>
          <SectionHeader title="Weather alerts" />
          <View className="gap-2">
            {d.weatherAlerts.slice(0, 4).map((w) => (
              <Card key={w.id} onPress={() => router.push(`/projects/${w.projectId}/schedule`)} className="flex-row items-start gap-3 border-warning bg-warning-soft">
                <Icon name="rainy" className="text-2xl text-warning" />
                <View className="flex-1">
                  <Text variant="bodyStrong">{w.projectName}</Text>
                  <Text className="text-sm">{w.message}</Text>
                  <Text variant="caption">Review the schedule before changing anything — nothing is moved automatically.</Text>
                </View>
              </Card>
            ))}
          </View>
        </>
      ) : null}

      <View className={isTablet ? "flex-row gap-6" : ""}>
        <View className="flex-1">
          <SectionHeader title="Today's schedule" onPress={() => router.push("/schedule")} actionLabel="Calendar" />
          {today.data?.length ? (
            <Card className="py-1">
              {today.data.slice(0, 8).map((t) => (
                <ListItem key={t.id} title={t.title} subtitle={`${allProjects.data?.find((p) => p.id === t.projectId)?.name ?? "Project"} · ${shortDate(t.plannedStartDate)}–${shortDate(t.plannedEndDate)}`} icon={t.weatherSensitive ? "partly-sunny-outline" : "hammer-outline"} right={<TaskStatusBadge status={t.status} />} onPress={() => router.push(`/tasks/${t.id}`)} />
              ))}
            </Card>
          ) : (
            <EmptyState icon="sunny-outline" title="Nothing scheduled today" />
          )}

          {overdue.data?.length ? (
            <>
              <SectionHeader title="Overdue" onPress={() => router.push({ pathname: "/tasks", params: { due: "overdue" } })} />
              <Card className="py-1">
                {overdue.data.slice(0, 6).map((t) => (
                  <ListItem key={t.id} title={t.title} subtitle={`Due ${date(t.dueDate ?? t.plannedEndDate)}`} icon="alarm-outline" iconTone="danger" right={<PriorityBadge priority={t.priority} />} onPress={() => router.push(`/tasks/${t.id}`)} />
                ))}
              </Card>
            </>
          ) : null}

          <SectionHeader title="Coming up" onPress={() => router.push("/tasks")} />
          {upcoming.data?.length ? (
            <Card className="py-1">
              {upcoming.data.slice(0, 5).map((t) => (
                <ListItem key={t.id} title={t.title} subtitle={`Starts ${date(t.plannedStartDate)}`} icon="time-outline" iconTone="muted" onPress={() => router.push(`/tasks/${t.id}`)} />
              ))}
            </Card>
          ) : (
            <Text variant="caption">No upcoming tasks this week.</Text>
          )}
        </View>

        <View className="flex-1">
          <SectionHeader title="Active projects" onPress={() => router.push("/projects")} />
          <View className="gap-3">
            {(projects.data ?? []).slice(0, 5).map((p) => (
              <Card key={p.id} onPress={() => router.push(`/projects/${p.id}`)}>
                <View className="mb-2 flex-row items-start justify-between gap-2">
                  <View className="flex-1">
                    <Text variant="h3" numberOfLines={1}>
                      {p.name}
                    </Text>
                    <Text variant="caption" numberOfLines={1}>
                      {p.clientName} · {p.city}
                    </Text>
                  </View>
                  <ProjectStatusBadge status={p.status} />
                </View>
                <ProgressBar value={p.completionPct} showValue label={p.projectedCompletionDate ? `Projected ${date(p.projectedCompletionDate)}` : "Progress"} tone={p.projectedCompletionDate && p.plannedCompletionDate && p.projectedCompletionDate > p.plannedCompletionDate ? "warning" : "primary"} />
              </Card>
            ))}
            {!projects.loading && !projects.data?.length && <EmptyState icon="construct-outline" title="No active projects" />}
          </View>

          {d && (d.outstandingApprovals.length || d.pendingChangeOrders.length) ? (
            <>
              <SectionHeader title="Waiting on decisions" onPress={() => router.push("/approvals")} />
              <Card className="py-1">
                {d.pendingChangeOrders.slice(0, 4).map((co) => (
                  <ListItem key={co.id} title={`CO #${co.number}: ${co.title}`} subtitle={`${money(co.priceCents)} · ${co.status.replace("_", " ")}`} icon="swap-horizontal" iconTone="warning" onPress={() => router.push(`/change-orders/${co.id}`)} />
                ))}
                {d.outstandingApprovals.slice(0, 4).map((a) => (
                  <ListItem key={a.id} title={a.title} subtitle={a.dueDate ? `Due ${date(a.dueDate)}` : "Awaiting client"} icon="create-outline" iconTone="warning" onPress={() => router.push("/approvals")} />
                ))}
              </Card>
            </>
          ) : null}

          {can("budget:read") && d?.budgetAlerts.length ? (
            <>
              <SectionHeader title="Budget alerts" />
              <View className="gap-2">
                {d.budgetAlerts.slice(0, 5).map((a, i) => (
                  <Card key={i} onPress={() => router.push(`/projects/${a.projectId}/budget`)} className="flex-row items-center gap-3">
                    <Icon name="trending-up" className={a.level === "critical" ? "text-2xl text-destructive" : "text-2xl text-warning"} />
                    <View className="flex-1">
                      <Text variant="bodyStrong">{a.projectName}</Text>
                      <Text variant="caption">{a.message}</Text>
                    </View>
                  </Card>
                ))}
              </View>
            </>
          ) : null}
        </View>
      </View>

      {photos.data?.length ? (
        <>
          <SectionHeader title="Recent photos" />
          <PhotoGrid photos={photos.data} columns={isTablet ? 6 : 3} />
        </>
      ) : null}

      <SectionHeader title="Recent activity" />
      <Card>{activity.data?.length ? <ActivityFeed items={activity.data} /> : <Text variant="caption">No activity yet.</Text>}</Card>
    </Screen>
  );
}

/** Client portal home: progress, timeline, photos, decisions — no internal data. */
function ClientHome() {
  const user = useUser();
  const { syncNow } = useSync();
  const projects = useProjects("all");
  const project = projects.data?.[0];
  const stages = useStages(project?.id);
  const photos = usePhotos({ projectId: project?.id, limit: 12 });
  const activity = useActivity(project?.id, 10);
  const approvals = useApi<Approval[]>(["approvals", "pending"], "/approvals", { status: "pending" });

  if (!projects.loading && !project) {
    return (
      <Screen title={`Hi, ${user.fullName.split(" ")[0]}`}>
        <EmptyState icon="water-outline" title="Your project will appear here" message="Your project manager will share it with you soon." />
      </Screen>
    );
  }
  const current = stages.data?.find((s) => s.status === "in_progress");
  const next = stages.data?.find((s) => s.status === "not_started");
  return (
    <Screen title={`Hi, ${user.fullName.split(" ")[0]}`} subtitle={project?.name} onRefresh={() => void syncNow()}>
      {project && (
        <Card>
          <View className="flex-row items-center gap-3">
            <Avatar name={project.name} size={48} />
            <View className="flex-1">
              <Text variant="h2">{project.name}</Text>
              <Text variant="caption">{project.propertyAddress}</Text>
            </View>
          </View>
          <View className="mt-4">
            <ProgressBar value={project.completionPct} showValue label="Overall progress" />
          </View>
          <View className="mt-3 flex-row flex-wrap gap-2">
            {current && <Badge label={`Now: ${current.name}`} tone="primary" icon="hammer" />}
            {next && <Badge label={`Next: ${next.name}`} tone="neutral" />}
            {project.projectedCompletionDate && <Badge label={`Est. completion ${date(project.projectedCompletionDate)}`} tone="info" icon="flag" />}
          </View>
        </Card>
      )}

      {approvals.data?.length ? (
        <>
          <SectionHeader title="Needs your approval" onPress={() => router.push("/approvals")} />
          <Card className="border-warning py-1">
            {approvals.data.map((a) => (
              <ListItem key={a.id} title={a.title} subtitle={a.dueDate ? `Please respond by ${date(a.dueDate)}` : "Tap to review"} icon="create-outline" iconTone="warning" onPress={() => router.push("/approvals")} />
            ))}
          </Card>
        </>
      ) : null}

      <SectionHeader title="Progress photos" onPress={project ? () => router.push(`/projects/${project.id}/photos`) : undefined} />
      {photos.data?.length ? <PhotoGrid photos={photos.data} /> : <Text variant="caption">Photos from the crew will appear here.</Text>}

      <SectionHeader title="Timeline" />
      <Card>{stages.data?.length ? <StageTimeline stages={stages.data} /> : <Text variant="caption">Timeline coming soon.</Text>}</Card>

      <SectionHeader title="Latest updates" />
      <Card>{activity.data?.length ? <ActivityFeed items={activity.data} /> : <Text variant="caption">No updates yet.</Text>}</Card>
    </Screen>
  );
}
