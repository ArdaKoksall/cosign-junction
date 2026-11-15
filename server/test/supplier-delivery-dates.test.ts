import { describe, expect, it } from "vitest";
import {
  indexCatalog, normalizeAvailability, normalizePrice,
  type CatalogAdapter, type LookupRequest, type LookupResult,
} from "@cosign/adapters";
import { compareSupplierRequest, compareSupplierRequests } from "../src/purchasing/supplier-comparison.js";
import type { RequestRecord } from "../src/purchasing/types.js";

const at = new Date("2026-11-15T22:15:00Z");
const firstDay = "2026-11-16";
const deadlineDay = "2026-12-06";
const deadline = `${deadlineDay}T18:00:00+02:00`;
const source = { kind: "FIXTURE", label: "Delivery test", revision: 1, observedAt: at.toISOString() } as const;
const catalog = indexCatalog(["A", "B", "C", "D"].map(id => ({
  id, salesUnit: "ST", baseUnit: "ST", allowedLotSize: 1,
  units: [{ unitId: "ST", sizeInBaseUnits: 1 }],
  synkkaData: { names: [{ language: "en", value: `Product ${id}` }] },
})), source);

function compare(
  ids: string[],
  schedule: (id: string, requestedDate: string) => string | undefined,
  errors: (input: LookupRequest) => LookupResult["errors"] = () => [],
  cost: (id: string, requestedDate: string) => number = (_id, requestedDate) => requestedDate === firstDay ? 1 : 3,
  options: { stock?: (id: string, date: string) => number; deliveryMode?: RequestRecord["deliveryMode"] } = {},
) {
  const calls: { date: string; ids: string[] }[] = [];
  const adapter: CatalogAdapter = {
    kind: "FIXTURE",
    loadCatalog: async () => catalog,
    shortlist: async ({ productIds }) => (productIds ?? []).map(id => ({
      product: catalog.products.get(id)!, reasons: [], source,
    })),
    signals: async () => [],
    lookup: async input => {
      const { customer, requestedDate, productIds } = input;
      calls.push({ date: requestedDate, ids: productIds });
      const issues = errors(input);
      return {
        source, customer, requestedDate, errors: issues,
        availability: issues.length ? [] : productIds.map(id => {
          const availableDate = schedule(id, requestedDate);
          return normalizeAvailability({
            productId: id, salesBlock: false, logisticModel: "Stock", closingTime: "2026-11-16T12:00:00Z",
            scheduleLines: availableDate ? [{
              availableDate, availableAmount: options.stock?.(id, requestedDate) ?? 8, salesBlock: false, salesUnit: "ST",
            }] : [],
          }, { catalog: catalog.products.get(id), timeNow: input.now, requestedDate });
        }),
        prices: issues.length ? [] : productIds.map(id => normalizePrice({
          productId: id, netPriceFound: false, error: false, quantity: 1,
          catalogPrice: { currency: "EUR", value: cost(id, requestedDate) },
        })),
      };
    },
  };
  const entries = ids.map((productId, index) => {
    const request: RequestRecord = {
      id: `R${index}`, productId, quantity: 2, unit: "each", quantityLiters: null, deadline,
      deliveryMode: options.deliveryMode,
      budgetCents: 10_000, diet: "none", createdAt: at.toISOString(),
    };
    return { request, proposalId: `P${index}` };
  });
  const result = entries.length === 1
    ? compareSupplierRequest(entries[0].request, entries[0].proposalId, 1, adapter, at).then(proposal => [proposal])
    : compareSupplierRequests(entries, 1, adapter, at);
  return { calls, result };
}

