import { describe, expect, it } from "vitest";
import { closestCatalogMatches, indexCatalog, packConversion, requestedAmountFromQuery, shortlistCatalog } from "./index.js";

const source = { label: "Closest match test catalog", revision: 1, observedAt: "2026-11-14T10:00:00Z" };

function product(id: string, name: string, {
  claims = [] as { id: string; unit: string }[],
  allergens = [] as { id: string; unit: string }[],
  volumeLitres = 0,
  weightKg = 0,
} = {}) {
  return {
    id, salesUnit: "ST", baseUnit: "ST", units: [{ unitId: "ST", sizeInBaseUnits: 1 }],
    synkkaData: {
      names: [{ language: "en", value: name }],
      unitConversions: [{
        synkkaPackagingType: "BASE_UNIT_OR_EACH",
        ...(volumeLitres && { volume: { value: volumeLitres, unit: "LTR" } }),
        ...(weightKg && { netWeight: { value: weightKg, unit: "KGM" } }),
      }],
      classifications: [
        { name: "allergen", values: allergens.filter(({ unit }) => unit !== "FREE_FROM") },
        { name: "nonAllergen", values: allergens.filter(({ unit }) => unit === "FREE_FROM") },
        { name: "nutritionalClaim", values: claims },
      ],
    },
  };
}

const glutenFree = { id: "FREE_FROM_GLUTEN", unit: "FREE_FROM" };
const catalog = indexCatalog([
  product("croissant", "Butter croissant", { allergens: [{ id: "AW", unit: "CONTAINS" }, { id: "AM", unit: "CONTAINS" }], weightKg: 0.06 }),
  product("gf-bread", "Gluten-free bread", { claims: [glutenFree], allergens: [{ id: "AW", unit: "FREE_FROM" }], weightKg: 0.5 }),
  product("oat-drink", "Oat drink", { claims: [{ id: "VEGAN", unit: "DIET" }], volumeLitres: 1 }),
  product("cream", "Cooking cream", { allergens: [{ id: "AM", unit: "CONTAINS" }], volumeLitres: 1 }),
  product("chicken", "Chicken breast fillet", { weightKg: 2.5 }),
], source);

