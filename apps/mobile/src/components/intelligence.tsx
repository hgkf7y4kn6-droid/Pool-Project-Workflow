import { router } from "expo-router";
import { View } from "react-native";
import {
  AGENT_LABELS,
  READINESS_FACTOR_LABELS,
  SEVERITY_LABELS,
  type Citation,
  type Evidence,
  type FactorState,
  type MilestoneReadiness,
  type ProjectBriefing,
  type ReadinessLabel,
  type Recommendation,
  type Severity,
} from "@pool/types";
import { factorStateTone, readinessTone, severityTone } from "@pool/ui";
import { recordHref, ROLE_OWNER_LABELS } from "@/features/intelligence";
import { useTheme } from "@/hooks/use-theme";
import { fromNow, shortDate } from "@/lib/format";
import { Icon, type IconName } from "./icon";
import { Badge, Card, PressableScale, ProgressRing, Text } from "./ui";

const READINESS_LABELS: Record<ReadinessLabel, string> = { ready: "Ready", at_risk: "At risk", blocked: "Blocked", no_upcoming_milestone: "No upcoming stage" };
const FACTOR_STATE_LABELS: Record<FactorState, string> = { ready: "Ready", at_risk: "At risk", blocked: "Blocked", unknown: "Missing info" };
const SEVERITY_ICONS: Record<Severity, IconName> = { critical: "alert-circle", high: "warning", medium: "information-circle", low: "ellipse-outline" };

export const SeverityBadge = ({ severity }: { severity: Severity }) => <Badge label={SEVERITY_LABELS[severity]} tone={severityTone[severity]} icon={SEVERITY_ICONS[severity]} size="sm" />;
export const ReadinessBadge = ({ label }: { label: ReadinessLabel }) => <Badge label={READINESS_LABELS[label]} tone={readinessTone[label]} size="sm" />;
export const FactorBadge = ({ state }: { state: FactorState }) => <Badge label={FACTOR_STATE_LABELS[state]} tone={factorStateTone[state]} size="sm" />;

/** Marks content that came from an agent rather than from records. */
export function AiLabel({ text = "AI-written from project records" }: { text?: string }) {
  return (
    <View className="flex-row items-center gap-1">
      <Icon name="sparkles-outline" size={13} className="text-muted-foreground" />
      <Text variant="caption">{text}</Text>
    </View>
  );
}

