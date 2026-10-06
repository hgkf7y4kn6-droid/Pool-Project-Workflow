import { useState } from "react";
import { View } from "react-native";
import { Button, Card, DataTable, DateField, ErrorState, LoadingState, Screen, SectionHeader, Stat, Text } from "@/components/ui";
import { useApi } from "@/features/data";
import { useLayout } from "@/hooks/use-theme";
import { downloadAndShare } from "@/lib/download";
import { compactMoney, date, money } from "@/lib/format";

interface Report {
  range: { from: string; to: string };
  metrics: {
    activeProjects: number;
    projectsBehindSchedule: number;
    projectsOverBudget: number;
    revenueCents: number;
    estimatedRevenueCents: number;
    costCents: number;
    projectedProfitCents: number;
    laborUtilizationPct: number | null;
    laborHours: number;
    materialCostCents: number;
    changeOrderRevenueCents: number;
    completionRatePct: number | null;
  };
  projects: { number: string; name: string; status: string; revenueCents: number; actualCostCents: number; projectedProfitCents: number; marginPct: number | null; completionPct: number; projectedCompletion: string | null; scheduleVarianceDays: number | null }[];
}

/** Management dashboard + exports (PDF, CSV, Excel). */
export default function Reports() {
  const { isTablet } = useLayout();
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const q = useApi<Report>(["report", from, to], "/reports/portfolio", { from: from ?? undefined, to: to ?? undefined });
  const [exporting, setExporting] = useState<string | null>(null);
  const exportAs = async (format: "csv" | "xlsx" | "pdf") => {
    setExporting(format);
    try {
      const mime = { csv: "text/csv", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", pdf: "application/pdf" }[format];
      await downloadAndShare("/reports/portfolio", { format, ...(from ? { from } : {}), ...(to ? { to } : {}) }, `portfolio.${format}`, mime);
    } finally {
      setExporting(null);
    }
  };
  if (q.isLoading) return <Screen title="Reports" back><LoadingState /></Screen>;
  if (q.error || !q.data) return <Screen title="Reports" back><ErrorState offline onRetry={() => void q.refetch()} /></Screen>;
  const m = q.data.metrics;
  return (
    <Screen title="Reports" subtitle={`${date(q.data.range.from)} – ${date(q.data.range.to)}`} back onRefresh={() => void q.refetch()} refreshing={q.isFetching}>
      <View className="flex-row gap-3">
        <View className="flex-1">
          <DateField label="From" value={from} onChange={setFrom} />
        </View>
        <View className="flex-1">
          <DateField label="To" value={to} onChange={setTo} />
        </View>
      </View>
      <View className="mt-4 flex-row flex-wrap gap-3">
        <Stat label="Active projects" value={String(m.activeProjects)} hint={`${m.projectsBehindSchedule} behind · ${m.projectsOverBudget} over budget`} />
        <Stat label="Revenue" value={compactMoney(m.revenueCents)} hint={`${compactMoney(m.changeOrderRevenueCents)} from change orders`} />
        <Stat label="Pipeline" value={compactMoney(m.estimatedRevenueCents)} hint="leads & estimates" />
        <Stat label="Cost to date" value={compactMoney(m.costCents)} hint={`${compactMoney(m.materialCostCents)} materials`} />
        <Stat label="Projected profit" value={compactMoney(m.projectedProfitCents)} tone={m.projectedProfitCents < 0 ? "danger" : "success"} />
        <Stat label="Labor utilization" value={m.laborUtilizationPct === null ? "—" : `${m.laborUtilizationPct}%`} hint={`${m.laborHours.toFixed(0)}h logged`} />
        <Stat label="Completion rate" value={m.completionRatePct === null ? "—" : `${m.completionRatePct}%`} />
      </View>
      <SectionHeader title="Export" />
      <View className="flex-row gap-2">
        <Button label="PDF" icon="document" variant="outline" className="flex-1" loading={exporting === "pdf"} onPress={() => void exportAs("pdf")} />
        <Button label="Excel" icon="grid" variant="outline" className="flex-1" loading={exporting === "xlsx"} onPress={() => void exportAs("xlsx")} />
        <Button label="CSV" icon="list" variant="outline" className="flex-1" loading={exporting === "csv"} onPress={() => void exportAs("csv")} />
      </View>
      <SectionHeader title="Projects" />
      <DataTable
        wide={isTablet}
        rows={q.data.projects}
        keyOf={(r) => r.number}
        columns={[
          { key: "name", header: "Project", render: (r) => r.name, flex: 2 },
          { key: "rev", header: "Revenue", render: (r) => money(r.revenueCents), align: "right" },
          { key: "cost", header: "Actual", render: (r) => money(r.actualCostCents), align: "right" },
          { key: "margin", header: "Margin", render: (r) => (r.marginPct === null ? "—" : `${r.marginPct}%`), align: "right" },
          { key: "done", header: "Done", render: (r) => `${r.completionPct}%`, align: "right" },
          { key: "var", header: "Variance", render: (r) => (r.scheduleVarianceDays ? `${r.scheduleVarianceDays > 0 ? "+" : ""}${r.scheduleVarianceDays}d` : "On time"), align: "right" },
        ]}
      />
      <Card className="mt-4">
        <Text variant="caption">Revenue includes approved change orders. Profit uses the cost forecast at completion (the higher of estimate or actual per category).</Text>
      </Card>
    </Screen>
  );
}