describe("closest catalog matches", () => {
  it("returns the nearest product when nothing meets every requirement, and explains each gap", () => {
    expect(shortlistCatalog(catalog, { query: "gluten-free croissant" })).toEqual([]);

    const [best, ...rest] = closestCatalogMatches(catalog, { query: "gluten-free croissant" });
    expect(rest).toEqual([]);
    expect(best.product.id).toBe("croissant");
    expect(best.healthRisk).toBe(true);
    expect(best.mismatches).toEqual([
      { kind: "requirement", requirement: "gluten-free", status: "not_met", healthRisk: true },
    ]);
  });

  it("flags allergens the buyer excluded as health risks", () => {
    const [best] = closestCatalogMatches(catalog, { query: "cooking cream", freeFromAllergens: ["AM"] });
    expect(best.product.id).toBe("cream");
    expect(best.mismatches).toEqual([{ kind: "allergen", allergen: "AM", status: "present", healthRisk: true }]);
  });

  it("keeps a non-health requirement gap without a health warning", () => {
    // Declared milk rules out vegan, so this is "not met" rather than merely undeclared.
    const [cream] = closestCatalogMatches(catalog, { query: "cooking cream", requirements: ["vegan"] });
    expect(cream.healthRisk).toBe(false);
    expect(cream.mismatches).toEqual([{ kind: "requirement", requirement: "vegan", status: "not_met", healthRisk: false }]);

    const [chicken] = closestCatalogMatches(catalog, { query: "chicken", requirements: ["no-added-sugar"] });
    expect(chicken.mismatches).toEqual([{ kind: "requirement", requirement: "no-added-sugar", status: "unknown", healthRisk: false }]);
  });

  it("ranks a safe partial name match above an unsafe full name match", () => {
    const ranked = closestCatalogMatches(catalog, { query: "gluten-free croissant bread" }).map(({ product }) => product.id);
    expect(ranked).toEqual(["gf-bread", "croissant"]);
  });

  it("prefers an undeclared product whose name states the requirement, while still flagging it", () => {
    const named = indexCatalog([
      product("plain", "Butter croissant"),
      product("named", "Croissant GFREE frozen"),
    ], source);
    const [best, second] = closestCatalogMatches(named, { query: "gluten-free croissant" });
    expect([best.product.id, second.product.id]).toEqual(["named", "plain"]);
    expect(best.mismatches).toEqual([{ kind: "requirement", requirement: "gluten-free", status: "unknown", healthRisk: true }]);
  });

  it("ranks the product type asked for above other products that meet more requirements", () => {
    const lactoseFree = { id: "FREE_FROM_LACTOSE", unit: "FREE_FROM" };
    const dairy = indexCatalog([
      { ...product("chocolate", "Lactose free milk chocolate", { claims: [lactoseFree, glutenFree], weightKg: 0.15 }), category: "15000" },
      { ...product("milk", "Lactose free milk", { claims: [lactoseFree], volumeLitres: 1 }), category: "10400" },
    ], source);
    const ranked = closestCatalogMatches(dairy, { query: "1000ml lactose free gluten free high protein milk" });
    expect(ranked.map(({ product: { id } }) => id)).toEqual(["milk", "chocolate"]);
    expect(ranked[0].mismatches).toEqual([
      { kind: "requirement", requirement: "gluten-free", status: "unknown", healthRisk: true },
      { kind: "requirement", requirement: "high-protein", status: "unknown", healthRisk: false },
    ]);
  });

  it("lists search words the product name does not contain", () => {
    const [best] = closestCatalogMatches(catalog, { query: "chicken thigh" });
    expect(best.product.id).toBe("chicken");
    expect(best.mismatches).toEqual([{ kind: "query_word", word: "thigh" }]);
  });

  it("offers an approximate volume for a product measured by weight", () => {
    const [best] = closestCatalogMatches(catalog, { query: "chicken", amountDimension: "ml" });
    expect(best.mismatches).toEqual([
      { kind: "pack_measure", requested: "ml", actual: "g", approximate: { amount: 2500, unit: "ml" } },
    ]);
  });

  it("skips products that share no search word", () => {
    expect(closestCatalogMatches(catalog, { query: "pineapple" })).toEqual([]);
  });
});

describe("unit conversion", () => {
  it("reads typed amounts in common units", () => {
    expect(requestedAmountFromQuery("10 kg chicken breast")).toEqual({ amount: 10, unit: "kg", base: 10_000, baseUnit: "g" });
    expect(requestedAmountFromQuery("2,5 dl cream")).toEqual({ amount: 2.5, unit: "dl", base: 250, baseUnit: "ml" });
    expect(requestedAmountFromQuery("500ml oat drink")).toEqual({ amount: 500, unit: "ml", base: 500, baseUnit: "ml" });
    expect(requestedAmountFromQuery("3 litres of milk")).toEqual({ amount: 3, unit: "L", base: 3000, baseUnit: "ml" });
    expect(requestedAmountFromQuery("chicken breast")).toBeUndefined();
  });

  it("converts within the same family exactly and rounds up to whole packs", () => {
    const chicken = catalog.products.get("chicken")!;
    expect(packConversion(chicken, requestedAmountFromQuery("10 kg")!)).toEqual({
      requested: { amount: 10, unit: "kg" }, packAmount: 2500, packUnit: "g", packs: 4, approximate: false,
    });
    expect(packConversion(chicken, requestedAmountFromQuery("6000 g")!)).toMatchObject({ packs: 3, approximate: false });
  });

  it("marks a volume to weight conversion as approximate", () => {
    const chicken = catalog.products.get("chicken")!;
    expect(packConversion(chicken, requestedAmountFromQuery("5 L")!)).toMatchObject({ packs: 2, approximate: true, packUnit: "g" });
  });
});
