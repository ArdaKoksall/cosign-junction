import { afterEach, describe, expect, it, vi } from "vitest";
import { lookupSupplierDates } from "./supplierLookup";

const requestedDate = "2026-11-16";

afterEach(() => vi.unstubAllGlobals());

describe("lookupSupplierDates", () => {
  it("keeps structured evidence when every supplier date returns 502", async () => {
    const day = {
      status: "unavailable", requestedDate, source: { kind: "VALIO_LIVE", observedAt: "2026-11-14T10:00:00Z" },
      errors: [{ code: "MISSING_API_KEY", detail: "No key" }], prices: [], availability: [],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Current key required", days: [day] }), { status: 502 })));

    await expect(lookupSupplierDates(["1"], [requestedDate])).resolves.toMatchObject({
      error: "Current key required", productIds: ["1"], days: [day],
    });
  });

  it("still rejects generic server errors without date evidence", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Proxy unavailable" }), { status: 502 })));

    await expect(lookupSupplierDates(["1"], [requestedDate])).rejects.toMatchObject({ status: 502, message: "Proxy unavailable" });
  });
});
