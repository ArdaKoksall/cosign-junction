import { describe, expect, it, vi } from "vitest";
import { createLiveAdapter } from "./live.js";

const request = {
  customer: "123", requestedDate: "2026-11-20", productIds: ["ONE", "TWO"], now: "2026-11-14T08:00:00Z",
};
const date = "2026-11-19T22:00:00Z"; // Midnight on 20 Nov in Helsinki.
const cutoff = "2026-11-19T17:00:00+0200";
const money = { value: 2.50, valueWithTax: 2.84, currency: "EUR", validFrom: "2026-11-01", validTo: "2026-11-30" };
const schedule = { salesBlock: false, salesUnit: "ST", availableDate: date, availableAmount: 14 };
const priced = (productId: string) => ({ productId, quantity: 1, error: false, netPriceFound: true, catalogPrice: money });
const available = (productId: string) => ({ productId, salesBlock: false, closingTime: cutoff, logisticModel: "Stock", scheduleLines: [schedule] });
const price = { customerId: "123", currency: "EUR", pricingDate: date, products: [priced("TWO"), priced("ONE")] };
const availability = { timeNow: "2026-11-14T10:00:00+0200", requestedDate: date, products: [available("TWO"), available("ONE")] };

function lookup(priceBody: unknown = price, availabilityBody: unknown = availability) {
  const fetchImpl: typeof fetch = async (url, init) => {
    expect(init?.redirect).toBe("error");
    const body = String(url).endsWith("/price") ? priceBody : availabilityBody;
    return body instanceof Response ? body : Response.json(body);
  };
  return createLiveAdapter({ apiKey: "test", fetchImpl }).lookup(request);
}

