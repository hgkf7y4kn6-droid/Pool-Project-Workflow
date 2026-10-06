import { and, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { WorkCalendar, diffCalendarDays, formatCents, todayISO } from "@pool/core";
import { clients, laborEntries, organizations, projects, users } from "@pool/database";
import { ACTIVE_PROJECT_STATUSES, PROJECT_STATUS_LABELS, UPCOMING_PROJECT_STATUSES } from "@pool/types";
import type { Ctx } from "../context";
import { accessibleProjectIds, requirePermission } from "./access";
import { computeProjectBudget } from "./budget";
import { csvCell } from "./measurements";

export interface PortfolioRow {
  number: string;
  name: string;
  status: string;
  client: string;
  projectManager: string | null;
  contractCents: number;
  changeOrderRevenueCents: number;
  revenueCents: number;
  budgetCents: number;
  actualCostCents: number;
  forecastCostCents: number;
  projectedProfitCents: number;
  marginPct: number | null;
  completionPct: number;
  plannedCompletion: string | null;
  projectedCompletion: string | null;
  scheduleVarianceDays: number | null;
}

/** Portfolio report: KPIs plus one row per project (management dashboard + exports). */
export async function portfolioReport(ctx: Ctx, range: { from?: string; to?: string }) {
  await requirePermission(ctx, "report:read");
  const db = ctx.deps.db;
  const [org] = await db.select().from(organizations).where(eq(organizations.id, ctx.auth.organizationId));
  const today = todayISO(org?.timezone);
  const from = range.from ?? `${today.slice(0, 4)}-01-01`;
  const to = range.to ?? today;
  const ids = await accessibleProjectIds(ctx);
  const rows = ids.length
    ? await db
        .select({ project: projects, clientName: sql<string>`${clients.firstName} || ' ' || ${clients.lastName}`, pmName: users.fullName })
        .from(projects)
        .innerJoin(clients, eq(clients.id, projects.clientId))
        .leftJoin(users, eq(users.id, projects.projectManagerId))
        .where(and(inArray(projects.id, ids), isNull(projects.deletedAt)))
    : [];

  const projectRows: PortfolioRow[] = [];
  let revenue = 0;
  let pipeline = 0;
  let cost = 0;
  let profit = 0;
  let coRevenue = 0;
  let materialCost = 0;
  let overBudget = 0;
  let behind = 0;
  for (const { project: p, clientName, pmName } of rows) {
    if (UPCOMING_PROJECT_STATUSES.includes(p.status)) {
      pipeline += p.contractAmountCents;
      continue;
    }
    if (p.status === "cancelled") continue;
    const { summary } = await computeProjectBudget(ctx.deps, p.id);
    const variance = p.plannedCompletionDate && p.projectedCompletionDate ? diffCalendarDays(p.plannedCompletionDate, p.projectedCompletionDate) : null;
    revenue += summary.revenueCents;
    cost += summary.actualCostCents;
    profit += summary.projectedProfitCents;
    coRevenue += summary.changeOrderRevenueCents;
    materialCost += summary.byCategory.find((c) => c.category === "materials")?.actualCents ?? 0;
    if (summary.alerts.some((a) => a.code === "over_budget" || a.code === "category_over_budget")) overBudget += 1;
    if (ACTIVE_PROJECT_STATUSES.includes(p.status) && (variance ?? 0) > 0) behind += 1;
    projectRows.push({
      number: p.number,
      name: p.name,
      status: PROJECT_STATUS_LABELS[p.status],
      client: clientName,
      projectManager: pmName,
      contractCents: p.contractAmountCents,
      changeOrderRevenueCents: summary.changeOrderRevenueCents,
      revenueCents: summary.revenueCents,
      budgetCents: summary.totalBudgetCents,
      actualCostCents: summary.actualCostCents,
      forecastCostCents: summary.forecastCostCents,
      projectedProfitCents: summary.projectedProfitCents,
      marginPct: summary.projectedMarginPct,
      completionPct: p.completionPct,
      plannedCompletion: p.plannedCompletionDate,
      projectedCompletion: p.projectedCompletionDate,
      scheduleVarianceDays: variance,
    });
  }

  // Labor utilization: logged hours vs. available hours of field staff in the range.
  const fieldUsers = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.organizationId, ctx.auth.organizationId), eq(users.isActive, true), inArray(users.role, ["field_supervisor", "field_worker"])));
  const [hours] = fieldUsers.length
    ? await db
        .select({ total: sql<number>`coalesce(sum(${laborEntries.hours}), 0)::float` })
        .from(laborEntries)
        .where(and(inArray(laborEntries.userId, fieldUsers.map((u) => u.id)), gte(laborEntries.workDate, from), lte(laborEntries.workDate, to), isNull(laborEntries.deletedAt)))
    : [{ total: 0 }];
  const workingDays = Math.max(new WorkCalendar().workingDaysBetween(from, to) + 1, 1);
  const available = fieldUsers.length * workingDays * 8;

  const active = rows.filter((r) => ACTIVE_PROJECT_STATUSES.includes(r.project.status)).length;
  const completed = rows.filter((r) => ["completed", "warranty"].includes(r.project.status)).length;

  return {
    range: { from, to },
    generatedAt: new Date().toISOString(),
    organization: org?.name ?? "",
    metrics: {
      activeProjects: active,
      projectsBehindSchedule: behind,
      projectsOverBudget: overBudget,
      revenueCents: revenue,
      estimatedRevenueCents: pipeline,
      costCents: cost,
      projectedProfitCents: profit,
      laborUtilizationPct: available ? Math.round(((hours?.total ?? 0) / available) * 1000) / 10 : null,
      laborHours: hours?.total ?? 0,
      materialCostCents: materialCost,
      changeOrderRevenueCents: coRevenue,
      completionRatePct: active + completed ? Math.round((completed / (active + completed)) * 1000) / 10 : null,
    },
    projects: projectRows,
  };
}

