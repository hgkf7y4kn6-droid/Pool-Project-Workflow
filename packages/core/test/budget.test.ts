import { describe, expect, it } from "vitest";
import { computeBudgetSummary, formatCents, parseMoneyToCents } from "../src/budget";

const base = {
  contractAmountCents: 100_000_00,
  contingencyPct: 5,
  items: [
    { category: "labor" as const, estimatedCents: 20_000_00 },
    { category: "materials" as const, estimatedCents: 30_000_00 },
    { category: "subcontractor" as const, estimatedCents: 25_000_00 },
  ],
  expenses: [] as { category: "materials" | "subcontractor" | "equipment"; amountCents: number }[],
  labor: [] as { hours: number; hourlyCostCents: number }[],
  materials: [] as { quantityUsed: number; quantityPlanned: number; unitCostCents: number }[],
  changeOrders: [] as { status: "approved" | "draft" | "rejected"; costCents: number; priceCents: number }[],
};

describe("computeBudgetSummary", () => {
  it("computes budget, contingency and margin for an untouched project", () => {
    const s = computeBudgetSummary(base);
    expect(s.baseBudgetCents).toBe(75_000_00);
    expect(s.contingencyCents).toBe(3_750_00);
    expect(s.totalBudgetCents).toBe(78_750_00);
    expect(s.actualCostCents).toBe(0);
    expect(s.forecastCostCents).toBe(78_750_00);
    expect(s.projectedProfitCents).toBe(21_250_00);
    expect(s.projectedMarginPct).toBe(21.3);
    expect(s.alerts).toEqual([]);
  });

  it("rolls up actuals from expenses, labor and materials", () => {
    const s = computeBudgetSummary({
      ...base,
      expenses: [
        { category: "subcontractor", amountCents: 10_000_00 },
        { category: "equipment", amountCents: 500_00 },
      ],
      labor: [{ hours: 40, hourlyCostCents: 45_00 }],
      materials: [{ quantityUsed: 10, quantityPlanned: 12, unitCostCents: 100_00 }],
    });
    expect(s.actualCostCents).toBe(10_000_00 + 500_00 + 1_800_00 + 1_000_00);
    const labor = s.byCategory.find((c) => c.category === "labor")!;
    expect(labor.actualCents).toBe(1_800_00);
    expect(labor.pctUsed).toBe(9);
  });

  it("adds approved change orders only", () => {
    const s = computeBudgetSummary({
      ...base,
      changeOrders: [
        { status: "approved", costCents: 2_000_00, priceCents: 3_500_00 },
        { status: "draft", costCents: 9_000_00, priceCents: 9_000_00 },
        { status: "rejected", costCents: 1_000_00, priceCents: 1_000_00 },
      ],
    });
    expect(s.changeOrderRevenueCents).toBe(3_500_00);
    expect(s.revenueCents).toBe(103_500_00);
    expect(s.totalBudgetCents).toBe(80_750_00);
  });

  it("raises category, threshold and margin alerts", () => {
    const s = computeBudgetSummary({
      ...base,
      contractAmountCents: 60_000_00,
      expenses: [{ category: "materials", amountCents: 72_000_00 }],
      alertThresholdPct: 80,
    });
    const codes = s.alerts.map((a) => a.code);
    expect(codes).toContain("category_over_budget");
    expect(codes).toContain("threshold_exceeded");
    expect(codes).toContain("negative_margin");
    expect(s.forecastCostCents).toBe(20_000_00 + 72_000_00 + 25_000_00 + 0);
  });
});

describe("money helpers", () => {
  it("formats and parses cents", () => {
    expect(formatCents(123456)).toBe("$1,234.56");
    expect(parseMoneyToCents("$1,234.5")).toBe(123450);
    expect(parseMoneyToCents("abc")).toBeNull();
    expect(parseMoneyToCents("1.234")).toBeNull();
  });
});
