import { describe, expect, it } from "vitest";
import { recommendBasket } from "../src/purchasing/basket-plan.js";
import type { SupplierObservation } from "../src/purchasing/types.js";

const early = "2026-11-16";
const later = "2026-11-18";

function offer(productId: string, availableDate: string, totalCents: number, units = 1, stock = 10): SupplierObservation {
  return {
    productId, name: productId, salesUnit: "ST", litersPerSellUnit: null, salesUnitPriceCents: totalCents / units,
    availableSellUnits: stock, stockUnknown: false, closingTime: "2026-11-15T12:00:00Z", availableDate,
    deliveryStatus: "estimated", reliability: null, carbon: null, issues: [],
    estimate: { salesUnits: units, totalCents, budgetFit: "within_budget", stockFit: "reported_sufficient" },
  };
}

describe("dated basket planning", () => {
  it("finds a later affordable date when each early line fits individually but the sum does not", () => {
    const plan = recommendBasket([
      { itemId: "one", offers: [offer("A", early, 700), offer("A", later, 400)] },
      { itemId: "two", offers: [offer("B", early, 700), offer("B", later, 400)] },
    ], 1_000);
    expect(plan).toEqual({
      status: "feasible", totalCents: 800,
      selections: [
        { itemId: "one", productId: "A", availableDate: later },
        { itemId: "two", productId: "B", availableDate: later },
      ],
      explanation: {
        basis: "earliest_completion_then_lowest_total", completionDate: later, priceOptimal: true,
      },
    });
  });

  it("checks combined stock for repeated SKU selections on a single date", () => {
    const dayOneOffer = offer("A", early, 700, 3, 4);
    const dayTwoOffer = offer("A", later, 700, 3, 4);
    expect(recommendBasket([
      { itemId: "one", offers: [dayOneOffer] },
      { itemId: "two", offers: [dayOneOffer] },
    ], 2_000)).toMatchObject({ status: "blocked" });
    expect(recommendBasket([
      { itemId: "one", offers: [dayOneOffer] },
      { itemId: "two", offers: [dayOneOffer, dayTwoOffer] },
    ], 2_000)).toMatchObject({ status: "feasible", totalCents: 1_400, selections: [
      { itemId: "one", productId: "A", availableDate: early },
      { itemId: "two", productId: "A", availableDate: later },
    ] });
  });

  it("prefers completing the basket earlier when both dates fit the budget", () => {
    expect(recommendBasket([
      { itemId: "one", offers: [offer("A", later, 300), offer("A", early, 600)] },
    ], 1_000)).toMatchObject({ status: "feasible", totalCents: 600, selections: [
      { itemId: "one", productId: "A", availableDate: early },
    ] });
  });

  it("finds the lowest feasible total on the earliest day when the cheapest options share stock", () => {
    expect(recommendBasket([
      { itemId: "one", offers: [offer("shared", early, 100, 1, 1), offer("A", early, 200)] },
      { itemId: "two", offers: [offer("shared", early, 100, 1, 1), offer("B", early, 1_000), offer("B", later, 10)] },
    ])).toEqual({
      status: "feasible", totalCents: 300,
      selections: [
        { itemId: "one", productId: "A", availableDate: early },
        { itemId: "two", productId: "shared", availableDate: early },
      ],
      explanation: {
        basis: "earliest_completion_then_lowest_total", completionDate: early, priceOptimal: true,
      },
    });
  });

  it("returns a feasible fallback without claiming optimal pricing when the search limit is reached", () => {
    const shared = offer("shared", early, 0, 1, 1);
    const lines = [
      { itemId: "one", offers: [shared, offer("alternative", early, 1)] },
      ...Array.from({ length: 6 }, (_, line) => ({
        itemId: `filler-${line}`,
        offers: Array.from({ length: 6 }, (_, option) => offer(`filler-${line}-${option}`, early, 0)),
      })),
      {
        itemId: "last",
        offers: [shared, ...Array.from({ length: 6 }, (_, option) => offer(`backup-${option}`, early, 100))],
      },
    ];
    expect(recommendBasket(lines)).toMatchObject({
      status: "feasible", totalCents: 100,
      selections: expect.arrayContaining([
        { itemId: "one", productId: "shared", availableDate: early },
        { itemId: "last", productId: "backup-0", availableDate: early },
      ]),
      explanation: { completionDate: early, priceOptimal: false },
    });
    expect(recommendBasket(lines, 0)).toMatchObject({ status: "unresolved" });
  });

  it("uses safe integer totals when there is no buyer budget cap", () => {
    const maximum = Number.MAX_SAFE_INTEGER;
    expect(recommendBasket([
      { itemId: "one", offers: [offer("A", early, maximum - 1)] },
      { itemId: "two", offers: [offer("B", early, 1)] },
    ])).toMatchObject({ status: "feasible", totalCents: maximum });
    expect(recommendBasket([
      { itemId: "one", offers: [offer("A", early, maximum - 1)] },
      { itemId: "two", offers: [offer("B", early, 2)] },
    ])).toMatchObject({ status: "blocked" });
  });
});