type Report = Awaited<ReturnType<typeof portfolioReport>>;

const COLUMNS: { key: keyof PortfolioRow; header: string; money?: boolean }[] = [
  { key: "number", header: "Project #" },
  { key: "name", header: "Project" },
  { key: "status", header: "Status" },
  { key: "client", header: "Client" },
  { key: "projectManager", header: "Project manager" },
  { key: "contractCents", header: "Contract", money: true },
  { key: "changeOrderRevenueCents", header: "Change orders", money: true },
  { key: "revenueCents", header: "Revenue", money: true },
  { key: "budgetCents", header: "Budget", money: true },
  { key: "actualCostCents", header: "Actual cost", money: true },
  { key: "forecastCostCents", header: "Forecast cost", money: true },
  { key: "projectedProfitCents", header: "Projected profit", money: true },
  { key: "marginPct", header: "Margin %" },
  { key: "completionPct", header: "% complete" },
  { key: "plannedCompletion", header: "Planned completion" },
  { key: "projectedCompletion", header: "Projected completion" },
  { key: "scheduleVarianceDays", header: "Schedule variance (days)" },
];

export function reportToCsv(report: Report): string {
  const lines = [COLUMNS.map((c) => csvCell(c.header)).join(",")];
  for (const row of report.projects) {
    lines.push(COLUMNS.map((c) => csvCell(c.money ? ((row[c.key] as number) / 100).toFixed(2) : row[c.key])).join(","));
  }
  return lines.join("\n");
}

