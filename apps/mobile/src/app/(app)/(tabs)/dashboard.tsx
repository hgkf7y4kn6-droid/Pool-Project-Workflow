import { router } from "expo-router";
import { View } from "react-native";
import type { Approval, ChangeOrder } from "@pool/types";
import { Icon } from "@/components/icon";
import { StartHereCard } from "@/components/onboarding/start-here";
import { PriorityBadge, ProjectStatusBadge, TaskStatusBadge } from "@/components/status-badges";
import {
  ActivityFeed,
  Card,
  EmptyState,
  HeroCard,
  HeroStat,
  ListItem,
  OfflineBanner,
  PhotoGrid,
  ProgressBar,
  ProgressRing,
  QuickAction,
  Reveal,
  Screen,
  SectionHeader,
  StageTimeline,
  Text,
} from "@/components/ui";
import { useActivity, useApi, usePhotos, useProjects, useStages, useTasks } from "@/features/data";
import { useLayout, useTheme } from "@/hooks/use-theme";
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

const todayKicker = () => new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

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
  const todayProjects = new Set((today.data ?? []).map((t) => t.projectId)).size;
  const blocked = (today.data ?? []).filter((t) => t.status === "blocked").length;

  return (
    <Screen
      kicker={todayKicker()}
      title={`${greeting()}, ${user.fullName.split(" ")[0]}`}
      onRefresh={() => {
        void syncNow();
        void remote.refetch();
      }}
      refreshing={remote.isFetching}
    >
      <OfflineBanner />

      <Reveal index={0}>
        <HeroCard
          kicker="Today on site"
          title={todayHeadline(today.data?.length, todayProjects)}
          subtitle={attentionLine(overdue.data?.length ?? 0, blocked, d?.counts.behindSchedule ?? 0)}
          onPress={() => router.push({ pathname: "/tasks", params: { due: "today" } })}
        >
          <View className="hero-divider" />
          <View className="flex-row gap-3">
            <HeroStat value={String(projects.data?.length ?? "–")} label="Active jobs" />
            <HeroStat value={String(overdue.data?.length ?? "–")} label="Overdue" tone={overdue.data?.length ? "danger" : undefined} />
            <HeroStat value={d ? String(d.counts.pendingApprovals) : "–"} label="Approvals" tone={d?.counts.pendingApprovals ? "warning" : undefined} />
            <HeroStat value={d ? String(d.counts.behindSchedule) : "–"} label="Behind" tone={d?.counts.behindSchedule ? "warning" : undefined} />
          </View>
        </HeroCard>
      </Reveal>

      <Reveal index={1} className="mt-3 flex-row flex-wrap gap-3">
        <QuickAction icon="checkbox-outline" label="My tasks" hint={today.data?.length ? `${today.data.length} today` : "Nothing due today"} onPress={() => router.push({ pathname: "/tasks", params: { due: "today" } })} />
        <QuickAction icon="calendar-outline" label="Schedule" hint="Plan the week" onPress={() => router.push("/schedule")} />
        {can("project:create") ? (
          <QuickAction icon="add" label="New project" hint="Client, site & plan" tone="accent" onPress={() => router.push("/projects/new")} />
        ) : (
          <QuickAction icon="cloud-upload-outline" label="Sync & offline" hint="What's saved on this device" onPress={() => router.push("/offline-queue")} />
        )}
        <QuickAction icon="search-outline" label="Search" hint="Jobs, tasks, clients" onPress={() => router.push("/search")} />
      </Reveal>

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

      <Reveal index={2}>
        <StartHereCard />
      </Reveal>

      <Reveal index={3} className={isTablet ? "flex-row gap-6" : ""}>
        <View className="flex-1">
          <SectionHeader kicker="Crew plan" title="Today's schedule" onPress={() => router.push("/schedule")} actionLabel="Calendar" />
          {today.data?.length ? (
            <Card className="py-1">
              {today.data.slice(0, 8).map((t) => (
                <ListItem key={t.id} title={t.title} subtitle={`${allProjects.data?.find((p) => p.id === t.projectId)?.name ?? "Project"} · ${shortDate(t.plannedStartDate)}–${shortDate(t.plannedEndDate)}`} icon={t.weatherSensitive ? "partly-sunny-outline" : "hammer-outline"} right={<TaskStatusBadge status={t.status} />} onPress={() => router.push(`/tasks/${t.id}`)} />
              ))}
            </Card>
          ) : (
            <EmptyState icon="sunny-outline" title="Nothing scheduled today" message="Enjoy the breather — or pull work forward from Coming up." />
          )}

          {overdue.data?.length ? (
            <>
              <SectionHeader kicker="Catch up" title="Overdue" onPress={() => router.push({ pathname: "/tasks", params: { due: "overdue" } })} />
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
          <SectionHeader kicker="Portfolio" title="Active projects" onPress={() => router.push("/projects")} />
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
                <ProgressBar value={p.completionPct} showValue label={p.projectedCompletionDate ? `Finish ${date(p.projectedCompletionDate)}` : "Progress"} tone={p.projectedCompletionDate && p.plannedCompletionDate && p.projectedCompletionDate > p.plannedCompletionDate ? "warning" : "primary"} />
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
      </Reveal>

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

function todayHeadline(count: number | undefined, projects: number) {
  if (count === undefined) return "Loading your day…";
  if (count === 0) return "A clear day on site";
  return `${count} ${count === 1 ? "task" : "tasks"} across ${projects} ${projects === 1 ? "job" : "jobs"}`;
}

function attentionLine(overdue: number, blocked: number, behind: number) {
  const parts = [overdue && `${overdue} overdue`, blocked && `${blocked} blocked`, behind && `${behind} ${behind === 1 ? "job" : "jobs"} behind schedule`].filter(Boolean);
  return parts.length ? `Needs attention: ${parts.join(" · ")}` : "Everything is on track.";
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
  const { colors } = useTheme();

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
    <Screen kicker="Your pool build" title={`Hi, ${user.fullName.split(" ")[0]}`} onRefresh={() => void syncNow()}>
      {project && (
        <Reveal index={0}>
          <HeroCard
            kicker={current ? `Now: ${current.name}` : "Project"}
            title={project.name}
            subtitle={project.propertyAddress}
            right={
              <ProgressRing value={project.completionPct} size={76} stroke={8} color={colors.glow} track="rgba(255,255,255,0.14)" label="Overall progress">
                <Text className="font-display text-lg text-hero-foreground">{Math.round(project.completionPct)}%</Text>
              </ProgressRing>
            }
          >
            <View className="hero-divider" />
            <View className="flex-row gap-3">
              <HeroStat value={next ? next.name : "—"} label="Up next" />
              <HeroStat value={project.projectedCompletionDate ? shortDate(project.projectedCompletionDate) : "TBD"} label="Est. finish" />
            </View>
          </HeroCard>
        </Reveal>
      )}

      {approvals.data?.length ? (
        <>
          <SectionHeader kicker="Action needed" title="Needs your approval" onPress={() => router.push("/approvals")} />
          <Card className="border-accent bg-warning-soft py-1">
            {approvals.data.map((a) => (
              <ListItem key={a.id} title={a.title} subtitle={a.dueDate ? `Please respond by ${date(a.dueDate)}` : "Tap to review"} icon="create-outline" iconTone="warning" onPress={() => router.push("/approvals")} />
            ))}
          </Card>
        </>
      ) : null}

      <SectionHeader kicker="From the crew" title="Progress photos" onPress={project ? () => router.push(`/projects/${project.id}/photos`) : undefined} />
      {photos.data?.length ? <PhotoGrid photos={photos.data} /> : <EmptyState icon="images-outline" title="Photos are on the way" message="The crew shares progress photos as each stage happens." />}

      <SectionHeader kicker="Start to swim" title="Timeline" />
      <Card>{stages.data?.length ? <StageTimeline stages={stages.data} /> : <Text variant="caption">Timeline coming soon.</Text>}</Card>

      <SectionHeader title="Latest updates" />
      <Card>{activity.data?.length ? <ActivityFeed items={activity.data} /> : <Text variant="caption">No updates yet.</Text>}</Card>
    </Screen>
  );
}
