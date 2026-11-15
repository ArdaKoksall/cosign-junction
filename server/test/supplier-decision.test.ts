import { expect, it } from "vitest";
import { supplierDecision } from "../src/purchasing/supplier-decision.js";
import type { SupplierObservation } from "../src/purchasing/types.js";

function product(id: string, budgetFit: "within_budget" | "over_budget", issues: string[]): SupplierObservation {
  return {
    productId: id, name: `Test milk ${id}`, salesUnit: "KI", litersPerSellUnit: 5,
    salesUnitPriceCents: 686, availableSellUnits: null, stockUnknown: true,
    closingTime: null, availableDate: "2026-11-16", reliability: null, carbon: null, issues,
    estimate: { salesUnits: 200, liters: 1000, totalCents: budgetFit === "within_budget" ? 137200 : 150000, budgetFit, stockFit: "unverified" },
  };
}

it("surfaces the affordable Monday milk option and its expired cutoff when all candidates are blocked", () => {
  expect(supplierDecision([
    product("465039", "within_budget", ["CUTOFF_PASSED", "STOCK_UNKNOWN", "DELIVERY_TIME_UNVERIFIED"]),
    product("464398", "over_budget", ["STOCK_UNKNOWN", "DELIVERY_TIME_UNVERIFIED"]),
  ])).toMatchObject({
    outcome: "blocked", withinBudgetCount: 1,
    bestWithinBudget: {
      productId: "465039", totalCents: 137200,
      blockers: ["CUTOFF_PASSED"], openQuestions: ["STOCK_UNKNOWN", "DELIVERY_TIME_UNVERIFIED"],
    },
  });
});

it("changes the first option with buyer priority and excludes blocked, over-budget and unpriced options", () => {
  const observations = [
    { ...product("cheapest", "within_budget", ["STOCK_UNKNOWN"]), reliability: 0.9, carbon: 1.4 },
    { ...product("reliable", "within_budget", ["DELIVERY_TIME_UNVERIFIED"]), reliability: 0.96, carbon: 1.8,
      estimate: { ...product("reliable", "within_budget", []).estimate!, totalCents: 139000 } },
    { ...product("low-carbon", "within_budget", []), reliability: null, carbon: 0.8 },
    { ...product("blocked", "within_budget", ["CUTOFF_PASSED"]), reliability: 1, carbon: 0.1 },
    { ...product("expensive", "over_budget", []), reliability: 1, carbon: 0.1 },
    { ...product("unpriced", "within_budget", []), estimate: null, reliability: 1, carbon: 0.1 },
  ];
  expect(supplierDecision(observations, "reliability").ranking).toMatchObject({
    status: "ranked", candidateCount: 3, measuredCount: 2,
    preferred: { productId: "reliable", reliability: 0.96, openQuestions: ["DELIVERY_TIME_UNVERIFIED", "STOCK_UNKNOWN"] },
  });
  expect(supplierDecision(observations, "carbon").ranking).toMatchObject({
    status: "ranked", candidateCount: 3, measuredCount: 3, preferred: { productId: "low-carbon", carbon: 0.8 },
  });
  expect(supplierDecision(observations.slice(0, 2), "cost").ranking?.preferred?.productId).toBe("cheapest");
});

it("reports when candidates have no measurement for the confirmed priority", () => {
  expect(supplierDecision([product("known-price", "within_budget", [])], "carbon").ranking).toEqual({
    objective: "carbon", status: "unavailable", candidateCount: 1, measuredCount: 0,
  });
});

it("lists the nearest runner-up options when every product is blocked", () => {
  const decision = supplierDecision([
    product("sales-block", "within_budget", ["SALES_BLOCK"]),
    product("late", "within_budget", ["CUTOFF_PASSED", "DELIVERY_CONFLICT"]),
    product("pricey", "over_budget", []),
    product("conflict", "within_budget", ["DELIVERY_CONFLICT"]),
  ]);
  expect(decision.outcome).toBe("blocked");
  expect(decision.runnersUp?.map(({ productId, blockers }) => [productId, blockers])).toEqual([
    ["pricey", ["OVER_BUDGET"]],
    ["conflict", ["DELIVERY_CONFLICT"]],
    ["sales-block", ["SALES_BLOCK"]],
  ]);
});

it("does not list runner-ups when a product can go ahead", () => {
  expect(supplierDecision([product("ok", "within_budget", [])])).not.toHaveProperty("runnersUp");
});