describe("Valio response evidence", () => {
  it("joins requested product IDs in order and uses Helsinki days for timestamped fields", async () => {
    const result = await lookup();
    expect(result.errors).toEqual([]);
    expect(result.prices.map(({ productId }) => productId)).toEqual(request.productIds);
    expect(result.availability.map(({ productId }) => productId)).toEqual(request.productIds);
    expect(result.availability[0]).toMatchObject({ usable: true, availableDate: request.requestedDate, availableSellUnits: 14 });
  });

  it.each([
    { ...price, products: [priced("TWO"), priced("TWO")] },
    { ...price, products: [priced("ONE"), priced("UNKNOWN")] },
    { ...price, pricingDate: "2026-11-16" },
    { ...price, customerId: "wrong-customer" },
    { ...price, currency: "USD" },
    { ...price, products: [priced("ONE"), null] },
    new Response("bad JSON", { status: 200 }),
  ])("rejects a mismatched price response without losing availability", async (priceBody) => {
    const result = await lookup(priceBody);
    expect(result.errors).toMatchObject([{ endpoint: "price", code: "INVALID_RESPONSE" }]);
    expect(result.prices).toEqual([]);
    expect(result.availability).toHaveLength(2);
  });

  it("retains matched price and availability evidence when the supplier omits a product", async () => {
    const result = await lookup({ ...price, products: [priced("ONE")] }, {
      ...availability, products: [available("ONE")],
    });
    expect(result.prices).toMatchObject([{ productId: "ONE", usable: true }]);
    expect(result.availability).toMatchObject([{ productId: "ONE", usable: true }]);
    expect(result.errors).toMatchObject([
      { endpoint: "price", code: "INVALID_RESPONSE" },
      { endpoint: "availability", code: "INVALID_RESPONSE" },
    ]);
  });

  it("retains identifiable valid rows when another product record is malformed", async () => {
    const result = await lookup(
      { ...price, products: [priced("ONE"), { ...priced("TWO"), quantity: "1" }] },
      { ...availability, products: [available("TWO"), { ...available("ONE"), scheduleLines: [null] }] },
    );
    expect(result.errors).toMatchObject([
      { endpoint: "price", code: "INVALID_RESPONSE" },
      { endpoint: "availability", code: "INVALID_RESPONSE" },
    ]);
    expect(result.prices).toMatchObject([{ productId: "ONE", usable: true }]);
    expect(result.availability).toMatchObject([{ productId: "TWO", usable: true }]);
  });

  it("keeps a good price response when availability returns an upstream error", async () => {
    const result = await lookup(price, new Response("unavailable", { status: 503 }));
    expect(result.errors).toMatchObject([{ endpoint: "availability", code: "HTTP_ERROR", httpStatus: 503 }]);
    expect(result.prices.every(({ usable }) => usable)).toBe(true);
  });

  it.each(["3", "Sat, 14 Nov 2026 08:00:03 GMT"])("honors the supplier's Retry-After value %s for that endpoint", async (header) => {
    const start = Date.parse(request.now);
    const clock = vi.spyOn(Date, "now").mockReturnValue(start);
    let priceCalls = 0;
    let availabilityCalls = 0;
    const adapter = createLiveAdapter({ apiKey: "test", fetchImpl: async (url, init) => {
      if (!String(url).endsWith("/price")) {
        availabilityCalls++;
        return Response.json(availability);
      }
      priceCalls++;
      if (priceCalls === 1) return new Response(null, { status: 429, headers: { "Retry-After": header } });
      const { customer } = JSON.parse(String(init?.body));
      return Response.json({ ...price, customerId: customer });
    } });
    try {
      const first = await adapter.lookup(request);
      expect(first.errors).toMatchObject([{ endpoint: "price", httpStatus: 429, retryAfterMs: 3_000 }]);
      clock.mockReturnValue(start + 500);
      const duringCooldown = await adapter.lookup(request);
      expect(duringCooldown.errors).toMatchObject([{ endpoint: "price", httpStatus: 429, retryAfterMs: 2_500 }]);
      expect(duringCooldown.prices).toEqual([]);
      expect(duringCooldown.availability).toHaveLength(2);
      expect(priceCalls).toBe(1);
      expect(availabilityCalls).toBe(2);

      clock.mockReturnValue(start + 3_000);
      const fresh = await adapter.lookup({ ...request, customer: "other-customer" });
      expect(fresh.errors).toEqual([]);
      expect(fresh.prices).toHaveLength(2);
      expect(priceCalls).toBe(2);
      expect(availabilityCalls).toBe(3);
    } finally {
      clock.mockRestore();
    }
  });

  it("can request prices without calling availability", async () => {
    const urls: string[] = [];
    const result = await createLiveAdapter({ apiKey: "test", fetchImpl: async (url) => {
      urls.push(String(url));
      return Response.json(price);
    } }).lookup({ ...request, priceOnly: true });
    expect(urls).toEqual([expect.stringMatching(/\/api\/price$/)]);
    expect(result.errors).toEqual([]);
    expect(result.prices).toHaveLength(2);
    expect(result.availability).toEqual([]);
  });

  it("cancels the upstream price request with the caller's signal", async () => {
    const controller = new AbortController();
    let upstreamSignal: AbortSignal | null | undefined;
    const adapter = createLiveAdapter({ apiKey: "test", fetchImpl: async (_url, init) => {
      upstreamSignal = init?.signal;
      controller.abort();
      upstreamSignal?.throwIfAborted();
      return Response.json(price);
    } });
    const result = await adapter.lookup({ ...request, priceOnly: true, signal: controller.signal });
    expect(upstreamSignal?.aborted).toBe(true);
    expect(result.errors).toMatchObject([{ endpoint: "price", code: "HTTP_ERROR" }]);
    expect(result.prices).toEqual([]);
  });

  it.each([
    [{ availableDate: "2026-11-16" }, "DELIVERY_CONFLICT"],
    [{ availableDate: "2026-11-21" }, "DELIVERY_CONFLICT"],
    [{ availableDate: "2026-11-31" }, "DELIVERY_CONFLICT"],
    [{ availableDate: null }, "DELIVERY_CONFLICT"],
    [{ salesBlock: true }, "SALES_BLOCK"],
  ])("blocks unusable schedule evidence %j", async (line, code) => {
    const result = await lookup(price, { ...availability, products: [available("TWO"), {
      ...available("ONE"), scheduleLines: [{ ...schedule, ...line }],
    }] });
    expect(result.availability[0]).toMatchObject({ usable: false, errors: [{ code }] });
  });

  it("does not report a valid cutoff or known stock from ambiguous, invalid or terminal evidence", async () => {
    const result = await lookup(price, { ...availability, products: [
      { ...available("ONE"), logisticModel: "Terminal", closingTime: "bad cutoff" },
      { ...available("TWO"), scheduleLines: [schedule, schedule] },
    ] });
    expect(result.availability[0]).toMatchObject({ usable: false, stockUnknown: true,
      errors: [{ code: "CUTOFF_UNVERIFIED" }, { code: "STOCK_UNKNOWN" }],
    });
    expect(result.availability[1]).toMatchObject({ usable: false, stockUnknown: true, errors: [{ code: "DELIVERY_CONFLICT" }] });
  });

  it("uses the later clock to prevent elapsed cutoffs becoming usable", async () => {
    const result = await lookup(price, { ...availability, timeNow: "2026-11-19T17:01:00+0200" });
    expect(result.availability[0]).toMatchObject({ usable: false, cutoffPassed: true });
  });

  it.each([null, "Other", "Terminal"])("withholds a stock number for logistic model %s", async (logisticModel) => {
    const result = await lookup(price, { ...availability, products: [
      { ...available("ONE"), logisticModel, scheduleLines: [{ ...schedule, availableAmount: 0 }] }, available("TWO"),
    ] });
    expect(result.availability[0]).toMatchObject({ usable: false, stockUnknown: true, errors: [{ code: "STOCK_UNKNOWN" }] });
    expect(result.availability[0].availableSellUnits).toBeUndefined();
    expect(result.availability[1]).toMatchObject({ usable: true, availableSellUnits: 14 });
  });

  it.each([
    { catalogPrice: { ...money, validTo: "2026-11-19" } },
    { catalogPrice: { ...money, validFrom: "2026-11-20T01:00:00+0200" } },
    { catalogPrice: { ...money, currency: "USD" } },
    { catalogPrice: { ...money, value: -1 } },
    { catalogPrice: { ...money, value: 1e18 } },
    { quantity: 2 },
  ])("withholds unusable sales-unit price %j", async (override) => {
    const result = await lookup({ ...price, products: [{ ...priced("ONE"), ...override }, priced("TWO")] });
    expect(result.prices[0]).toMatchObject({ usable: false, errors: [{ code: "PRICE_UNUSABLE" }] });
    expect(result.prices[0].salesUnitPriceExVat).toBeUndefined();
    expect(result.prices[1].usable).toBe(true);
  });

  it("validates gross, comparison, list and tax evidence independently of a usable ex-VAT price", async () => {
    const result = await lookup({ ...price, products: [{
      ...priced("ONE"),
      catalogPrice: { ...money, valueWithTax: null },
      priceWithTax: { ...money, value: 2.84, validTo: "2026-11-19" },
      comparisonPrice: { ...money, value: 1.25, validFrom: "2026-11-20T01:00:00+0200" }, comparisonUnit: "KG",
      listPrice: { ...money, value: 3.25, validTo: "2026-11-19" },
      tax: { taxRate: -13.5, taxValue: 0.34 },
    }, {
      ...priced("TWO"),
      priceWithTax: { ...money, value: 2.84 },
      comparisonPrice: { ...money, value: 1.25 }, comparisonUnit: "KG",
      listPrice: { ...money, value: 3.25 },
      tax: { taxRate: 13.5, taxValue: 0.34 },
    }] });
    expect(result.prices[0]).toMatchObject({ usable: true, salesUnitPriceExVat: { cents: 250 } });
    for (const key of ["salesUnitPriceIncVat", "comparisonPrice", "listPriceExVat", "taxRatePercent", "taxPerSalesUnitCents"] as const) {
      expect(result.prices[0][key]).toBeUndefined();
    }
    expect(result.prices[1]).toMatchObject({ usable: true, salesUnitPriceIncVat: { cents: 284 }, comparisonPrice: { cents: 125 },
      listPriceExVat: { cents: 325 }, taxRatePercent: 13.5, taxPerSalesUnitCents: 34 });
  });

  it("withholds conflicting VAT-inclusive amounts while keeping the ex-VAT sales-unit price", async () => {
    const result = await lookup({ ...price, products: [
      { ...priced("ONE"), priceWithTax: { ...money, value: 2.9 }, tax: { taxRate: 100, taxValue: 0.34 } }, priced("TWO"),
    ] });
    expect(result.prices[0]).toMatchObject({ usable: true, salesUnitPriceExVat: { cents: 250 } });
    expect(result.prices[0].salesUnitPriceIncVat).toBeUndefined();
    expect(result.prices[0].taxRatePercent).toBeUndefined();
  });
});
