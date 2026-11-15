import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFixtureAdapter, indexCatalog, shortlistCatalog } from "@cosign/adapters";
import { expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { JsonStore } from "../src/store.js";

it("persists a typed lactose-free requirement and applies it to an exact SKU", async () => {
  const directory = await mkdtemp(join(tmpdir(), "junction-product-search-"));
  const store = new JsonStore(join(directory, "state.json"));
  await store.load();
  const app = await buildApp(store, {
    adapter: createFixtureAdapter(), now: () => new Date("2026-11-14T10:00:00Z"),
  });
  try {
    const created = await app.inject({ method: "POST", url: "/api/requests", payload: {
      query: "lactos-free milk", productId: "M2", quantity: 10, unit: "L", diet: "none",
      budgetCents: 5000, deadline: "2026-11-16T09:00:00Z",
    } });
    expect(created.statusCode, created.body).toBe(201);
    const { requestId, diet } = created.json();
    expect(diet).toBe("lactose-free");
    const url = `/api/requests/${requestId}`;
    const saved = await app.inject({ method: "GET", url });
    expect(saved.json().request).toMatchObject({ productId: "M2", diet: "lactose-free" });
    const compared = await app.inject({ method: "POST", url: `${url}/compare` });
    expect(compared.statusCode, compared.body).toBe(200);
    expect(compared.json()).toMatchObject({ status: "no_catalog_match", observations: [] });
    const refreshed = await app.inject({ method: "POST", url: `${url}/compare` });
    expect(refreshed.statusCode, refreshed.body).toBe(200);
    const detail = await app.inject({ method: "GET", url });
    expect(detail.statusCode, detail.body).toBe(200);
    expect(detail.json()).toMatchObject({
      comparison: { version: 2, status: "no_catalog_match" }, approvedVersion: null, placedOrderId: null,
      events: [{ action: "supplier_lookup", revision: 1 }, { action: "supplier_lookup", revision: 2 }],
    });
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

it("persists combined typed and selected requirements and applies them to broad and exact searches", async () => {
  const directory = await mkdtemp(join(tmpdir(), "junction-requirements-"));
  const stateFile = join(directory, "state.json");
  const store = new JsonStore(stateFile);
  await store.load();
  const fixture = createFixtureAdapter();
  const lookup = vi.fn(fixture.lookup.bind(fixture));
  const glutenFree = { id: "FREE_FROM_GLUTEN", unit: "FREE_FROM" };
  const vegan = { id: "VEGAN", unit: "DIET" };
  function oatDrink(id: string, claims: { id: string; unit: string }[], egg?: string) {
    return { id, salesUnit: "KI", baseUnit: "KI", units: [{ unitId: "KI", sizeInBaseUnits: 1 }],
      synkkaData: {
        names: [{ language: "en", value: `Oat drink ${id}` }],
        classifications: [{ name: "nutritionalClaim", values: claims },
          ...(egg ? [{ name: egg === "FREE_FROM" ? "nonAllergen" : "allergen", values: [{ id: "AE", unit: egg }] }] : [])],
      } };
  }
  const catalog = indexCatalog([
    oatDrink("M0", [glutenFree, vegan], "FREE_FROM"), oatDrink("M1", [glutenFree, vegan], "MAY_CONTAIN"), oatDrink("M2", [glutenFree]),
  ], { label: "test", revision: 1, observedAt: "2026-11-14T10:00:00Z" });
  const app = await buildApp(store, { now: () => new Date("2026-11-14T10:00:00Z"), adapter: {
    kind: "FIXTURE", loadCatalog: async () => catalog, shortlist: async (query) => shortlistCatalog(catalog, query),
    signals: fixture.signals.bind(fixture), lookup,
  } });
  try {
    const payload = { query: "gluten-free oat drink", quantity: 10, unit: "L",
      requirements: ["vegan", "vegan"], freeFromAllergen: ["AE", "AE"], budgetCents: 5000, deadline: "2026-11-16T09:00:00Z" };
    const created = await app.inject({ method: "POST", url: "/api/requests", payload });
    expect(created.statusCode, created.body).toBe(201);
    const { requestId, requirements } = created.json();
    expect(requirements).toEqual(["gluten-free", "vegan"]);
    const reopened = new JsonStore(stateFile);
    await reopened.load();
    expect(await reopened.findRequest(requestId)).toMatchObject({ requirements, freeFromAllergen: ["AE"] });

    const broad = await app.inject({ method: "POST", url: `/api/requests/${requestId}/compare` });
    expect(broad.statusCode, broad.body).toBe(200);
    expect(broad.json().observations.map(({ productId }: { productId: string }) => productId)).toEqual(["M0"]);
    expect(lookup).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ productIds: ["M0"] }));

    const exact = await app.inject({ method: "POST", url: "/api/requests", payload: { ...payload, productId: "M1" } });
    expect(exact.statusCode, exact.body).toBe(201);
    const exactUrl = `/api/requests/${exact.json().requestId}`;
    const saved = await app.inject({ method: "GET", url: exactUrl });
    expect(saved.json().request).toMatchObject({ query: "Oat drink M1", requirements, freeFromAllergen: ["AE"] });
    const compared = await app.inject({ method: "POST", url: `${exactUrl}/compare` });
    expect(compared.statusCode, compared.body).toBe(200);
    expect(compared.json()).toMatchObject({ status: "no_catalog_match", observations: [] });
    expect(lookup).toHaveBeenCalledTimes(1);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
