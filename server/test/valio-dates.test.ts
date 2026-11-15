import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFixtureAdapter, type CatalogAdapter, type LookupResult } from "@cosign/adapters";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { JsonStore } from "../src/store.js";

describe("Valio lookup across delivery dates", () => {
  const monday = "2026-11-16";
  const wednesday = "2026-11-18";
  const friday = "2026-11-20";
  const dates = [friday, monday, wednesday];
  const ids = ["M1", "M0"];
  const fixture = createFixtureAdapter();
  const source = {
    kind: "VALIO_LIVE" as const,
    label: "injected supplier observations",
    observedAt: "2026-11-14T10:00:00Z",
    revision: 1,
  };
  const serviceError = { code: "HTTP_ERROR", detail: "Supplier availability unavailable" } as const;
  const lookup = vi.fn<CatalogAdapter["lookup"]>();
  let directory: string;
  let store: JsonStore;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "junction-valio-dates-"));
    store = new JsonStore(join(directory, "state.json"));
    await store.load();
    lookup.mockReset();
    lookup.mockImplementation(async (input) => ({ ...await fixture.lookup(input), source }));
    app = await buildApp(store, {
      adapter: {
        kind: "VALIO_LIVE",
        loadCatalog: () => fixture.loadCatalog(),
        shortlist: (query) => fixture.shortlist(query),
        signals: (productIds) => fixture.signals(productIds),
        lookup,
      },
    });
  });

  afterEach(async () => {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  });

  const compare = (requestedDates = dates, productIds = ids) => app.inject({
    method: "POST",
    url: "/api/valio/lookup/dates",
    payload: { requestedDates, productIds },
  });

  it.each([
    { name: "zero dates", dates: [], ids },
    { name: "four dates", dates: [...dates, "2026-11-22"], ids },
    { name: "duplicate dates", dates: [monday, monday], ids },
    { name: "an invalid calendar day", dates: ["2026-11-31"], ids },
    { name: "zero products", dates, ids: [] },
    { name: "thirteen products", dates, ids: Array.from({ length: 13 }, (_, index) => String(index)) },
    { name: "duplicate products after trimming", dates, ids: ["M0", " M0 "] },
    { name: "an unknown product", dates, ids: ["M0", "NOT_IN_CATALOG"] },
  ])("rejects $name before sending a supplier lookup", async ({ dates: requestedDates, ids: productIds }) => {
    const response = await compare(requestedDates, productIds);
    expect(response.statusCode, response.body).toBe(400);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("preserves the requested date and product order while reporting each day's outcome", async () => {
    lookup.mockImplementation(async (input) => {
      const result = { ...await fixture.lookup(input), source };
      if (input.requestedDate === friday) return { ...result, availability: [], errors: [serviceError] };
      if (input.requestedDate === wednesday) {
        return { ...result, prices: [], availability: [], errors: [serviceError] };
      }
      return result;
    });

    const response = await compare();
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({
      source: "VALIO_LIVE_MOCK_OBSERVATION",
      checkout: "SIMULATED_SEPARATELY",
      productIds: ids,
      shortlist: ids.map((id) => ({ product: { id } })),
      days: [
        { requestedDate: friday, status: "partial", prices: ids.map((productId) => ({ productId })), availability: [], errors: [serviceError] },
        { requestedDate: monday, status: "observed", availability: ids.map((productId) => ({ productId })), errors: [] },
        { requestedDate: wednesday, status: "unavailable", prices: [], availability: [], errors: [serviceError] },
      ],
    });
    expect(lookup.mock.calls.map(([request]) => request)).toEqual(dates.map((requestedDate) => ({
      customer: "123", requestedDate, productIds: ids,
    })));
  });

  it.each([
    { code: "HTTP_ERROR", message: "Valio lookup unavailable" },
    { code: "MISSING_API_KEY", message: "Valio lookup requires a current challenge API key" },
  ] as const)("returns 502 and date-level outcomes when every day fails with $code", async ({ code, message }) => {
    lookup.mockImplementation(async (input): Promise<LookupResult> => ({
      source,
      requestedDate: input.requestedDate,
      customer: input.customer,
      prices: [],
      availability: [],
      errors: [{ code, detail: "No supplier observations" }],
    }));

    const response = await compare();
    expect(response.statusCode, response.body).toBe(502);
    expect(response.json()).toMatchObject({
      error: message,
      days: dates.map((requestedDate) => ({
        requestedDate, status: "unavailable", prices: [], availability: [], source: { kind: "VALIO_LIVE" },
      })),
    });
  });

  it("labels explicitly supplied fixture data and leaves purchasing state untouched", async () => {
    await app.close();
    app = await buildApp(store, { adapter: fixture, enableSimulator: true });
    const previous = structuredClone(store.get());

    const response = await compare([friday, monday]);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      source: "FIXTURE_OBSERVATION",
      checkout: "SIMULATED_SEPARATELY",
      days: [friday, monday].map((requestedDate) => ({
        requestedDate,
        source: { kind: "FIXTURE" },
      })),
    });
    expect(store.get()).toEqual(previous);
  });
});
