import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { ApiError } from "@pool/api-client";
import {
  AGENT_LABELS,
  COMMUNICATION_KIND_LABELS,
  DISMISS_REASONS,
  DISMISS_REASON_LABELS,
  RECOMMENDATION_STATUS_LABELS,
  type DismissReason,
  type ProposedAction,
  type User,
} from "@pool/types";
import { recommendationStatusTone } from "@pool/ui";
import { RecordLinks, SeverityBadge } from "@/components/intelligence";
import { Badge, BottomSheet, Button, Card, ErrorState, KeyValue, LoadingState, Screen, SectionHeader, Select, Text, TextField } from "@/components/ui";
import { useApi } from "@/features/data";
import { ROLE_OWNER_LABELS, useIntelMutation, useRecommendation } from "@/features/intelligence";
import { api } from "@/lib/api";
import { date, dateTime } from "@/lib/format";
import { useSession } from "@/providers/session";

type Sheet = null | "assign" | "snooze" | "dismiss" | "resolve";
const ACTIVE = new Set(["open", "acknowledged", "in_progress", "snoozed", "escalated"]);

function describeAction(a: ProposedAction): string {
  if (a.type === "draft_message") return `Draft a ${COMMUNICATION_KIND_LABELS[a.kind].toLowerCase()} for the ${a.audience}`;
  if (a.type === "request_approval") return `Ask the homeowner to sign off: ${a.title}`;
  return `Create a task: ${a.title}`;
}

