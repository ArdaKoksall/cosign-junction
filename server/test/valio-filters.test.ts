import { createFixtureAdapter, indexCatalog, shortlistCatalog } from "@cosign/adapters";
import { afterAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { JsonStore } from "../src/store.js";

const source = { label: "Allergen test catalog", revision: 1, observedAt: "2026-11-14T10:00:00Z" };
type Declaration = { id: string; unit: string };
const vegan = { id: "VEGAN", unit: "DIET" };
const glutenFree = { id: "FREE_FROM_GLUTEN", unit: "FREE_FROM" };
const highProtein = { id: "HIGH_PROTEIN", unit: "HIGH" };

function product(id: string, milk: string[], egg: string[], { volume = false, lactoseFree = false,
  claims = [], allergens = [], labels = [], dual = false }: { volume?: boolean; lactoseFree?: boolean; claims?: Declaration[]; allergens?: Declaration[]; labels?: Declaration[]; dual?: boolean } = {}) {
  const values = [
    ...milk.map((unit) => ({ id: "AM", unit })),
    ...egg.map((unit) => ({ id: "AE", unit })),
    ...allergens,
  ];
  return {
    id, salesUnit: "ST", baseUnit: "ST", units: [{ unitId: "ST", sizeInBaseUnits: 1 }],
    synkkaData: {
      names: [{ language: "en", value: `Sample soup ${id}` }],
      unitConversions: [{ synkkaPackagingType: "BASE_UNIT_OR_EACH", ...(volume && { volume: { value: 1, unit: "LTR" } }),
        ...((!volume || dual) && { netWeight: { value: dual ? 1.15 : 1, unit: "KGM" } }) }],
      classifications: [
        { name: "allergen", values: values.filter(({ unit }) => unit !== "FREE_FROM") },
        { name: "nonAllergen", values: values.filter(({ unit }) => unit === "FREE_FROM") },
        { name: "nutritionalClaim", values: [...claims, ...(lactoseFree ? [{ id: "FREE_FROM_LACTOSE", unit: "FREE_FROM" }] : [])] },
        { name: "packagingMarkedLabel", values: labels },
      ],
    },
  };
}

const catalog = indexCatalog([
  product("both-mass", ["FREE_FROM"], ["FREE_FROM"], { claims: [vegan, glutenFree, highProtein] }),
  product("both-volume", ["FREE_FROM"], ["FREE_FROM"], { volume: true, claims: [vegan] }),
  product("milk-only", ["FREE_FROM"], ["MAY_CONTAIN"], { claims: [glutenFree] }),
  product("contains", ["CONTAINS"], ["FREE_FROM"], { lactoseFree: true }),
  product("may-contain", ["MAY_CONTAIN"], ["FREE_FROM"]),
  product("unknown", ["UNDECLARED"], ["FREE_FROM"], { claims: [vegan, { ...highProtein, unit: "DIET" }], labels: [glutenFree] }),
  product("missing", [], ["FREE_FROM"], { lactoseFree: true }),
  product("lactose-conflict", [], [], { lactoseFree: true, allergens: [{ id: "ML", unit: "MAY_CONTAIN" }] }),
  product("dual", [], [], { volume: true, dual: true }),
  product("contradicted", ["FREE_FROM", "CONTAINS"], ["FREE_FROM"]),
  product("uncertain", ["FREE_FROM", "UNDECLARED"], ["FREE_FROM"], {
    claims: [vegan, glutenFree], allergens: [{ id: "AW", unit: "MAY_CONTAIN" },
      { id: "AN", unit: "FREE_FROM" }, { id: "SH", unit: "MAY_CONTAIN" }],
  }),
], source);

const fixture = createFixtureAdapter();
const lookup = vi.fn(fixture.lookup.bind(fixture));
const app = await buildApp(new JsonStore("unused.json"), {
  adapter: {
    kind: "FIXTURE", loadCatalog: async () => catalog,
    shortlist: async (query) => shortlistCatalog(catalog, query),
    signals: fixture.signals.bind(fixture), lookup,
  },
});
afterAll(async () => app.close());

async function search(query: string) {
  const response = await app.inject({ method: "GET", url: `/api/valio/catalog?${query}` });
  expect(response.statusCode, response.body).toBe(200);
  const { products, hasMore } = response.json<{ products: { id: string }[]; hasMore: boolean }>();
  return { ids: products.map(({ id }) => id), hasMore };
}

describe("Valio catalog evidence filters", () => {
  it("finds multiple declared products from a typed lactose-free request without calling supplier pricing", async () => {
    const query = new URLSearchParams({ query: "I need to buy 5 kg of lactos-free soup" });
    const response = await app.inject({ method: "GET", url: `/api/valio/catalog?${query}` });
    expect(response.statusCode, response.body).toBe(200);
    const { lactoseFreeRequired, products } = response.json();
    expect(lactoseFreeRequired).toBe(true);
    expect(products).toHaveLength(2);
    expect(products).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "contains", verifiedLactoseFree: true }),
      expect.objectContaining({ id: "missing", verifiedLactoseFree: true }),
    ]));
    expect(lookup).not.toHaveBeenCalled();
  });

  it("filters by one exact allergen code using only uncontradicted free-from declarations", async () => {
    expect(await search("query=soup&freeFromAllergen=AM")).toEqual({ ids: ["both-mass", "both-volume", "milk-only"], hasMore: false });
    expect(await search("lactoseFreeOnly=true&freeFromAllergen=AM")).toEqual({ ids: [], hasMore: false });
    expect(lookup).not.toHaveBeenCalled();
  });

  it("combines typed and selected product requirements using explicit declarations", async () => {
    const query = new URLSearchParams({ query: "vegan soup", requirements: "gluten-free" });
    const response = await app.inject({ method: "GET", url: `/api/valio/catalog?${query}` });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      requirements: ["gluten-free", "vegan"],
      products: [{ id: "both-mass", requirements: ["gluten-free", "vegan", "high-protein"] }],
    });
    expect(await search("query=gluten-free+and+vegan+soup")).toEqual({ ids: ["both-mass"], hasMore: false });
    expect(await search("query=vegan+soup+and+gluten-free")).toEqual({ ids: ["both-mass"], hasMore: false });
    expect(await search("requirements=gluten-free&requirements=vegan")).toEqual({ ids: ["both-mass"], hasMore: false });
    expect(await search("query=soup+vegan+and+high+in+protein")).toEqual({ ids: ["both-mass"], hasMore: false });
    expect(lookup).not.toHaveBeenCalled();
  });

  it("does not infer a positive dietary requirement from 'non-vegan'", async () => {
    const response = await app.inject({ method: "GET", url: "/api/valio/catalog?query=non-vegan+soup" });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().requirements).toEqual([]);
  });

  it("combines allergen codes with AND, pack dimension and existing limit and volume parameters", async () => {
    const constraints = "freeFromAllergen=AM&freeFromAllergen=AE";
    expect(await search(`${constraints}&limit=1`)).toEqual({ ids: ["both-mass"], hasMore: true });
    expect(await search(`${constraints}&amountDimension=g`)).toEqual({ ids: ["both-mass"], hasMore: false });
    expect(await search(`${constraints}&volumeOnly=true`)).toEqual({ ids: ["both-volume"], hasMore: false });
    expect(await search(`${constraints}&amountDimension=ml`)).toEqual({ ids: ["both-volume"], hasMore: false });
    expect(lookup).not.toHaveBeenCalled();
  });

  it("does not accept a group absence contradicted by a named member", async () => {
    expect(await search("query=soup&freeFromAllergen=AN")).toEqual({ ids: [], hasMore: false });
  });

  it("includes a product with both weight and volume under either measurement filter", async () => {
    for (const dimension of ["g", "ml"]) {
      const response = await app.inject({ url: `/api/valio/catalog?query=dual&amountDimension=${dimension}` });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json().products).toMatchObject([{
        id: "dual", amountDimension: "ml", amountPerSellUnit: 1000, secondaryPackMeasure: { amount: 1150, unit: "g" },
      }]);
    }
  });

  it.each([
    "amountDimension=kg",
    "amountDimension=g&volumeOnly=true",
    "freeFromAllergen=milk",
    "freeFromAllergen=AM%2CAE",
    "freeFromAllergen=",
    "requirements=sugar-free",
    Array.from({ length: 31 }, () => "freeFromAllergen=AM").join("&"),
  ])("rejects invalid filters (%s)", async (query) => {
    const result = await app.inject({ method: "GET", url: `/api/valio/catalog?${query}` });
    expect(result.statusCode, result.body).toBe(400);
  });
});