/** One recommendation in a list. */
export function RecommendationRow({ rec, showProject }: { rec: Recommendation; showProject?: boolean }) {
  const meta = [
    showProject ? rec.projectName : null,
    rec.suggestedDueDate ? `Due ${shortDate(rec.suggestedDueDate)}` : null,
    rec.assigneeName ?? ROLE_OWNER_LABELS[rec.responsibleRole] ?? null,
    rec.status === "snoozed" ? "Snoozed" : rec.status === "escalated" ? "Escalated" : null,
  ].filter(Boolean);
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${SEVERITY_LABELS[rec.severity]}: ${rec.title}`}
      onPress={() => router.push(`/alerts/${rec.id}`)}
      scaleTo={0.985}
      className="min-h-16 flex-row items-start gap-3 py-3"
    >
      <View className="pt-0.5">
        <SeverityBadge severity={rec.severity} />
      </View>
      <View className="flex-1 gap-0.5">
        <Text variant="bodyStrong" numberOfLines={2}>
          {rec.title}
        </Text>
        <Text variant="caption" numberOfLines={1}>
          {meta.join(" · ")}
        </Text>
        {rec.missingData ? <Text variant="caption">Missing information, not a failure</Text> : null}
      </View>
      <Icon name="chevron-forward" className="mt-1 text-lg text-muted-foreground/70" />
    </PressableScale>
  );
}

/** Tappable links to the records an answer or recommendation relies on. */
export function RecordLinks({ items, projectId, title = "Based on" }: { items: (Citation | Evidence)[]; projectId: string; title?: string }) {
  if (!items.length) return null;
  return (
    <View className="gap-1.5">
      <Text variant="label">{title}</Text>
      <View className="flex-row flex-wrap gap-2">
        {items.map((c) => {
          const href = recordHref(c.type, c.id, projectId);
          const label = `${c.label}${"detail" in c && c.detail ? ` — ${c.detail}` : ""}`;
          return (
            <PressableScale
              key={`${c.type}:${c.id}`}
              accessibilityRole={href ? "link" : "text"}
              accessibilityLabel={`${c.type.replace(/_/g, " ")}: ${label}`}
              disabled={!href}
              onPress={() => href && router.push(href)}
              className="chip max-w-full flex-row items-center gap-1"
            >
              <Icon name="document-attach-outline" size={13} className="text-primary" />
              <Text className="shrink text-xs text-foreground" numberOfLines={2}>
                {label}
              </Text>
            </PressableScale>
          );
        })}
      </View>
    </View>
  );
}

/**
 * AI Project Briefing: what matters now, as a compact card. The facts come
 * from the rules; an agent narrative is shown (and labelled) when available.
 */
export function BriefingCard({ briefing, projectId, readiness, compact }: { briefing: ProjectBriefing; projectId: string; readiness: MilestoneReadiness | null; compact?: boolean }) {
  const { colors } = useTheme();
  const actions = (briefing.blockers.length ? briefing.blockers : briefing.todayActions).slice(0, compact ? 3 : 6);
  const ringColor = readiness ? (readiness.label === "ready" ? colors.success : readiness.label === "blocked" ? colors.destructive : colors.warning) : colors.mutedForeground;
  return (
    <Card className="gap-3">
      <View className="flex-row items-start gap-3">
        {readiness ? (
          <ProgressRing value={readiness.score} size={58} stroke={6} color={ringColor} track={colors.muted} label={`${readiness.stageName} readiness`}>
            <Text className="font-display text-base text-foreground">{readiness.score}</Text>
          </ProgressRing>
        ) : (
          <View className="icon-tile">
            <Icon name="pulse-outline" className="text-xl text-primary" />
          </View>
        )}
        <View className="flex-1 gap-1">
          <Text variant="kicker">Project briefing</Text>
          <Text variant="h3">{briefing.headline}</Text>
          <Text variant="caption" numberOfLines={2}>
            {briefing.status}
          </Text>
        </View>
      </View>
      {briefing.needsIntervention ? (
        <View className="flex-row items-start gap-2 rounded-2xl bg-destructive-soft p-3">
          <Icon name="flag" className="text-base text-destructive" />
          <Text className="flex-1 text-sm text-destructive">Needs management attention: {briefing.interventionReasons.join("; ")}.</Text>
        </View>
      ) : null}
      {briefing.narrative && !compact ? (
        <View className="gap-1 rounded-2xl bg-surface p-3">
          <Text selectable>{briefing.narrative}</Text>
          <AiLabel text={`AI-written ${fromNow(briefing.narrativeAt)}${briefing.narrativeStale ? " · project data has changed since" : ""}`} />
        </View>
      ) : null}
      {actions.length ? (
        <View className="gap-2">
          <Text variant="label">{briefing.blockers.length ? "Blocking progress" : "Today"}</Text>
          {actions.map((a, i) => (
            <PressableScale
              key={`${a.recommendationId ?? i}`}
              accessibilityRole="button"
              accessibilityLabel={a.text}
              disabled={!a.recommendationId}
              onPress={() => a.recommendationId && router.push(`/alerts/${a.recommendationId}`)}
              className="flex-row items-start gap-2"
            >
              <SeverityBadge severity={a.severity} />
              <Text className="flex-1 text-sm text-foreground" numberOfLines={compact ? 2 : 4}>
                {a.text}
              </Text>
            </PressableScale>
          ))}
        </View>
      ) : (
        <View className="flex-row items-center gap-2">
          <Icon name="checkmark-circle" className="text-base text-success" />
          <Text className="text-sm text-foreground">Nothing needs action today.</Text>
        </View>
      )}
      {compact ? (
        <PressableScale accessibilityRole="link" accessibilityLabel="Open project intelligence" onPress={() => router.push(`/projects/${projectId}/intelligence`)} className="flex-row items-center gap-1 self-start">
          <Text className="font-sans-semibold text-sm text-primary">Readiness, alerts & briefing</Text>
          <Icon name="chevron-forward" className="text-sm text-primary" />
        </PressableScale>
      ) : null}
    </Card>
  );
}

/** Phase readiness checklist: authoritative records vs. what's missing. */
export function ReadinessChecklist({ readiness, projectId }: { readiness: MilestoneReadiness; projectId: string }) {
  return (
    <View className="gap-3">
      <Card className="gap-2">
        <View className="flex-row items-center justify-between gap-2">
          <View className="flex-1">
            <Text variant="h3">{readiness.stageName}</Text>
            <Text variant="caption">
              {readiness.plannedStartDate ? `Planned start ${shortDate(readiness.plannedStartDate)}${readiness.daysUntilStart !== null ? ` · in ${readiness.daysUntilStart} days` : ""}` : "No planned start"}
            </Text>
          </View>
          <ReadinessBadge label={readiness.label} />
        </View>
        {readiness.history ? (
          <Text variant="caption">
            Your company&apos;s history: {readiness.stageName} usually takes {readiness.history.medianDays} days (80% within {readiness.history.p80Days}; {readiness.history.sampleSize} projects).
          </Text>
        ) : null}
        <Text variant="caption">Each item is checked against project records. The app never certifies compliance or approves inspections.</Text>
      </Card>
      {readiness.factors.map((f) => (
        <Card key={f.key} className="gap-2">
          <View className="flex-row items-center justify-between gap-2">
            <Text variant="bodyStrong" className="flex-1">
              {READINESS_FACTOR_LABELS[f.key]}
              {f.mandatory ? <Text variant="caption"> · required</Text> : null}
            </Text>
            <FactorBadge state={f.state} />
          </View>
          <Text variant="caption">{f.explanation}</Text>
          {f.items.map((item, i) => {
            const href = item.evidence ? recordHref(item.evidence.type, item.evidence.id, projectId) : null;
            return (
              <PressableScale key={i} accessibilityRole={href ? "link" : "text"} accessibilityLabel={item.label} disabled={!href} onPress={() => href && router.push(href)} className="flex-row items-start gap-2 py-1">
                <Icon
                  name={item.state === "ready" ? "checkmark-circle" : item.state === "blocked" ? "close-circle" : item.state === "unknown" ? "help-circle-outline" : "alert-circle-outline"}
                  className={item.state === "ready" ? "text-base text-success" : item.state === "blocked" ? "text-base text-destructive" : item.state === "unknown" ? "text-base text-muted-foreground" : "text-base text-warning"}
                />
                <View className="flex-1">
                  <Text className="text-sm text-foreground">{item.label}</Text>
                  {item.humanVerification ? <Text variant="caption">Needs verification by a qualified person</Text> : null}
                </View>
                {href ? <Icon name="chevron-forward" className="text-sm text-muted-foreground/70" /> : null}
              </PressableScale>
            );
          })}
        </Card>
      ))}
    </View>
  );
}

export const agentLabel = (key: keyof typeof AGENT_LABELS) => AGENT_LABELS[key];