/** One recommendation: the observation, the evidence, what to do, and its history. */
export default function AlertDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { can } = useSession();
  const rec = useRecommendation(id);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [note, setNote] = useState("");
  const [reason, setReason] = useState<DismissReason>("already_handled");
  const [assignee, setAssignee] = useState<string | null>(null);
  const team = useApi<User[]>(["users", "internal"], sheet === "assign" ? "/users" : null);
  const act = useIntelMutation((v: { action: string; body?: Record<string, unknown> }) => api.post(`/recommendations/${id}/${v.action}`, v.body ?? {}));
  const run = (action: string, body?: Record<string, unknown>) =>
    act.mutate(
      { action, body },
      {
        onSuccess: (result) => {
          setSheet(null);
          setNote("");
          const r = result as { actionResult?: { entityType: string; entityId: string } | null };
          if (action === "approve" && r.actionResult?.entityType === "communication_draft") router.push(`/communications/${r.actionResult.entityId}`);
        },
      },
    );

  if (rec.isLoading) return <Screen title="Alert" back><LoadingState /></Screen>;
  const r = rec.data;
  if (!r) return <Screen title="Alert" back><ErrorState message={rec.error instanceof ApiError ? rec.error.message : "This alert isn't available."} onRetry={() => void rec.refetch()} /></Screen>;
  const active = ACTIVE.has(r.status);
  const manage = can("intelligence:manage");
  const needsNote = r.severity === "critical" || r.severity === "high" || reason === "other";

  return (
    <Screen kicker={`${r.projectNumber} · ${r.projectName}`} title={r.title} back>
      <View className="gap-3">
        <View className="flex-row flex-wrap items-center gap-2">
          <SeverityBadge severity={r.severity} />
          <Badge label={RECOMMENDATION_STATUS_LABELS[r.status]} tone={recommendationStatusTone[r.status]} size="sm" />
          {r.escalationLevel ? <Badge label={`Escalated ×${r.escalationLevel}`} tone="danger" size="sm" /> : null}
          <Text variant="caption">{AGENT_LABELS[r.agent]}</Text>
        </View>

        <Card className="gap-2">
          <Text variant="label">What we see</Text>
          <Text>{r.observation}</Text>
          <Text variant="label">Why it matters</Text>
          <Text>{r.risk}</Text>
          <Text variant="label">Recommended next step</Text>
          <Text variant="bodyStrong">{r.recommendedAction}</Text>
        </Card>

        <Card className="gap-0.5">
          <KeyValue label="Owner" value={r.assigneeName ?? ROLE_OWNER_LABELS[r.responsibleRole] ?? r.responsibleRole} />
          <KeyValue label="Do by" value={r.suggestedDueDate ? date(r.suggestedDueDate) : "—"} emphasize />
          <KeyValue label="Because" value={r.dueRationale} />
          <KeyValue label="Confidence" value={`${r.confidence}${r.missingData ? " · based on missing information" : ""}`} />
          <KeyValue label="First seen" value={dateTime(r.firstDetectedAt)} />
          <KeyValue label="Re-checked when" value={r.reevaluateWhen} />
        </Card>

        <RecordLinks items={r.evidence} projectId={r.projectId} title="Evidence from project records" />
        {r.impact.length ? <RecordLinks items={r.impact} projectId={r.projectId} title="Downstream work affected" /> : null}

        {r.proposedAction ? (
          <Card className="gap-2">
            <Text variant="label">Proposed action · needs approval</Text>
            <Text>{describeAction(r.proposedAction)}</Text>
            {r.actionResult ? (
              <Button
                label={r.actionResult.entityType === "communication_draft" ? "Open the draft" : r.actionResult.entityType === "task" ? "Open the task" : "View approvals"}
                variant="outline"
                icon="open-outline"
                onPress={() =>
                  router.push(
                    r.actionResult!.entityType === "communication_draft"
                      ? `/communications/${r.actionResult!.entityId}`
                      : r.actionResult!.entityType === "task"
                        ? `/tasks/${r.actionResult!.entityId}`
                        : { pathname: "/approvals", params: { projectId: r.projectId } },
                  )
                }
              />
            ) : can("intelligence:approve") && active ? (
              <Button label="Approve & do it" icon="checkmark" loading={act.isPending && act.variables?.action === "approve"} onPress={() => run("approve")} />
            ) : (
              <Text variant="caption">A project manager or admin can approve this.</Text>
            )}
          </Card>
        ) : null}

        {manage ? (
          <View className="gap-2">
            {r.status === "open" || r.status === "escalated" ? <Button label="Acknowledge" icon="eye-outline" variant="secondary" onPress={() => run("acknowledge")} /> : null}
            {active && r.status !== "in_progress" ? <Button label="I'm on it" icon="play-outline" variant="secondary" onPress={() => run("start")} /> : null}
            {active ? (
              <View className="flex-row flex-wrap gap-2">
                <Button label="Assign" size="md" variant="outline" icon="person-add-outline" onPress={() => setSheet("assign")} />
                <Button label="Snooze" size="md" variant="outline" icon="moon-outline" onPress={() => setSheet("snooze")} />
                <Button label="Resolve" size="md" variant="outline" icon="checkmark-done-outline" onPress={() => setSheet("resolve")} />
                <Button label="Dismiss" size="md" variant="ghost" icon="close-outline" onPress={() => setSheet("dismiss")} />
              </View>
            ) : (
              <Button label="Reopen" variant="outline" icon="refresh" onPress={() => run("reopen")} />
            )}
          </View>
        ) : null}
        {act.error ? <Text className="text-sm text-destructive">{act.error instanceof ApiError ? act.error.message : "Needs a connection"}</Text> : null}

        <SectionHeader kicker="Audit trail" title="History" />
        <Card className="gap-2">
          {r.history.map((h) => (
            <View key={h.id} className="gap-0.5">
              <Text className="text-sm text-foreground">
                {h.action.replace(/_/g, " ")}
                {h.toStatus && h.fromStatus !== h.toStatus ? ` → ${RECOMMENDATION_STATUS_LABELS[h.toStatus].toLowerCase()}` : ""}
                {h.note ? ` · ${h.note}` : ""}
              </Text>
              <Text variant="caption">
                {h.actorName ?? (h.automationPolicy ? `Automation (${h.automationPolicy})` : "System")} · {dateTime(h.createdAt)}
              </Text>
            </View>
          ))}
        </Card>
      </View>

      <BottomSheet visible={sheet === "assign"} onClose={() => setSheet(null)} title="Assign">
        <View className="gap-3">
          <Select
            label="Team member"
            value={assignee}
            onChange={setAssignee}
            allowClear
            options={(team.data ?? []).filter((u) => u.role !== "client" && u.role !== "subcontractor" && u.isActive).map((u) => ({ value: u.id, label: u.fullName, description: u.role.replace(/_/g, " ") }))}
          />
          <TextField label="Note (optional)" value={note} onChangeText={setNote} />
          <Button label="Assign" loading={act.isPending} onPress={() => run("assign", { assigneeId: assignee, note: note || null })} />
        </View>
      </BottomSheet>

      <BottomSheet visible={sheet === "snooze"} onClose={() => setSheet(null)} title="Snooze">
        <View className="gap-2">
          {r.severity === "critical" ? <Text variant="caption">Critical items can only be snoozed for a day.</Text> : null}
          {[1, 3, 7].map((days) => (
            <Button key={days} label={`${days} day${days === 1 ? "" : "s"}`} variant="outline" onPress={() => run("snooze", { days })} />
          ))}
        </View>
      </BottomSheet>

      <BottomSheet visible={sheet === "resolve"} onClose={() => setSheet(null)} title="Resolve">
        <View className="gap-3">
          <Text variant="caption">If the project records still show the problem, it reopens when the evidence changes.</Text>
          <TextField label="What was done? (optional)" value={note} onChangeText={setNote} multiline />
          <Button label="Mark resolved" loading={act.isPending} onPress={() => run("resolve", { note: note || null })} />
        </View>
      </BottomSheet>

      <BottomSheet visible={sheet === "dismiss"} onClose={() => setSheet(null)} title="Dismiss">
        <View className="gap-3">
          <Select label="Reason" value={reason} onChange={(v) => v && setReason(v)} options={DISMISS_REASONS.map((d) => ({ value: d, label: DISMISS_REASON_LABELS[d] }))} />
          <TextField label={needsNote ? "Note (required)" : "Note (optional)"} value={note} onChangeText={setNote} multiline helper="Your reason helps tune these alerts and stays in the audit trail." />
          <Button label="Dismiss" variant="destructive" loading={act.isPending} disabled={needsNote && !note.trim()} onPress={() => run("dismiss", { reason, note: note || null })} />
        </View>
      </BottomSheet>
    </Screen>
  );
}
