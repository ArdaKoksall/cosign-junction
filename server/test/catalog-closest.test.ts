import { createFixtureAdapter, indexCatalog, shortlistCatalog } from "@cosign/adapters";
import { afterAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { JsonStore } from "../src/store.js";

const source = { label: "Closest match route catalog", revision: 1, observedAt: "2026-11-14T10:00:00Z" };
const catalog = indexCatalog([
  {
    id: "croissant", salesUnit: "ST", baseUnit: "ST", units: [{ unitId: "ST", sizeInBaseUnits: 1 }],
    synkkaData: {
      names: [{ language: "en", value: "Butter croissant" }],
      unitConversions: [{ synkkaPackagingType: "BASE_UNIT_OR_EACH", netWeight: { value: 0.06, unit: "KGM" } }],
      classifications: [{ name: "allergen", values: [{ id: "AW", unit: "CONTAINS" }] }],
    },
  },
  {
    id: "chicken", salesUnit: "ST", baseUnit: "ST", units: [{ unitId: "ST", sizeInBaseUnits: 1 }],
    synkkaData: {
      names: [{ language: "en", value: "Chicken breast fillet" }],
      unitConversions: [{ synkkaPackagingType: "BASE_UNIT_OR_EACH", netWeight: { value: 2.5, unit: "KGM" } }],
    },
  },
], source);

const fixture = createFixtureAdapter();
const app = await buildApp(new JsonStore("unused.json"), {
  adapter: {
    kind: "FIXTURE", loadCatalog: async () => catalog,
    shortlist: async (query) => shortlistCatalog(catalog, query),
    signals: fixture.signals.bind(fixture), lookup: fixture.lookup.bind(fixture),
  },
});
afterAll(async () => app.close());

async function catalogSearch(params: Record<string, string>) {
  const response = await app.inject({ method: "GET", url: `/api/valio/catalog?${new URLSearchParams(params)}` });
  expect(response.statusCode, response.body).toBe(200);
  return response.json();
}

describe("catalog closest matches", () => {
  it("keeps the empty result unless the caller asks for closest matches", async () => {
    const body = await catalogSearch({ query: "gluten-free croissant" });
    expect(body.products).toEqual([]);
    expect(body).not.toHaveProperty("exactMatch");
  });

  it("returns the best available product with the requirement it misses and a health warning", async () => {
    const body = await catalogSearch({ query: "gluten-free croissant", closest: "true" });
    expect(body).toMatchObject({ exactMatch: false, hasMore: false, requirements: ["gluten-free"] });
    expect(body.products).toHaveLength(1);
    expect(body.products[0]).toMatchObject({
      id: "croissant",
      healthRisk: true,
      mismatches: [{ kind: "requirement", requirement: "gluten-free", status: "not_met", healthRisk: true }],
    });
  });

  it("does not add closest-match fields when an exact match exists", async () => {
    const body = await catalogSearch({ query: "chicken breast", closest: "true" });
    expect(body).not.toHaveProperty("exactMatch");
    expect(body.products.map(({ id }: { id: string }) => id)).toEqual(["chicken"]);
    expect(body.products[0]).not.toHaveProperty("mismatches");
  });

  it("converts a typed amount into packs", async () => {
    const body = await catalogSearch({ query: "10 kg chicken breast" });
    expect(body.products[0].conversion).toEqual({
      requested: { amount: 10, unit: "kg" }, packAmount: 2500, packUnit: "g", packs: 4, approximate: false,
    });
  });
});
