import { BUDGET_CATEGORIES, type BudgetCategory, type ChangeOrderStatus } from "@pool/types";
import { REVENUE_CHANGE_ORDER_STATUSES } from "./change-orders";

/**
 * Project financial roll-up. All amounts are integer cents.
 *
 * Revenue  = contract amount + price of approved/scheduled/completed change orders
 * Budget   = sum(budget items) + contingency + cost of approved change orders
 * Actual   = expenses + labor (hours × hourly cost) + installed/used materials
 * Forecast = per category, max(estimate, actual)  (estimate at completion)
 */

export interface BudgetItemInput {
  category: BudgetCategory;
  estimatedCents: number;
}

export interface ExpenseInputLike {
  category: BudgetCategory;
  amountCents: number;
}

export interface LaborInputLike {
  hours: number;
  hourlyCostCents: number;
}

export interface MaterialUsageLike {
  quantityUsed: number;
  quantityPlanned: number;
  unitCostCents: number;
}

export interface ChangeOrderLike {
  status: ChangeOrderStatus;
  costCents: number;
  priceCents: number;
}

export interface BudgetInput {
  contractAmountCents: number;
  contingencyPct: number;
  items: BudgetItemInput[];
  expenses: ExpenseInputLike[];
  labor: LaborInputLike[];
  materials: MaterialUsageLike[];
  changeOrders: ChangeOrderLike[];
  /** Alert when actual cost exceeds this % of the total budget. */
  alertThresholdPct?: number;
}

export interface CategorySummary {
  category: BudgetCategory;
  estimatedCents: number;
  actualCents: number;
  varianceCents: number;
  forecastCents: number;
  pctUsed: number | null;
}

export interface BudgetAlert {
  level: "warning" | "critical";
  code: "category_over_budget" | "threshold_exceeded" | "over_budget" | "negative_margin";
  message: string;
  category?: BudgetCategory;
}

export interface BudgetSummary {
  revenueCents: number;
  contractAmountCents: number;
  changeOrderRevenueCents: number;
  changeOrderCostCents: number;
  baseBudgetCents: number;
  contingencyCents: number;
  totalBudgetCents: number;
  actualCostCents: number;
  remainingBudgetCents: number;
  forecastCostCents: number;
  /** Positive = under budget. */
  costVarianceCents: number;
  projectedProfitCents: number;
  /** Projected margin, 0–100 (can be negative). Null when revenue is zero. */
  projectedMarginPct: number | null;
  pctBudgetUsed: number | null;
  byCategory: CategorySummary[];
  alerts: BudgetAlert[];
}

const pct = (num: number, den: number): number | null => (den === 0 ? null : Math.round((num / den) * 1000) / 10);

export function laborCostCents(entry: LaborInputLike): number {
  return Math.round(entry.hours * entry.hourlyCostCents);
}

export function computeBudgetSummary(input: BudgetInput): BudgetSummary {
  const estimated = new Map<BudgetCategory, number>(BUDGET_CATEGORIES.map((c) => [c, 0]));
  const actual = new Map<BudgetCategory, number>(BUDGET_CATEGORIES.map((c) => [c, 0]));

  for (const item of input.items) estimated.set(item.category, estimated.get(item.category)! + item.estimatedCents);
  for (const e of input.expenses) actual.set(e.category, actual.get(e.category)! + e.amountCents);
  const labor = input.labor.reduce((sum, l) => sum + laborCostCents(l), 0);
  actual.set("labor", actual.get("labor")! + labor);
  const materials = input.materials.reduce((sum, m) => sum + Math.round(m.quantityUsed * m.unitCostCents), 0);
  actual.set("materials", actual.get("materials")! + materials);

  const revenueCOs = input.changeOrders.filter((co) => REVENUE_CHANGE_ORDER_STATUSES.includes(co.status));
  const changeOrderRevenueCents = revenueCOs.reduce((s, co) => s + co.priceCents, 0);
  const changeOrderCostCents = revenueCOs.reduce((s, co) => s + co.costCents, 0);

  const baseBudgetCents = [...estimated.values()].reduce((a, b) => a + b, 0);
  const contingencyCents = Math.round((baseBudgetCents * input.contingencyPct) / 100);
  const totalBudgetCents = baseBudgetCents + contingencyCents + changeOrderCostCents;
  const actualCostCents = [...actual.values()].reduce((a, b) => a + b, 0);

  const byCategory: CategorySummary[] = BUDGET_CATEGORIES.map((category) => {
    const est = estimated.get(category)!;
    const act = actual.get(category)!;
    return {
      category,
      estimatedCents: est,
      actualCents: act,
      varianceCents: est - act,
      forecastCents: Math.max(est, act),
      pctUsed: pct(act, est),
    };
  });

  // Forecast: categories at max(estimate, actual), plus change-order cost and
  // any contingency not yet absorbed by overruns.
  const categoryForecast = byCategory.reduce((s, c) => s + c.forecastCents, 0);
  const overrun = Math.max(0, categoryForecast - baseBudgetCents);
  const unusedContingency = Math.max(0, contingencyCents - overrun);
  const forecastCostCents = categoryForecast + changeOrderCostCents + unusedContingency;

  const revenueCents = input.contractAmountCents + changeOrderRevenueCents;
  const projectedProfitCents = revenueCents - forecastCostCents;
  const pctBudgetUsed = pct(actualCostCents, totalBudgetCents);

  const alerts: BudgetAlert[] = [];
  for (const c of byCategory) {
    if (c.estimatedCents > 0 && c.actualCents > c.estimatedCents) {
      alerts.push({
        level: "warning",
        code: "category_over_budget",
        category: c.category,
        message: `${c.category} is over budget by ${formatCents(c.actualCents - c.estimatedCents)}`,
      });
    }
  }
  const threshold = input.alertThresholdPct ?? 90;
  if (actualCostCents > totalBudgetCents && totalBudgetCents > 0) {
    alerts.push({
      level: "critical",
      code: "over_budget",
      message: `Actual cost exceeds the total budget by ${formatCents(actualCostCents - totalBudgetCents)}`,
    });
  } else if (pctBudgetUsed !== null && pctBudgetUsed >= threshold) {
    alerts.push({
      level: "warning",
      code: "threshold_exceeded",
      message: `${pctBudgetUsed}% of the budget has been spent (alert threshold ${threshold}%)`,
    });
  }
  if (revenueCents > 0 && projectedProfitCents < 0) {
    alerts.push({ level: "critical", code: "negative_margin", message: "Project is forecast to lose money" });
  }

  return {
    revenueCents,
    contractAmountCents: input.contractAmountCents,
    changeOrderRevenueCents,
    changeOrderCostCents,
    baseBudgetCents,
    contingencyCents,
    totalBudgetCents,
    actualCostCents,
    remainingBudgetCents: totalBudgetCents - actualCostCents,
    forecastCostCents,
    costVarianceCents: totalBudgetCents - forecastCostCents,
    projectedProfitCents,
    projectedMarginPct: pct(projectedProfitCents, revenueCents),
    pctBudgetUsed,
    byCategory,
    alerts,
  };
}

export function formatCents(cents: number, currency = "USD", locale = "en-US"): string {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

export function parseMoneyToCents(input: string): number | null {
  const cleaned = input.replace(/[^0-9.-]/g, "");
  if (!cleaned || !/^-?\d*(\.\d{0,2})?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? Math.round(value * 100) : null;
}
