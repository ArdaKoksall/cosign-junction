import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import * as api from "../api";
import type { SupplierLookupDay, SupplierLookupResult } from "../supplierLookup";
import type { CatalogProduct } from "../types";
import { LookupResults, SupplierLookupScreen } from "./SupplierLookupScreen";

const day: SupplierLookupDay = {
  status: "observed", requestedDate: "2026-11-16", source: { observedAt: "2026-11-14T10:00:00Z" },
  errors: [], prices: [], availability: [],
};
const product = { id: "1", displayName: "UHT milk", salesUnit: "KI", amountPerSellUnit: 1000, amountDimension: "ml" as const };

function renderResult(dates: SupplierLookupDay[]) {
  const result: SupplierLookupResult = {
    source: "VALIO_LIVE_MOCK_OBSERVATION", productIds: [product.id], shortlist: [{ product }], days: dates, signals: [],
  };
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(<LookupResults result={result} />);
  return container;
}

describe("supplier lookup evidence", () => {
  it("applies every selected requirement to catalog search before checking the chosen SKUs", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    const requirements = ["gluten-free", "vegan"] as const;
    const products: CatalogProduct[] = [
      { id: "123", name: "Cooking cream 1 L", finnishName: null, supplier: "Valio", salesUnit: "ST", amountPerSellUnit: 1000, amountDimension: "ml", verifiedLactoseFree: false, requirements: [...requirements] },
      { id: "456", name: "Cooking cream 500 mL", finnishName: null, supplier: "Valio", salesUnit: "ST", amountPerSellUnit: 500, amountDimension: "ml", verifiedLactoseFree: false, requirements: [...requirements] },
    ];
    const browse = vi.spyOn(api, "getCatalogProducts").mockResolvedValue({ products, hasMore: false, lactoseFreeRequired: false, requirements: [...requirements] });
    const lookup = vi.fn();
    try {
      act(() => root.render(<SupplierLookupScreen date={day.requestedDate} onDate={() => {}} result={null} busy={false} onLookup={lookup} />));
      expect(container.querySelectorAll(".lookup-items li")).toHaveLength(0);
      const options = [...container.querySelectorAll(".lookup-requirements label")];
      for (const label of ["Gluten-free", "Vegan"]) {
        const option = options.find((item) => item.textContent?.trim() === label)!;
        act(() => option.querySelector("input")!.click());
      }
      const input = container.querySelector<HTMLInputElement>('input[type="text"]')!;
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "cooking cream");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => vi.advanceTimersByTimeAsync(250));
      const matches = () => [...container.querySelectorAll<HTMLButtonElement>(".catalog-suggestions-inline li button")];
      expect(browse).toHaveBeenCalledTimes(1);
      expect(browse).toHaveBeenCalledWith("cooking cream", 5, expect.objectContaining({ requirements: [...requirements] }), expect.any(AbortSignal), { closest: true });
      expect(matches()).toHaveLength(2);
      act(() => matches()[0]!.click());
      expect(matches()).toHaveLength(1);
      act(() => matches()[0]!.click());
      expect([...container.querySelectorAll(".lookup-items li strong")].map((item) => item.textContent)).toEqual([
        "Cooking cream 1 L · 123", "Cooking cream 500 mL · 456",
      ]);
      act(() => container.querySelector<HTMLButtonElement>('button[type="submit"]')!.click());
      expect(lookup).toHaveBeenCalledWith(["123", "456"], [day.requestedDate]);
    } finally {
      act(() => root.unmount());
      container.remove();
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it("uses a packaging barcode to find the actual challenge product ID", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    const lookup = vi.fn();
    const browse = vi.spyOn(api, "getCatalogProducts").mockResolvedValue({
      products: [{ id: "463038", name: "Milk", finnishName: null, supplier: "Valio", salesUnit: "KI",
        amountPerSellUnit: 20000, amountDimension: "ml", verifiedLactoseFree: true, requirements: ["lactose-free"] }],
      hasMore: false, lactoseFreeRequired: false, requirements: [],
    });
    try {
      act(() => root.render(<SupplierLookupScreen date={day.requestedDate} onDate={() => {}} result={null} busy={false} onLookup={lookup} />));
      const input = container.querySelector<HTMLInputElement>('input[type="text"]')!;
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "6408430100330");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => vi.advanceTimersByTimeAsync(250));
      expect(browse).toHaveBeenCalledWith("6408430100330", 5, expect.any(Object), expect.any(AbortSignal), { closest: true });
      const submit = container.querySelector<HTMLButtonElement>('button[type="submit"]')!;
      expect(submit.disabled).toBe(true);
      act(() => container.querySelector<HTMLButtonElement>(".catalog-suggestions-inline li button")!.click());
      act(() => submit.click());
      expect(lookup).toHaveBeenCalledWith(["463038"], [day.requestedDate]);
    } finally {
      act(() => root.unmount());
      container.remove();
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it("keeps stock on a supplier's different schedule date outside the requested-date stock field", () => {
    const container = renderResult([{ ...day, availability: [{
      productId: "1", usable: false, stockUnknown: false, availableSellUnits: 24, salesUnit: "KI", availableDate: "2026-11-18",
      errors: [{ code: "DELIVERY_CONFLICT", detail: "availableDate differs from requestedDate" }],
    }] }]);
    expect(container.querySelector(".lookup-primary-facts")?.textContent).toContain("Reported stock on requested dateUnverified");
    expect(container.querySelector(".lookup-secondary-facts")?.textContent).toContain("Supplier schedule date18 Nov 2026Stock on schedule date24 KI");
    expect(container.textContent).toContain("Supplier returned a different date.");
  });

  it("preserves price observations during an availability outage and separates unavailable dates", () => {
    const container = renderResult([
      {
        ...day, status: "partial", errors: [{ code: "HTTP_ERROR", endpoint: "availability", detail: "failure" }],
        prices: [{ productId: "1", usable: true, salesUnitPriceExVat: { cents: 550 }, netPriceFound: false, errors: [] }],
      },
      { ...day, status: "unavailable", requestedDate: "2026-11-18" },
    ]);
    expect(container.querySelector("[aria-label='Supplier feeds by requested date']")?.textContent).toContain("Availability feed unavailable.");
    expect(container.querySelector(".lookup-primary-facts dd")?.textContent).toMatch(/5\.50/);
    expect(container.querySelector(".lookup-primary-facts div:nth-child(2) dd")?.textContent).toBe("Feed unavailable");
    expect(container.querySelector(".lookup-date-card[data-state=unavailable]")?.textContent).toContain("No observations for this date.");
  });

  it("never labels unknown stock or a different unit as a reported count", () => {
    const stock = {
      productId: "1", usable: false, availableDate: day.requestedDate, stockUnknown: true, availableSellUnits: 999_999, salesUnit: "KI",
      errors: [{ code: "STOCK_UNKNOWN", detail: "sentinel" }],
    };
    const container = renderResult([
      { ...day, availability: [stock] },
      { ...day, requestedDate: "2026-11-18", availability: [{
        ...stock, availableDate: "2026-11-18", stockUnknown: false, availableSellUnits: 50, salesUnit: "ST",
        errors: [{ code: "UNIT_MISMATCH", detail: "different unit" }],
      }] },
    ]);
    expect([...container.querySelectorAll(".lookup-primary-facts div:nth-child(2) dd")].map((node) => node.textContent)).toEqual(["Unverified", "Unverified"]);
    expect(container.querySelector(".lookup-result-list")?.textContent).not.toMatch(/999.?999|50 ST/);
  });

  it("keeps usable stock from a partial feed and distinguishes a sales block from the reported quantity", () => {
    const container = renderResult([{
      ...day, status: "partial", errors: [{ code: "INVALID_RESPONSE", endpoint: "availability", detail: "invalid product row" }],
      availability: [{ productId: "1", usable: false, stockUnknown: false, availableDate: day.requestedDate, salesUnit: "KI",
        availableSellUnits: 24, logisticModel: "Stock", closingTime: "2026-11-15T09:00:00+0200", timeNow: "2026-11-14T12:00:00+0200",
        salesBlock: false, scheduleSalesBlock: true, errors: [{ code: "SALES_BLOCK", detail: "schedule sales block" }] }],
    }]);
    expect(container.querySelector(".lookup-feed-list")?.textContent).toContain("Some availability records could not be used.");
    expect(container.querySelector(".lookup-feed-list")?.textContent).toContain("Supplier response time");
    expect(container.querySelector(".lookup-primary-facts div:nth-child(2) dd")?.textContent).toBe("24 KI");
    expect(container.querySelector(".lookup-order-status")?.textContent).toBe("Sales blocked");
  });

  it("shows dated price terms and distinguishes terminal logistics from actual stock", () => {
    const container = renderResult([{
      ...day,
      prices: [{ productId: "1", usable: true, salesUnitPriceExVat: { cents: 1000 }, salesUnitPriceIncVat: { cents: 1135 },
        taxPerSalesUnitCents: 135, taxRatePercent: 13.5, pricingDate: "2026-11-16T00:00:00+0200",
        validFrom: "2026-11-14T00:00:00+0200", validTo: "2026-11-30T00:00:00+0200", netPriceFound: false, errors: [] }],
      availability: [{ productId: "1", usable: false, stockUnknown: false, availableDate: day.requestedDate, salesUnit: "KI",
        availableSellUnits: 24, logisticModel: "Terminal", cutoffPassed: true, closingTime: "2026-11-14T09:00:00+0200",
        errors: [{ code: "CUTOFF_PASSED", detail: "elapsed" }, { code: "STOCK_UNKNOWN", detail: "terminal" }] }],
    }]);
    expect(container.querySelector(".lookup-primary-facts div:nth-child(2) dd")?.textContent).toBe("Unverified");
    expect(container.querySelector(".lookup-order-status")?.textContent).toBe("Cutoff passed");
    expect(container.textContent).toContain("Terminal (supplier warehouse)");
    expect(container.textContent).toContain("1 L per sales unit");
    expect(container.querySelector(".lookup-price-details")?.textContent).toContain("VAT rate13.5%");
    expect(container.querySelector(".lookup-price-details")?.textContent).toContain("Unit price valid from14 Nov 2026Unit price valid through30 Nov 2026");
  });
});