describe("staggered supplier delivery dates", () => {
  it("batches dates across items and uses the price observed for each chosen date", async () => {
    const expectedDays: Record<string, string> = { A: "2026-11-22", B: "2026-11-18", C: deadlineDay, D: "2026-11-22" };
    const { calls, result } = compare(["A", "B", "C", "D"], (id, requested) =>
      id === "C" && requested === firstDay ? undefined : requested === deadlineDay ? deadlineDay : expectedDays[id]);
    const proposals = await result;
    expect(proposals.map(proposal => proposal.observations?.[0])).toEqual(["A", "B", "C", "D"].map(productId =>
      expect.objectContaining({
        productId, availableDate: expectedDays[productId],
        deliveryStatus: expectedDays[productId] === deadlineDay ? "time_unverified" : "estimated",
        salesUnitPriceCents: 300,
      })));
    expect(calls).toEqual([
      { date: firstDay, ids: ["A", "B", "C", "D"] },
      { date: deadlineDay, ids: ["A", "B", "C", "D"] },
      { date: "2026-11-18", ids: ["B"] },
      { date: "2026-11-22", ids: ["A", "D"] },
    ]);
  });

  it("separates verified late dates from suggestions that the supplier did not confirm", async () => {
    const lateDay = "2026-12-07";
    const suggestion = "2026-11-18";
    const { result } = compare(["A", "B"], (id, requested) =>
      id === "A" ? lateDay : requested === firstDay ? suggestion : undefined);
    const [late, unknown] = await result;
    expect(late.observations?.[0]).toMatchObject({
      availableDate: lateDay, deliveryStatus: "after_deadline", issues: expect.arrayContaining(["DELIVERY_CONFLICT"]),
    });
    expect(unknown.observations?.[0]).toMatchObject({ deliveryStatus: "unverified", salesUnitPriceCents: null });
  });

  it("keeps usable observations and stops checking additional dates after rate limiting", async () => {
    const { calls, result } = compare(["A", "B"], (id, requested) =>
      id === "A" ? requested : "2026-11-18", ({ requestedDate }) =>
      requestedDate === deadlineDay ? [{
        code: "HTTP_ERROR", detail: "supplier asked us to slow down", endpoint: "price", httpStatus: 429, retryAfterMs: 5_000,
      }] : []);
    const [available, unknown] = await result;
    expect(available.observations?.[0]).toMatchObject({ availableDate: firstDay, deliveryStatus: "estimated" });
    expect(unknown.observations?.[0]).toMatchObject({ deliveryStatus: "unverified" });
    expect(calls).toEqual([{ date: firstDay, ids: ["A", "B"] }, { date: deadlineDay, ids: ["A", "B"] }]);
  });

  it("continues past an expensive date when a later date fits the budget", async () => {
    const { result } = compare(["A"], (_id, date) => date, () => [], (_id, date) => date === firstDay ? 60 : 3, { deliveryMode: "by" });
    const [proposal] = await result;
    expect(proposal.observations?.[0]).toMatchObject({
      availableDate: deadlineDay, deliveryStatus: "time_unverified", estimate: { totalCents: 600, budgetFit: "within_budget" },
    });
  });

  it("checks date hints even when the mismatched response reports too little stock", async () => {
    const suggestion = "2026-11-20";
    const { result, calls } = compare(["A", "B"], (id, requested) =>
      id === "A" && requested === firstDay ? suggestion : requested,
    () => [], undefined, { stock: (id, day) => id === "A" ? day === suggestion ? 8 : 1 : 8 });
    const [proposal] = await result;
    expect(proposal.observations?.[0]).toMatchObject({ availableDate: suggestion, deliveryStatus: "estimated" });
    expect(calls[2]).toEqual({ date: suggestion, ids: ["A"] });
  });

  it("retains multiple checked dates when both independently fit the line budget", async () => {
    const { result } = compare(["A", "B"], (_id, requested) => requested, () => [], (_id, date) => date === firstDay ? 7 : 4);
    const proposals = await result;
    for (const proposal of proposals) {
      expect(proposal.deliveryOffers).toMatchObject([
        { availableDate: firstDay, salesUnitPriceCents: 700 },
        { availableDate: deadlineDay, salesUnitPriceCents: 400 },
      ]);
    }
  });

  it("honors explicit delivery intent for an individual item", async () => {
    const by = compare(["A"], (_id, date) => date, () => [], undefined, { deliveryMode: "by" });
    const on = compare(["A"], (_id, date) => date, () => [], undefined, { deliveryMode: "on" });
    const [[byProposal], [onProposal]] = await Promise.all([by.result, on.result]);
    expect(byProposal.observations?.[0]).toMatchObject({ availableDate: firstDay, deliveryStatus: "estimated" });
    expect(onProposal.observations?.[0]).toMatchObject({ availableDate: deadlineDay, deliveryStatus: "time_unverified" });
    expect(on.calls).toEqual([{ date: deadlineDay, ids: ["A"] }]);
  });
});
