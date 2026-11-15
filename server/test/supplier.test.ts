import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFixtureAdapter, type CatalogAdapter } from "@cosign/adapters";
import { buildApp } from "../src/app.js";
import { simulatorAccess } from "../src/routes/simulator-access.js";
import { JsonStore } from "../src/store.js";

describe("connected supplier workflow (synthetic responses in tests only)", () => {
  let directory: string;
  let store: JsonStore;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let adapter: CatalogAdapter;
  let lookup: ReturnType<typeof vi.fn<CatalogAdapter["lookup"]>>;
  const deadline = "2026-11-16T09:00:00Z";

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "junction-supplier-"));
    store = new JsonStore(join(directory, "state.json"));
    await store.load();
    const fixture = createFixtureAdapter();
    lookup = vi.fn((input) => fixture.lookup(input));
    adapter = {
      kind: "VALIO_LIVE",
      loadCatalog: () => fixture.loadCatalog(),
      shortlist: (query) => fixture.shortlist(query),
      signals: (ids) => fixture.signals(ids),
      lookup,
    };
    app = await buildApp(store, { adapter, now: () => new Date("2026-11-14T10:00:00Z") });
  });

  afterEach(async () => {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  });

  async function create(query = "20 L") {
    const response = await app.inject({ method: "POST", url: "/api/requests", payload: { query, quantityLiters: 75, deadline, diet: "lactose-free", budgetCents: 50000 } });
    expect(response.statusCode).toBe(201);
    return response.json().requestId;
  }

  const buyerHeaders = { authorization: "Bearer test-buyer" };
  const agentHeaders = { authorization: "Bearer test-agent" };

  async function enableRehearsal(now = () => new Date("2026-11-14T10:00:00Z")) {
    await app.close();
    app = await buildApp(store, { adapter, now, rehearsalActor: simulatorAccess("test-buyer", "test-agent") });
  }

  it("browses a bounded catalog and filters verified claims without requesting live quotes", async () => {
    const first = await app.inject({ method: "GET", url: "/api/valio/catalog?query=milk&limit=1&volumeOnly=true" });
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json()).toEqual({
      hasMore: true,
      lactoseFreeRequired: false,
      requirements: [],
      products: [expect.objectContaining({ id: "M0", amountDimension: "ml", amountPerSellUnit: 10000 })],
    });
    const all = await app.inject({ method: "GET", url: "/api/valio/catalog?query=milk" });
    expect(all.json().products).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "M0", verifiedLactoseFree: true }),
      expect.objectContaining({ id: "M2", verifiedLactoseFree: false }),
      expect.objectContaining({ id: "M3", verifiedLactoseFree: false }),
    ]));
    const filtered = await app.inject({ method: "GET", url: "/api/valio/catalog?query=milk&lactoseFreeOnly=true" });
    expect(filtered.json().products.map(({ id }: { id: string }) => id)).toEqual(["M0", "M1", "M4", "TERM"]);
    const invalid = await app.inject({ method: "GET", url: "/api/valio/catalog?limit=49" });
    expect(invalid.statusCode).toBe(400);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("queries only catalog matches and refreshes observations without manufacturing an order", async () => {
    const id = await create();
    const compared = await app.inject({ method: "POST", url: `/api/requests/${id}/compare` });
    expect(compared.statusCode, compared.body).toBe(200);
    const proposal = compared.json();
    expect(lookup).toHaveBeenCalledWith(expect.objectContaining({ productIds: ["M4"], requestedDate: "2026-11-16" }));
    expect(proposal.comparisonMode).toBe("supplier_observations");
    expect(proposal.checkoutSupported).toBe(false);
    expect(proposal.offers).toEqual([]);
    expect(proposal.uncoveredLiters).toBe(75);
    expect(proposal.observations).toEqual([expect.objectContaining({
      productId: "M4",
      litersPerSellUnit: 20,
      salesUnitPriceCents: 2800,
      estimate: { salesUnits: 4, liters: 80, quantity: 80, unit: "L", totalCents: 11200, budgetFit: "within_budget", stockFit: "reported_sufficient" },
      issues: expect.arrayContaining(["DELIVERY_TIME_UNVERIFIED"]),
    })]);
    const refreshed = await app.inject({ method: "POST", url: `/api/requests/${id}/compare` });
    expect(refreshed.json().version).toBe(2);
    expect(lookup).toHaveBeenCalledTimes(2);
    for (const action of ["approve", "commit"]) {
      const result = await app.inject({ method: "POST", url: `/api/proposals/${proposal.proposalId}/${action}`, payload: { version: 2, idempotencyKey: "not-an-order" } });
      expect(result.statusCode).toBe(501);
    }
    const history = await app.inject({ method: "GET", url: "/api/orders" });
    expect(history.json()).toEqual({ orders: [] });
    expect(Object.keys(store.get().orders)).toHaveLength(0);
  });

  it("persists the exact selected product and keeps the diet gate on its only candidate", async () => {
    const input = { quantity: 2, unit: "case", deadline: "2026-11-16T09:00:00Z", diet: "lactose-free", budgetCents: 50000 };
    const invalid = await app.inject({ method: "POST", url: "/api/requests", payload: { ...input, productId: "unknown" } });
    expect(invalid.statusCode).toBe(400);
    const createExact = (productId: string) => app.inject({ method: "POST", url: "/api/requests", payload: { ...input, productId } });

    const selected = await createExact("M1");
    expect(selected.statusCode, selected.body).toBe(201);
    const url = `/api/requests/${selected.json().requestId}`;
    const compared = await app.inject({ method: "POST", url: `${url}/compare` });
    expect(compared.json().observations.map(({ productId }: { productId: string }) => productId)).toEqual(["M1"]);
    expect(lookup).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ productIds: ["M1"] }));
    const saved = await app.inject({ method: "GET", url });
    const name = (await adapter.loadCatalog()).products.get("M1")?.displayName;
    expect(saved.json().request).toMatchObject({ productId: "M1", query: name });

    const nonmatching = await createExact("M2");
    expect(nonmatching.statusCode).toBe(201);
    const rejected = await app.inject({ method: "POST", url: `/api/requests/${nonmatching.json().requestId}/compare` });
    expect(rejected.json()).toMatchObject({ status: "no_catalog_match", observations: [] });
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it("keeps matching products visible when their pack cannot be converted to the requested quantity", async () => {
    const shortlist = await adapter.shortlist({ query: "milk" });
    const alternatives = shortlist.filter(({ product }) => ["M0", "M1", "M2"].includes(product.id)).map((item) =>
      item.product.id === "M1"
        ? { ...item, product: { ...item.product, amountPerSellUnit: null, amountDimension: "unmapped" as const } }
        : item);
    vi.spyOn(adapter, "shortlist").mockResolvedValueOnce(alternatives.reverse());
    const id = await create("lactos-free milk");
    const result = await app.inject({ method: "POST", url: `/api/requests/${id}/compare` });
    expect(result.statusCode, result.body).toBe(200);
    expect(lookup).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ productIds: ["M0", "M1"] }));
    expect(result.json().observations).toEqual([
      expect.objectContaining({ productId: "M0", estimate: expect.objectContaining({ liters: 80 }) }),
      expect.objectContaining({ productId: "M1", estimate: null, issues: expect.arrayContaining(["VOLUME_UNMAPPED"]) }),
    ]);
  });

  it("saves a weight request and budgets for full supplier minimum lots by kilogram", async () => {
    const { products } = await adapter.loadCatalog();
    const product = { ...products.get("M0")!, id: "CHICKEN", displayName: "Chicken breast", salesUnit: "KG", baseUnit: "KG",
      amountPerSellUnit: 1000, amountDimension: "g" as const, allowedLotSize: 4.4, claims: [] };
    vi.spyOn(adapter, "shortlist").mockResolvedValue([{ product, reasons: ["QUERY_MATCH"], source: { kind: "FIXTURE", label: "fixture", observedAt: "2026-11-14T10:00:00Z", revision: 1 } }]);
    lookup.mockImplementationOnce(async (input) => {
      const observed = await createFixtureAdapter().lookup({ ...input, productIds: ["M0"] });
      return { ...observed, prices: observed.prices.map((price) => ({ ...price, productId: product.id })),
        availability: observed.availability.map((stock) => ({ ...stock, productId: product.id, salesUnit: "KG" })) };
    });
    const created = await app.inject({ method: "POST", url: "/api/requests", payload: {
      query: "Chicken breast", quantity: 10.5, unit: "kg", diet: "none", budgetCents: 16_000, deadline: "2026-11-16T09:00:00Z",
    } });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json().requestId;
    const result = await app.inject({ method: "POST", url: `/api/requests/${id}/compare` });
    expect(result.statusCode, result.body).toBe(200);
    expect(lookup).toHaveBeenCalledWith(expect.objectContaining({ productIds: [product.id] }));
    const saved = await app.inject({ method: "GET", url: `/api/requests/${id}` });
    expect(saved.json()).toMatchObject({
      request: { query: "Chicken breast", quantity: 10.5, unit: "kg", diet: "none", quantityLiters: null },
      comparison: { uncoveredLiters: null, uncoveredQuantity: 10.5, uncoveredUnit: "kg", observations: [{
        productId: product.id, amountPerSellUnit: 1000, amountUnit: "g", litersPerSellUnit: null,
        estimate: { salesUnits: 13.2, quantity: 13.2, unit: "kg", totalCents: 15840, budgetFit: "within_budget", stockFit: "reported_sufficient" },
      }] },
    });
  });

  it("keeps empty searches empty and performs no broad supplier scan", async () => {
    const id = await create("zzzz-no-match");
    const result = await app.inject({ method: "POST", url: `/api/requests/${id}/compare` });
    expect(result.statusCode).toBe(200);
    expect(result.json().status).toBe("no_catalog_match");
    expect(result.json().observations).toEqual([]);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("keeps the buyer-confirmed priority in saved comparisons and the decision trail", async () => {
    const input = { query: "20 L", quantityLiters: 75, deadline: "2026-11-16T09:00:00Z", diet: "lactose-free", budgetCents: 50000 };
    const rejected = await app.inject({ method: "POST", url: "/api/requests", payload: { ...input, rankingObjective: "ignore-budget" } });
    expect(rejected.statusCode).toBe(400);
    const created = await app.inject({ method: "POST", url: "/api/requests", payload: { ...input, rankingObjective: "cost" } });
    expect(created.statusCode, created.body).toBe(201);
    const requestUrl = `/api/requests/${created.json().requestId}`;
    const compared = await app.inject({ method: "POST", url: `${requestUrl}/compare` });
    expect(compared.statusCode, compared.body).toBe(200);
    expect(compared.json().decision.ranking).toMatchObject({
      objective: "cost", status: "ranked", candidateCount: 1, measuredCount: 1,
      preferred: { productId: "M4", totalCents: 11200, openQuestions: ["DELIVERY_TIME_UNVERIFIED"] },
    });
    const detail = await app.inject({ method: "GET", url: requestUrl });
    expect(detail.json().request.rankingObjective).toBe("cost");
    expect(detail.json().comparison).toEqual(compared.json());
    expect(detail.json().events).toContainEqual(expect.objectContaining({ action: "supplier_ranking", outcome: "RANKED", revision: 1 }));
  });

  it("keeps a persisted supplier comparison read-only after starting in simulator mode", async () => {
    const requestId = await create();
    const compareUrl = `/api/requests/${requestId}/compare`;
    const compared = await app.inject({ method: "POST", url: compareUrl });
    expect(compared.statusCode, compared.body).toBe(200);
    const { proposalId, version } = compared.json();
    const proposalUrl = `/api/proposals/${proposalId}`;

    await app.close();
    store = new JsonStore(join(directory, "state.json"));
    await store.load();
    app = await buildApp(store, { adapter, enableSimulator: true, now: () => new Date("2026-11-14T10:00:00Z") });

    const approve = await app.inject({ method: "POST", url: `${proposalUrl}/approve`, payload: { version } });
    expect(approve.statusCode, approve.body).toBe(409);
    const reprice = await app.inject({ method: "POST", url: "/api/demo/price-change", payload: { proposalId } });
    expect(reprice.statusCode, reprice.body).toBe(409);
    expect((await app.inject({ method: "POST", url: compareUrl })).json()).toEqual(compared.json());

    // A prior version could leave a supplier comparison in the approved state.
    await store.mutate((state) => {
      state.proposals[proposalId].status = "approved";
      state.proposals[proposalId].approvedVersion = version;
    });
    const commit = await app.inject({ method: "POST", url: `${proposalUrl}/commit`, payload: { version, idempotencyKey: "supplier-observation" } });
    expect(commit.statusCode, commit.body).toBe(409);
    expect(store.get().orders).toEqual({});
  });

  it("carries a connected comparison through buyer approval and simulated checkout on the same request", async () => {
    await enableRehearsal();
    const requestId = await create();
    const path = `/api/requests/${requestId}`;
    const compared = await app.inject({ method: "POST", url: `${path}/compare` });
    expect(compared.json()).toMatchObject({
      checkoutSupported: false, rehearsalCandidates: ["M4"], comparisonMode: "supplier_observations",
    });
    const payload = { productId: "M4", version: 1 };
    const quote = (headers = buyerHeaders, input = payload) => app.inject({
      method: "POST", url: `${path}/rehearsal`, payload: input, headers,
    });
    expect((await quote({ authorization: "" })).statusCode).toBe(401);
    expect((await quote(agentHeaders)).statusCode).toBe(403);
    expect((await quote(buyerHeaders, { ...payload, productId: "outside-shortlist" })).statusCode).toBe(409);
    expect((await quote(buyerHeaders, { ...payload, version: 2 })).statusCode).toBe(409);

    const { proposalId: sourceId } = compared.json();
    expect((await app.inject({
      method: "POST", url: `/api/proposals/${sourceId}/approve`, payload: { version: 1 }, headers: buyerHeaders,
    })).statusCode).toBe(409);
    const started = await quote();
    expect(started.statusCode, started.body).toBe(201);
    const first = started.json();
    expect(first).toMatchObject({
      requestId, version: 1, status: "proposed", totalCents: 11200, source: "CONNECTED_REHEARSAL",
      rehearsal: {
        productId: "M4", requestedQuantity: 75, requestedDeadline: deadline, quantity: 80, unit: "L",
        salesUnits: 4, salesUnitPriceCents: 2800, supplierComparisonId: sourceId, supplierComparisonVersion: 1,
        caveats: ["DELIVERY_TIME_UNVERIFIED"],
      },
    });
    expect(first.proposalId).not.toBe(sourceId);
    expect((await quote()).json()).toEqual(first);
    const checkout = (action: "approve" | "commit", version: number, headers = buyerHeaders) => app.inject({
      method: "POST", url: `/api/proposals/${first.proposalId}/${action}`, headers,
      payload: { version, ...(action === "commit" && { idempotencyKey: "rehearsal-attempt" }) },
    });
    expect((await checkout("approve", 1, agentHeaders)).statusCode).toBe(403);
    expect((await checkout("commit", 1)).statusCode).toBe(409);
    expect((await checkout("approve", 1)).statusCode).toBe(200);
    expect((await quote()).json().status).toBe("approved");

    // The live refresh cannot change the fixed price or approval on its own.
    const fixture = createFixtureAdapter();
    lookup.mockImplementationOnce(async (input) => {
      const result = await fixture.lookup(input);
      return { ...result, prices: result.prices.map((price) => ({
        ...price, salesUnitPriceExVat: { currency: "EUR", basis: "VAT_EXCLUSIVE", cents: 3000 },
      })) };
    });
    const refresh = await app.inject({ method: "POST", url: `${path}/compare` });
    expect(refresh.json()).toMatchObject({ proposalId: sourceId, version: 2 });
    const currentQuote = await app.inject({ url: `${path}/rehearsal`, headers: buyerHeaders });
    expect(currentQuote.json()).toMatchObject({ quote: { totalCents: 11200 }, approvedVersion: 1, placedOrderId: null });

    // An explicit selection against updated evidence makes a new approval necessary.
    expect((await quote()).statusCode).toBe(409);
    const requote = await quote(buyerHeaders, { ...payload, version: 2 });
    expect(requote.json()).toMatchObject({ proposalId: first.proposalId, version: 2, totalCents: 12000, status: "proposed" });
    expect((await checkout("approve", 1)).statusCode).toBe(409);
    expect((await checkout("commit", 2)).statusCode).toBe(409);
    expect((await checkout("approve", 2)).statusCode).toBe(200);
    const [placed, retried] = await Promise.all([checkout("commit", 2), checkout("commit", 2)]);
    expect(placed.statusCode, placed.body).toBe(201);
    const receipt = placed.json();
    expect(receipt).toMatchObject({
      simulated: true, status: "placed", totalCents: 12000,
      rehearsal: { productId: "M4", supplierComparisonVersion: 2, requestedDeadline: deadline },
    });
    expect(retried.json()).toEqual(receipt);
    expect(Object.keys(store.get().orders)).toHaveLength(1);

    expect((await app.inject({ url: `${path}/rehearsal` })).statusCode).toBe(401);
    expect((await app.inject({ url: `/api/orders/${receipt.orderId}`, headers: agentHeaders })).statusCode).toBe(403);
    expect((await app.inject({ url: `/api/orders/${receipt.orderId}`, headers: buyerHeaders })).json()).toEqual(receipt);
    const publicDetail = (await app.inject({ url: path })).json();
    expect(publicDetail).toMatchObject({ comparison: refresh.json(), placedOrderId: null, approvedVersion: null });
    expect(publicDetail.events.map(({ action }: { action: string }) => action)).toEqual(["supplier_lookup", "supplier_lookup"]);
    const privateDetail = (await app.inject({ url: `${path}/rehearsal`, headers: buyerHeaders })).json();
    expect(privateDetail).toMatchObject({ placedOrderId: receipt.orderId, approvedVersion: 2 });
    expect(privateDetail.events.map(({ action }: { action: string }) => action)).toEqual([
      "rehearsal_quote", "approve", "rehearsal_quote", "approve", "commit",
    ]);

    const legacy = store.get();
    Reflect.deleteProperty(legacy.proposals[first.proposalId].rehearsal!, "requestedDeadline");
    Reflect.deleteProperty(legacy.orders[receipt.orderId].rehearsal!, "requestedDeadline");
    await writeFile(join(directory, "state.json"), JSON.stringify(legacy));
    await store.load();
    expect((await store.findRehearsalByRequest(requestId))?.rehearsal?.requestedDeadline).toBe(deadline);
    expect((await store.findOrder(receipt.orderId))?.rehearsal?.requestedDeadline).toBe(deadline);
  });

  it("checks the observed cutoff again before connected approval and checkout", async () => {
    let current = new Date("2026-11-14T10:00:00Z");
    await enableRehearsal(() => current);
    const id = await create();
    const path = `/api/requests/${id}`;
    const compared = await app.inject({ method: "POST", url: `${path}/compare` });
    expect(compared.json().rehearsalCandidates).toEqual(["M4"]);
    const { proposalId } = (await app.inject({
      method: "POST", url: `${path}/rehearsal`, headers: buyerHeaders,
      payload: { version: 1, productId: "M4" },
    })).json();
    expect((await app.inject({
      method: "POST", url: `/api/proposals/${proposalId}/approve`, headers: buyerHeaders, payload: { version: 1 },
    })).statusCode).toBe(200);
    current = new Date("2026-11-15T15:00:00Z");
    const blocked = await app.inject({
      method: "POST", url: `/api/proposals/${proposalId}/commit`, headers: buyerHeaders, payload: { version: 1, idempotencyKey: "closed" },
    });
    expect(blocked.statusCode, blocked.body).toBe(409);
    expect(blocked.json().error).toContain("cutoff");
    expect((await app.inject({ url: path })).json().comparison.rehearsalCandidates).toEqual([]);
  });

  it("carries unknown stock as a caveat and blocks a known stock shortfall", async () => {
    await enableRehearsal();
    const fixture = createFixtureAdapter();
    lookup.mockImplementationOnce(async (input) => {
      const result = await fixture.lookup(input);
      return { ...result, availability: result.availability.map((entry) => ({
        ...entry, availableSellUnits: undefined, stockUnknown: true,
      })) };
    }).mockImplementationOnce(async (input) => {
      const result = await fixture.lookup(input);
      return { ...result, availability: result.availability.map((entry) => ({
        ...entry, availableSellUnits: 3,
      })) };
    });
    const id = await create();
    const path = `/api/requests/${id}`;
    const compare = () => app.inject({ method: "POST", url: `${path}/compare` });
    const quote = (version: number) => app.inject({
      method: "POST", url: `${path}/rehearsal`, headers: buyerHeaders, payload: { version, productId: "M4" },
    });
    const unknown = await compare();
    expect(unknown.json().rehearsalCandidates).toEqual(["M4"]);
    const accepted = await quote(1);
    expect(accepted.statusCode, accepted.body).toBe(201);
    expect(accepted.json().rehearsal.caveats).toContain("STOCK_UNKNOWN");
    const shortfall = await compare();
    expect(shortfall.json().rehearsalCandidates).toEqual([]);
    expect((await quote(2)).statusCode).toBe(409);
  });

  it("fails a supplier outage without falling back to the fixed basket", async () => {
    lookup.mockImplementation(async ({ customer, requestedDate, now }) => ({
      customer, requestedDate,
      source: { kind: "VALIO_LIVE", label: "Supplier outage fixture", observedAt: now ?? deadline, revision: 1 },
      prices: [], availability: [], errors: [{ code: "HTTP_ERROR", detail: "unavailable" }],
    }));
    const id = await create();
    const result = await app.inject({ method: "POST", url: `/api/requests/${id}/compare` });
    expect(result.statusCode).toBe(502);
    expect(store.get().proposals).toEqual({});
  });

  it("saves other requests during slow lookup and keeps a newer comparison when the older one finishes", async () => {
    const id = await create();
    let announceStart!: () => void;
    let allowFinish!: () => void;
    const started = new Promise<void>((resolve) => { announceStart = resolve; });
    const release = new Promise<void>((resolve) => { allowFinish = resolve; });
    const fixture = createFixtureAdapter();
    lookup.mockImplementationOnce(async (input) => {
      announceStart();
      await release;
      return fixture.lookup(input);
    });
    const compare = () => app.inject({ method: "POST", url: `/api/requests/${id}/compare` });
    const older = compare().then((response) => response.json());
    await started;
    try {
      expect(await create()).not.toBe(id);
      const newer = await compare();
      expect(newer.statusCode, newer.body).toBe(200);
      expect(newer.json().version).toBe(1);
      allowFinish();
      expect(await older).toEqual(newer.json());
    } finally {
      allowFinish();
      await older;
    }
  });

  it("keeps the later refresh when both started at the same clock time and finish in start order", async () => {
    const id = await create();
    let announceStart!: () => void;
    let announceNewer!: () => void;
    let allowFinish!: () => void;
    let allowNewerFinish!: () => void;
    const started = new Promise<void>((resolve) => { announceStart = resolve; });
    const newerStarted = new Promise<void>((resolve) => { announceNewer = resolve; });
    const release = new Promise<void>((resolve) => { allowFinish = resolve; });
    const releaseNewer = new Promise<void>((resolve) => { allowNewerFinish = resolve; });
    const fixture = createFixtureAdapter();
    lookup.mockImplementationOnce(async (input) => {
      announceStart();
      await release;
      return fixture.lookup(input);
    }).mockImplementationOnce(async (input) => {
      announceNewer();
      await releaseNewer;
      const result = await fixture.lookup(input);
      return { ...result, prices: result.prices.map((price) => ({ ...price, salesUnitPriceExVat: { currency: "EUR", basis: "VAT_EXCLUSIVE", cents: 3000 } })) };
    });

    const compare = () => app.inject({ method: "POST", url: `/api/requests/${id}/compare` });
    const older = compare().then((response) => response.json());
    await started;
    const newer = compare().then((response) => response.json());
    await newerStarted;
    try {
      allowFinish();
      expect(await older).toMatchObject({ version: 1, observations: [{ salesUnitPriceCents: 2800 }] });
      allowNewerFinish();
      const updated = await newer;
      expect(updated).toMatchObject({ version: 2, observations: [{ salesUnitPriceCents: 3000 }] });
      expect(updated).not.toHaveProperty("observationSequence");
      const saved = await app.inject({ method: "GET", url: `/api/requests/${id}` });
      expect(saved.json().comparison).toEqual(updated);
    } finally {
      allowFinish();
      allowNewerFinish();
      await Promise.all([older, newer]);
    }
  });

  it("disables fixture mutation endpoints and declares the real capability boundary by default", async () => {
    const capabilities = await app.inject({ method: "GET", url: "/api/capabilities" });
    expect(capabilities.json()).toMatchObject({ mode: "valio_challenge", simulatorEnabled: false, supplierCheckout: false });
    for (const path of ["/api/demo/reset", "/api/demo/price-change"]) {
      expect((await app.inject({ method: "POST", url: path, payload: {} })).statusCode).toBe(501);
    }
  });
});
