import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { ApiError } from "@pool/api-client";
import { parseMoneyToCents, type BudgetSummary } from "@pool/core";
import { BUDGET_CATEGORIES, BUDGET_CATEGORY_LABELS, type BudgetCategory, type BudgetItem, type Expense } from "@pool/types";
import { BottomSheet, Button, Card, DataTable, DateField, ErrorState, KeyValue, LoadingState, Screen, SectionHeader, Select, Stat, Text, TextField } from "@/components/ui";
import { useApi } from "@/features/data";
import { useLayout, useTheme } from "@/hooks/use-theme";
import { api } from "@/lib/api";
import { date, money, todayISO } from "@/lib/format";
import { useSession } from "@/providers/session";

interface BudgetResponse {
  summary: BudgetSummary;
  laborHours: number;
  contingencyPct: number;
  items: BudgetItem[];
}

/** Budget vs actual by category, alerts, line items and expenses. */
export default function Budget() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { can } = useSession();
  const { isTablet } = useLayout();
  const { colors } = useTheme();
  const q = useApi<BudgetResponse>(["budget", id], `/projects/${id}/budget`);
  const expenses = useApi<(Expense & { vendorName: string | null })[]>(["expenses", id], `/projects/${id}/expenses`);
  const [sheet, setSheet] = useState<null | "expense" | "item">(null);

  if (q.isLoading) return <Screen title="Budget" back><LoadingState /></Screen>;
  if (q.error || !q.data) return <Screen title="Budget" back><ErrorState offline={!(q.error instanceof ApiError)} message={q.error instanceof ApiError ? q.error.message : undefined} onRetry={() => void q.refetch()} /></Screen>;
  const s = q.data.summary;
  const max = Math.max(1, ...s.byCategory.map((c) => Math.max(c.estimatedCents, c.actualCents)));

  return (
    <Screen title="Budget" back onRefresh={() => void q.refetch()} refreshing={q.isFetching}>
      <View className="flex-row flex-wrap gap-3">
        <Stat label="Revenue" value={money(s.revenueCents)} hint={`Contract ${money(s.contractAmountCents)}`} />
        <Stat label="Budget" value={money(s.totalBudgetCents)} hint={`incl. ${money(s.contingencyCents)} contingency`} />
        <Stat label="Actual" value={money(s.actualCostCents)} hint={s.pctBudgetUsed === null ? undefined : `${s.pctBudgetUsed}% used`} tone={s.actualCostCents > s.totalBudgetCents ? "danger" : "default"} />
        <Stat label="Forecast profit" value={money(s.projectedProfitCents)} hint={s.projectedMarginPct === null ? undefined : `${s.projectedMarginPct}% margin`} tone={s.projectedProfitCents < 0 ? "danger" : "success"} />
      </View>

      {s.alerts.length ? (
        <Card className="mt-4 gap-1 border-warning bg-warning-soft">
          {s.alerts.map((a, i) => (
            <Text key={i} className={a.level === "critical" ? "font-sans-semibold text-destructive" : "text-sm"}>
              {a.message}
            </Text>
          ))}
        </Card>
      ) : null}

      <SectionHeader title="Estimated vs actual" />
      <Card className="gap-3">
        {s.byCategory.filter((c) => c.estimatedCents || c.actualCents).map((c) => (
          <View key={c.category} accessible accessibilityLabel={`${BUDGET_CATEGORY_LABELS[c.category]}: estimated ${money(c.estimatedCents)}, actual ${money(c.actualCents)}`}>
            <View className="flex-row justify-between">
              <Text className="font-sans-semibold text-sm">{BUDGET_CATEGORY_LABELS[c.category]}</Text>
              <Text className={c.varianceCents < 0 ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>
                {money(c.actualCents)} / {money(c.estimatedCents)}
              </Text>
            </View>
            <View className="mt-1 h-2 rounded-full bg-muted">
              <View style={{ width: `${(c.estimatedCents / max) * 100}%`, backgroundColor: colors.border }} className="h-2 rounded-full" />
            </View>
            <View className="mt-1 h-2 rounded-full">
              <View style={{ width: `${Math.min(100, (c.actualCents / max) * 100)}%`, backgroundColor: c.actualCents > c.estimatedCents ? colors.destructive : colors.primary }} className="h-2 rounded-full" />
            </View>
          </View>
        ))}
        <Text variant="caption">Grey = estimate, blue = actual (red when over).</Text>
      </Card>

      <SectionHeader title="Summary" />
      <Card>
        <KeyValue label="Change-order revenue" value={money(s.changeOrderRevenueCents)} />
        <KeyValue label="Change-order cost" value={money(s.changeOrderCostCents)} />
        <KeyValue label="Remaining budget" value={money(s.remainingBudgetCents)} />
        <KeyValue label="Forecast cost at completion" value={money(s.forecastCostCents)} />
        <KeyValue label="Cost variance" value={money(s.costVarianceCents)} emphasize />
        <KeyValue label="Labor hours" value={`${q.data.laborHours.toFixed(1)}h`} />
      </Card>

      <SectionHeader title="Line items" onPress={can("budget:update") ? () => setSheet("item") : undefined} actionLabel="Add" />
      <DataTable
        wide={isTablet}
        rows={q.data.items}
        keyOf={(r) => r.id}
        columns={[
          { key: "cat", header: "Category", render: (r) => BUDGET_CATEGORY_LABELS[r.category] },
          { key: "desc", header: "Description", render: (r) => r.description, flex: 2 },
          { key: "est", header: "Estimate", render: (r) => money(r.estimatedCents), align: "right" },
        ]}
      />

      <SectionHeader title="Expenses" onPress={can("expense:create") ? () => setSheet("expense") : undefined} actionLabel="Add" />
      <DataTable
        wide={isTablet}
        rows={expenses.data ?? []}
        keyOf={(r) => r.id}
        columns={[
          { key: "date", header: "Date", render: (r) => date(r.incurredOn) },
          { key: "desc", header: "Description", render: (r) => r.description, flex: 2 },
          { key: "vendor", header: "Vendor", render: (r) => r.vendorName ?? "—" },
          { key: "amt", header: "Amount", render: (r) => money(r.amountCents), align: "right" },
        ]}
      />
      {sheet && <BudgetSheet kind={sheet} projectId={id} onClose={() => setSheet(null)} />}
    </Screen>
  );
}

