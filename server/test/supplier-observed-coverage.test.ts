import { describe, expect, it } from "vitest";
import { createFixtureAdapter, indexCatalog, normalizeAvailability, normalizePrice } from "@cosign/adapters";
import type { CatalogAdapter } from "@cosign/adapters";
import { compareSupplierRequest } from "../src/purchasing/supplier-comparison.js";
import type { RequestRecord } from "../src/purchasing/types.js";

const now = new Date("2026-11-14T10:00:00Z");
const deadline = "2026-11-16T09:00:00Z";
const requestedDate = "2026-11-16";

async function compare({
  availableAmount = 5, salesUnit = "KI", scheduledSalesUnit = salesUnit, availableDate = requestedDate,
  logisticModel = "Stock", closingTime = "2026-11-15T17:00:00+0200", blocked = false,
  deposits = false, variableWeight = false, priceError = false, increment = 2,
  quantity = 100, unit = "L",
}: {
  availableAmount?: number; salesUnit?: string; scheduledSalesUnit?: string; availableDate?: string;
  logisticModel?: string; closingTime?: string | null; blocked?: boolean;
  deposits?: boolean; variableWeight?: boolean; priceError?: boolean; increment?: number;
  quantity?: number; unit?: RequestRecord["unit"];
} = {}) {
  const catalog = indexCatalog([{
    id: "TEST", salesUnit, baseUnit: salesUnit === "KG" ? "KG" : "ST", allowedLotSize: increment,
    units: [{ unitId: salesUnit, sizeInBaseUnits: 1 }],
    deposits: deposits ? [{ material: "BOTTLE", quantity: 1, unit: "ST" }] : [],
    synkkaData: { names: [{ language: "en", value: "Test milk" }], variableUnit: variableWeight,
      unitConversions: [{ synkkaPackagingType: "BASE_UNIT_OR_EACH", volume: { unit: "LTR", value: 10 } }],
    },
  }], { kind: "FIXTURE", label: "fixture", revision: 1, observedAt: now.toISOString() });
  const product = catalog.products.get("TEST")!;
  const adapter: CatalogAdapter = {
    kind: "FIXTURE",
    loadCatalog: async () => catalog,
    shortlist: async () => [{ product, reasons: [], source: catalog.source }],
    signals: (ids) => createFixtureAdapter().signals(ids),
    lookup: async (input) => ({
      source: catalog.source,
      customer: input.customer,
      requestedDate: input.requestedDate,
      availability: [normalizeAvailability({
        productId: product.id, salesBlock: false, logisticModel, closingTime,
        scheduleLines: [{ salesBlock: blocked, availableAmount, availableDate, salesUnit: scheduledSalesUnit }],
      }, { catalog: product, timeNow: input.now, requestedDate: input.requestedDate, latestDeliveryAt: input.latestDeliveryAt })],
      prices: [normalizePrice({ productId: product.id, netPriceFound: false, error: priceError, quantity: 1,
        catalogPrice: { currency: "EUR", value: 12 },
      })],
      errors: [],
    }),
  };
  return compareSupplierRequest({
    id: "R", quantity, unit, quantityLiters: unit === "L" ? quantity : null, deadline,
    budgetCents: 10_000, query: "milk", diet: "none", createdAt: now.toISOString(),
  }, "P", 1, adapter, now);
}

describe("observed partial coverage", () => {
  it("rounds reported sales units down to legal lots, while the request remains uncommitted", async () => {
    const result = await compare();
    expect(result.observations?.[0].observedCoverage).toEqual({
      salesUnits: 4, salesUnitIncrement: 2, quantity: 40, coveredQuantity: 40, uncoveredQuantity: 60,
      unit: "L", productSubtotalCents: 4800, guaranteed: false,
    });
    expect(result).toMatchObject({ uncoveredQuantity: 100, uncoveredLiters: 100, checkoutSupported: false, offers: [] });
  });

  it("preserves the complete order lot and caps demand coverage when it produces surplus", async () => {
    const result = await compare({ quantity: 15, availableAmount: 8 });
    expect(result.observations?.[0].observedCoverage).toMatchObject({ salesUnits: 2, quantity: 20, coveredQuantity: 15, uncoveredQuantity: 0 });
  });

  it("supports legal fractional weight lots", async () => {
    const result = await compare({ quantity: 10, unit: "kg", salesUnit: "KG", availableAmount: 9.9, increment: 3.3 });
    expect(result.observations?.[0].observedCoverage).toMatchObject({
      salesUnits: 9.9, salesUnitIncrement: 3.3, quantity: 9.9, coveredQuantity: 9.9, uncoveredQuantity: 0.1,
      unit: "kg", productSubtotalCents: 11880,
    });
  });

  it.each([0, 1])("reports explicit zero legal units with %s reported", async (availableAmount) => {
    const result = await compare({ availableAmount });
    expect(result.observations?.[0].observedCoverage).toMatchObject({ salesUnits: 0, quantity: 0, coveredQuantity: 0, uncoveredQuantity: 100 });
  });

  it.each([{ deposits: true }, { priceError: true }])("retains quantity evidence when subtotal is unverified %j", async (input) => {
    const result = await compare(input);
    expect(result.observations?.[0].observedCoverage).toMatchObject({ coveredQuantity: 40, productSubtotalCents: null });
  });

  it.each([
    { variableWeight: true }, { logisticModel: "Terminal" }, { availableAmount: 999999 }, { blocked: true },
    { closingTime: null }, { closingTime: "2026-11-13T12:00:00Z" }, { scheduledSalesUnit: "ST" },
    { availableDate: "2026-11-15" }, { availableDate: "2026-11-17" }, { unit: "g" as const },
  ])("withholds a coverage calculation where quantity evidence is insufficient %j", async (input) => {
    const result = await compare(input);
    expect(result.observations?.[0].observedCoverage).toBeUndefined();
  });
});
