import { createFixtureAdapter, indexCatalog, type CatalogAdapter } from "@cosign/adapters";
import { describe, expect, it } from "vitest";
import { estimateBudget } from "../src/intake/budget.js";
import { compareSupplierRequest } from "../src/purchasing/supplier-comparison.js";
import { supplierDecision } from "../src/purchasing/supplier-decision.js";
import type { RequestRecord } from "../src/purchasing/types.js";

const at = new Date("2026-11-14T10:00:00Z");
const request = { id: "R1", query: "Milk", quantityLiters: 2, quantity: 2, unit: "L", diet: "none",
  budgetCents: 2500, deadline: "2026-11-16T09:00:00Z", createdAt: at.toISOString() } satisfies RequestRecord;

function testAdapter({ deposits = false, variableWeight = false } = {}): CatalogAdapter {
  const fixture = createFixtureAdapter();
  const catalog = indexCatalog([{
    id: "M0", salesUnit: "KI", baseUnit: "ST", allowedLotSize: 1,
    units: [{ unitId: "KI", sizeInBaseUnits: 1 }],
    deposits: deposits ? [{ material: "BOTTLE", quantity: 1, unit: "ST" }] : [],
    synkkaData: {
      names: [{ language: "en", value: "Milk" }], variableUnit: variableWeight,
      unitConversions: [{ synkkaPackagingType: "BASE_UNIT_OR_EACH", volume: { value: 1, unit: "LTR" }, netWeight: { value: 1.15, unit: "KGM" } }],
    },
  }], { kind: "LOCAL_CATALOG", label: "fixture catalog", revision: 1, observedAt: at.toISOString() });
  const product = catalog.products.get("M0")!;
  return {
    kind: "VALIO_LIVE",
    loadCatalog: async () => catalog,
    shortlist: async () => [{ product, reasons: [], source: catalog.source }],
    signals: (ids) => fixture.signals(ids),
    lookup: async (input) => {
      const observed = await fixture.lookup(input);
      return { ...observed, source: { ...observed.source, kind: "VALIO_LIVE" } };
    },
  };
}

describe("Valio cost evidence", () => {
  it("prices a weight request using a pack's distinct declared weight", async () => {
    const weightRequest: RequestRecord = { ...request, quantity: 2.2, unit: "kg", quantityLiters: null };
    const result = await compareSupplierRequest(weightRequest, "P1", 1, testAdapter(), at);
    expect(result.observations?.[0]).toMatchObject({
      amountPerSellUnit: 1150, amountUnit: "g", litersPerSellUnit: null,
      estimate: expect.objectContaining({ salesUnits: 2, quantity: 2.3, totalCents: 2400 }),
    });
  });

  it("preserves a known product subtotal without calling it within budget when deposits are unverified", async () => {
    const adapter = testAdapter({ deposits: true });
    const result = await compareSupplierRequest(request, "P1", 1, adapter, at);
    expect(result.observations).toEqual([expect.objectContaining({
      estimate: expect.objectContaining({ totalCents: 2400, budgetFit: "unknown", stockFit: "reported_sufficient" }),
      issues: expect.arrayContaining(["DEPOSIT_CHARGES_UNVERIFIED"]),
    })]);
    expect(supplierDecision(result.observations ?? [])).toMatchObject({ outcome: "needs_confirmation", withinBudgetCount: 0, bestWithinBudget: null });
    const overBudget = await compareSupplierRequest({ ...request, budgetCents: 2300 }, "P2", 1, adapter, at);
    expect(overBudget.observations?.[0].estimate?.budgetFit).toBe("over_budget");
    expect(supplierDecision(overBudget.observations ?? []).outcome).toBe("blocked");
  });

  it("keeps variable weight quantities and final cost unverified while displaying a planning estimate", async () => {
    const adapter = testAdapter({ variableWeight: true });
    const result = await compareSupplierRequest(request, "P1", 1, adapter, at);
    expect(result.observations).toEqual([expect.objectContaining({
      estimate: expect.objectContaining({ totalCents: 2400, budgetFit: "unknown", stockFit: "unverified" }),
      issues: expect.arrayContaining(["VARIABLE_WEIGHT"]),
    })]);
    const draft = { query: request.query!, quantity: request.quantity, unit: request.unit, diet: "none" as const,
      budgetCents: null, deadline: request.deadline };
    await expect(estimateBudget(draft, adapter, at, true)).resolves.toMatchObject({
      totalCents: 2400, label: expect.stringContaining("Final weight may change the total."),
    });
    await expect(estimateBudget(draft, testAdapter({ deposits: true }), at, true)).resolves.toBeNull();
  });
});