function BudgetSheet({ kind, projectId, onClose }: { kind: "expense" | "item"; projectId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [category, setCategory] = useState<BudgetCategory>("materials");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [day, setDay] = useState<string | null>(todayISO());
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => {
      const cents = parseMoneyToCents(amount);
      if (cents === null) throw new Error("Enter an amount");
      return kind === "expense"
        ? api.post(`/projects/${projectId}/expenses`, { category, description, amountCents: cents, incurredOn: day })
        : api.post(`/projects/${projectId}/budget/items`, { category, description, quantity: 1, unitCostCents: cents });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["budget", projectId] });
      void qc.invalidateQueries({ queryKey: ["expenses", projectId] });
      onClose();
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Failed"),
  });
  return (
    <BottomSheet visible onClose={onClose} title={kind === "expense" ? "Record expense" : "Add budget line"}>
      <View className="gap-3">
        <Select label="Category" value={category} onChange={(v) => v && setCategory(v)} options={BUDGET_CATEGORIES.map((c) => ({ value: c, label: BUDGET_CATEGORY_LABELS[c] }))} />
        <TextField label="Description" value={description} onChangeText={setDescription} />
        <TextField label="Amount" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="$0.00" />
        {kind === "expense" && <DateField label="Date" value={day} onChange={setDay} allowClear={false} />}
        {error ? <Text className="text-sm text-destructive">{error}</Text> : null}
        <Button label="Save" loading={m.isPending} disabled={!description.trim() || !amount} onPress={() => m.mutate()} />
      </View>
    </BottomSheet>
  );
}
