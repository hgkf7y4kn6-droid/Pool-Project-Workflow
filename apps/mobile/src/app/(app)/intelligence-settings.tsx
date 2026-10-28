import { useEffect, useState } from "react";
import { Switch, View } from "react-native";
import { ApiError } from "@pool/api-client";
import { SEVERITIES, SEVERITY_LABELS, type IntelligenceSettings } from "@pool/types";
import { Button, Card, ErrorState, KeyValue, LoadingState, Screen, SectionHeader, Select, Text, TextField } from "@/components/ui";
import { useAgentRuns, useIntelligenceSettings, useIntelMutation } from "@/features/intelligence";
import { api } from "@/lib/api";
import { dateTime } from "@/lib/format";

const NUMBER_FIELDS: { key: keyof IntelligenceSettings; label: string; helper: string }[] = [
  { key: "lookaheadDays", label: "Look ahead (days)", helper: "Upcoming work inside this window is checked for readiness." },
  { key: "attentionWindowDays", label: "Attention window (days)", helper: "Blocked work starting this soon is high priority." },
  { key: "criticalWindowDays", label: "Critical window (days)", helper: "Blocked work starting this soon is critical." },
  { key: "criticalOverdueDays", label: "Critical overdue (days)", helper: "Critical-path work late by more than this is critical." },
  { key: "slipDaysHigh", label: "Completion slip (days)", helper: "A projected slip beyond this is high priority." },
  { key: "clientUpdateDays", label: "Homeowner update every (days)", helper: "Active projects without a client update are flagged." },
  { key: "inactivityDays", label: "Inactive after (days)", helper: "Active projects with no recorded activity are flagged." },
  { key: "deliveryConfirmDays", label: "Confirm deliveries within (days)", helper: "Unconfirmed deliveries needed this soon are flagged." },
  { key: "defaultLeadTimeDays", label: "Default lead time (days)", helper: "Used when a material has no lead time recorded." },
  { key: "escalateAfterDays", label: "Escalate after (days)", helper: "Unacknowledged high items escalate to managers." },
];

/** Admin: thresholds, notifications and AI usage for project intelligence. */
export default function IntelligenceSettingsScreen() {
  const q = useIntelligenceSettings();
  const runs = useAgentRuns(!!q.data?.canConfigure);
  const [form, setForm] = useState<IntelligenceSettings | null>(null);
  useEffect(() => {
    if (q.data) setForm(q.data.settings);
  }, [q.data]);
  const save = useIntelMutation((s: Partial<IntelligenceSettings>) => api.patch(`/intelligence/settings`, s));

  if (q.isLoading || !form) return <Screen title="Project intelligence" back>{q.error ? <ErrorState message="Settings need a connection." onRetry={() => void q.refetch()} /> : <LoadingState />}</Screen>;
  const readOnly = !q.data?.canConfigure;
  const set = <K extends keyof IntelligenceSettings>(k: K, v: IntelligenceSettings[K]) => setForm({ ...form, [k]: v });
  const u = runs.data?.usage30d;

  return (
    <Screen kicker="Company" title="Project intelligence" back>
      <View className="gap-3">
        <Card className="gap-2">
          <View className="flex-row items-center justify-between">
            <Text variant="bodyStrong">Proactive alerts</Text>
            <Switch accessibilityLabel="Proactive alerts" value={form.enabled} disabled={readOnly} onValueChange={(v) => set("enabled", v)} />
          </View>
          <Text variant="caption">Every change and a daily scan re-check each active project against these rules.</Text>
          <Select
            label="Notify people about"
            value={form.notifyMinSeverity}
            onChange={(v) => v && set("notifyMinSeverity", v)}
            options={SEVERITIES.map((s) => ({ value: s, label: `${SEVERITY_LABELS[s]}${s === "low" ? "" : " and above"}` }))}
          />
        </Card>

        <SectionHeader kicker="Rules" title="Thresholds" />
        <Card className="gap-3">
          {NUMBER_FIELDS.map((f) => (
            <TextField
              key={f.key}
              label={f.label}
              helper={f.helper}
              editable={!readOnly}
              keyboardType="number-pad"
              value={String(form[f.key] ?? "")}
              onChangeText={(v) => set(f.key, Number(v.replace(/\D/g, "")) as never)}
            />
          ))}
        </Card>

        <SectionHeader kicker="AI" title="Agents" />
        <Card className="gap-2">
          <KeyValue label="Provider" value={q.data!.agentProvider === "none" ? "Not configured (rules only)" : q.data!.agentProvider === "crewai" ? "CrewAI service" : "Anthropic (single agent)"} />
          <Select
            label="Briefing depth"
            value={form.briefingDepth}
            onChange={(v) => v && set("briefingDepth", v)}
            options={[
              { value: "compact", label: "Compact", description: "Superintendent only — one AI call" },
              { value: "full", label: "Full", description: "Each specialist with findings, then the superintendent" },
            ]}
          />
          <View className="flex-row items-center justify-between">
            <Text className="flex-1 text-sm text-foreground">Write an AI briefing for every active project daily</Text>
            <Switch accessibilityLabel="Daily AI briefings" value={form.dailyAgentBriefings} disabled={readOnly} onValueChange={(v) => set("dailyAgentBriefings", v)} />
          </View>
          <TextField label="Daily AI run limit" keyboardType="number-pad" editable={!readOnly} value={String(form.dailyAgentRunLimit)} onChangeText={(v) => set("dailyAgentRunLimit", Number(v.replace(/\D/g, "")))} />
          {u ? (
            <Text variant="caption">
              Last 30 days: {u.runs} runs, {u.failed} not used, {(u.inputTokens + u.outputTokens).toLocaleString()} tokens.
            </Text>
          ) : null}
        </Card>

        {!readOnly ? (
          <Button
            label="Save"
            icon="save-outline"
            loading={save.isPending}
            onPress={() => {
              const { enabled, notifyMinSeverity, briefingDepth, dailyAgentBriefings, dailyAgentRunLimit } = form;
              const numbers = Object.fromEntries(NUMBER_FIELDS.map((f) => [f.key, form[f.key]]));
              save.mutate({ enabled, notifyMinSeverity, briefingDepth, dailyAgentBriefings, dailyAgentRunLimit, ...numbers });
            }}
          />
        ) : (
          <Text variant="caption">Only administrators can change these settings.</Text>
        )}
        {save.error ? <Text className="text-sm text-destructive">{save.error instanceof ApiError ? save.error.message : "Couldn't save"}</Text> : null}
        {save.isSuccess ? <Text variant="caption">Saved. New thresholds apply from the next evaluation.</Text> : null}

        {runs.data?.items.length ? (
          <>
            <SectionHeader kicker="Audit" title="Recent AI runs" />
            <Card className="gap-2">
              {runs.data.items.slice(0, 15).map((r) => (
                <View key={r.id} className="gap-0.5">
                  <Text className="text-sm text-foreground">
                    {r.kind} · {r.status}
                    {r.latencyMs ? ` · ${(r.latencyMs / 1000).toFixed(1)}s` : ""}
                    {r.inputTokens ? ` · ${r.inputTokens + (r.outputTokens ?? 0)} tokens` : ""}
                  </Text>
                  <Text variant="caption">
                    {dateTime(r.createdAt)}
                    {r.error ? ` · ${r.error}` : ""}
                    {r.validationIssues.length ? ` · ${r.validationIssues.join("; ")}` : ""}
                  </Text>
                </View>
              ))}
            </Card>
          </>
        ) : null}
      </View>
    </Screen>
  );
}