export async function reportToXlsx(report: Report): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Pool PM";
  wb.created = new Date();
  const summary = wb.addWorksheet("Summary");
  summary.addRow([`${report.organization} — Portfolio report`]).font = { bold: true, size: 14 };
  summary.addRow([`Period ${report.range.from} to ${report.range.to}`]);
  summary.addRow([]);
  const m = report.metrics;
  const kpis: [string, string | number | null][] = [
    ["Active projects", m.activeProjects],
    ["Behind schedule", m.projectsBehindSchedule],
    ["Over budget", m.projectsOverBudget],
    ["Revenue", m.revenueCents / 100],
    ["Pipeline (estimated revenue)", m.estimatedRevenueCents / 100],
    ["Cost to date", m.costCents / 100],
    ["Projected profit", m.projectedProfitCents / 100],
    ["Change-order revenue", m.changeOrderRevenueCents / 100],
    ["Material cost", m.materialCostCents / 100],
    ["Labor utilization %", m.laborUtilizationPct],
    ["Completion rate %", m.completionRatePct],
  ];
  for (const [k, v] of kpis) summary.addRow([k, v]);
  summary.getColumn(1).width = 32;
  summary.getColumn(2).width = 18;
  summary.getColumn(2).numFmt = "#,##0.00";

  const sheet = wb.addWorksheet("Projects");
  sheet.columns = COLUMNS.map((c) => ({ header: c.header, key: c.key, width: Math.max(12, c.header.length + 2), style: c.money ? { numFmt: '"$"#,##0.00' } : {} }));
  for (const row of report.projects) {
    sheet.addRow(Object.fromEntries(COLUMNS.map((c) => [c.key, c.money ? (row[c.key] as number) / 100 : row[c.key]])));
  }
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function reportToPdf(report: Report): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", layout: "landscape", margin: 36 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(18).text(`${report.organization} — Portfolio report`);
    doc.fontSize(10).fillColor("#555").text(`Period ${report.range.from} to ${report.range.to} · generated ${report.generatedAt.slice(0, 16).replace("T", " ")} UTC`);
    doc.moveDown();
    const m = report.metrics;
    const kpis = [
      ["Active projects", String(m.activeProjects)],
      ["Behind schedule", String(m.projectsBehindSchedule)],
      ["Over budget", String(m.projectsOverBudget)],
      ["Revenue", formatCents(m.revenueCents)],
      ["Pipeline", formatCents(m.estimatedRevenueCents)],
      ["Cost to date", formatCents(m.costCents)],
      ["Projected profit", formatCents(m.projectedProfitCents)],
      ["CO revenue", formatCents(m.changeOrderRevenueCents)],
      ["Labor utilization", m.laborUtilizationPct === null ? "—" : `${m.laborUtilizationPct}%`],
    ];
    doc.fillColor("#000");
    const kpiWidth = (doc.page.width - 72) / kpis.length;
    const y = doc.y;
    kpis.forEach(([label, value], i) => {
      doc.fontSize(8).fillColor("#666").text(label!, 36 + i * kpiWidth, y, { width: kpiWidth - 6 });
      doc.fontSize(12).fillColor("#000").text(value!, 36 + i * kpiWidth, y + 12, { width: kpiWidth - 6 });
    });
    doc.moveDown(3);

    const cols: { key: keyof PortfolioRow; header: string; w: number; money?: boolean }[] = [
      { key: "number", header: "#", w: 70 },
      { key: "name", header: "Project", w: 150 },
      { key: "status", header: "Status", w: 70 },
      { key: "revenueCents", header: "Revenue", w: 75, money: true },
      { key: "actualCostCents", header: "Actual", w: 75, money: true },
      { key: "forecastCostCents", header: "Forecast", w: 75, money: true },
      { key: "projectedProfitCents", header: "Profit", w: 75, money: true },
      { key: "marginPct", header: "Margin", w: 45 },
      { key: "completionPct", header: "Done", w: 40 },
      { key: "projectedCompletion", header: "Projected", w: 65 },
    ];
    let rowY = doc.y;
    const drawRow = (values: string[], bold = false) => {
      let x = 36;
      doc.fontSize(8).font(bold ? "Helvetica-Bold" : "Helvetica");
      values.forEach((v, i) => {
        doc.text(v, x, rowY, { width: cols[i]!.w - 4, ellipsis: true, lineBreak: false });
        x += cols[i]!.w;
      });
      rowY += 14;
      if (rowY > doc.page.height - 48) {
        doc.addPage();
        rowY = 36;
      }
    };
    drawRow(cols.map((c) => c.header), true);
    for (const row of report.projects) {
      drawRow(
        cols.map((c) => {
          const v = row[c.key];
          if (v === null || v === undefined) return "—";
          if (c.money) return formatCents(v as number);
          if (c.key === "marginPct" || c.key === "completionPct") return `${v}%`;
          return String(v);
        }),
      );
    }
    doc.end();
  });
}
