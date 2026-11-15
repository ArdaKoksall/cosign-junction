import { createFixtureAdapter, indexCatalog } from "@cosign/adapters";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { JsonStore } from "../src/store.js";

describe("Valio catalog product evidence", () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;

  afterEach(async () => {
    await app?.close();
  });

  it("serves manufacturer evidence and declared alternatives without calling live lookup", async () => {
    const adapter = createFixtureAdapter();
    const lookup = vi.spyOn(adapter, "lookup");
    const catalog = indexCatalog([
      {
        id: "M0", category: "10400", vendorName: "Fixture Dairy",
        salesUnit: "KI", baseUnit: "ST", salesUnitGtin: "00000000000001", allowedLotSize: 2,
        countryOfOrigin: "fi", temperatureCondition: 2,
        units: [{ unitId: "KI", gtin: "00000000000001", sizeInBaseUnits: 5 }],
        deposits: [{ material: "BOTTLE", quantity: 5, unit: "ST" }],
        substitutions: ["M1", "M1", "MISSING", "M0"].map((substituteProduct) => ({ substituteProduct })),
        synkkaData: {
          brand: "Fixture", names: [{ language: "en", value: "Fixture milk" }],
          keyIngredients: [{ language: "en", value: "Milk" }],
          ingredients: [
            { sequence: 2, names: [{ language: "en", value: "Cream" }], percentage: 5 },
            { sequence: 1, names: [{ language: "fi", value: "Maito" }], origins: [{ country: "246", type: "MILKING" }] },
          ],
          nutritionalContent: [
            { id: "PRO-", value: 3.4, unit: "GRM", basisQuantity: 100, basisQuantityUnit: "GRM", unitPrecision: "APPROXIMATELY" },
            { id: "LACS", value: 0.01, unit: "GRM", basisQuantity: 100, basisQuantityUnit: "MLT", unitPrecision: "LESS_THAN" },
            { id: "SUGAR-", value: 0, unit: "GRM", basisQuantity: 1, basisQuantityUnit: "PTN", servingSize: 70, servingSizeUnit: "GRM", dailyValueIntakePercent: 0 },
            { id: "SALTEQ", value: 2, unit: "GRM", basisQuantity: 0, basisQuantityUnit: "GRM" },
          ],
          storageInstructions: [{ language: "en", value: "Keep chilled" }],
          minTemperature: 0, maxTemperature: 6, variableUnit: true,
          classifications: [
            { name: "allergen", values: [{ id: "AM", unit: "CONTAINS" }] },
            { name: "nonAllergen", values: [{ id: "AM", unit: "FREE_FROM" }] },
            { name: "nutritionalClaim", values: [{ id: "FREE_FROM_LACTOSE", unit: "FREE_FROM" }, { id: "LOW_IN_FAT", unit: "LOW" }] },
            { name: "packagingMarkedLabel", values: [{ id: "EU_ORGANIC_FARMING" }] },
          ],
          unitConversions: [{ synkkaPackagingType: "BASE_UNIT_OR_EACH", volume: { value: 1, unit: "LTR" }, netWeight: { value: 1.12, unit: "KGM" } }],
        },
      },
      { id: "M1", salesUnit: "ST", baseUnit: "ST", synkkaData: { names: [{ language: "en", value: "Alternative" }] } },
    ], {
      label: "fixture catalog", evidenceRef: "/private/resources/catalog.json", catalogHash: "fixture-hash",
      observedAt: "2026-11-14T10:00:00Z", revision: 1,
    });
    vi.spyOn(adapter, "loadCatalog").mockResolvedValue(catalog);
    app = await buildApp(new JsonStore("unused.json"), { adapter });

    const response = await app.inject({ method: "GET", url: "/api/valio/catalog/M0" });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      product: {
        id: "M0", verifiedLactoseFree: true, countryOfOrigin: "fi", temperatureCondition: 2, variableWeight: true,
        requirements: ["lactose-free"],
        storageTemperatureCelsius: { min: 0, max: 6 },
        allowedLotSize: 2, packDimensions: [{ amount: 5000, unit: "ml" }, { amount: 5600, unit: "g" }, { amount: 5, unit: "each" }, { amount: 1, unit: "case" }],
        allergenConflicts: ["AM"],
        allergens: [{ id: "AM", status: "DECLARED_PRESENT" }, { id: "AM", status: "VERIFIED_ABSENT" }],
        claims: [{ id: "FREE_FROM_LACTOSE", status: "VERIFIED_ABSENT" }, { id: "LOW_IN_FAT", status: "DECLARED_PRESENT" }],
        labels: [{ id: "EU_ORGANIC_FARMING", status: "DECLARED_PRESENT" }],
        ingredients: [{ language: "en", value: "Milk" }], deposits: [{ material: "BOTTLE", quantity: 5, unit: "ST" }],
        structuredIngredients: [
          { sequence: 1, names: [{ language: "fi", value: "Maito" }], origins: [{ country: "246", type: "MILKING" }] },
          { sequence: 2, names: [{ language: "en", value: "Cream" }], percentage: 5, origins: [] },
        ],
        nutritionalContent: [
          { id: "PRO-", value: 3.4, unit: "GRM", basisQuantity: 100, basisQuantityUnit: "GRM", unitPrecision: "APPROXIMATELY" },
          { id: "LACS", value: 0.01, unit: "GRM", basisQuantity: 100, basisQuantityUnit: "MLT", unitPrecision: "LESS_THAN" },
          { id: "SUGAR-", value: 0, unit: "GRM", basisQuantity: 1, basisQuantityUnit: "PTN", servingSize: 70, servingSizeUnit: "GRM", dailyValueIntakePercent: 0 },
        ],
      },
      alternatives: [
        { candidateProductId: "M1", relationship: "CATALOG_DECLARED", product: { id: "M1", name: "Alternative", verifiedLactoseFree: false, requirements: [], allergens: [] } },
        { candidateProductId: "MISSING", relationship: "CATALOG_DECLARED", product: null },
      ],
      signals: {
        reliability: { present: true, value: 0.97, granularity: "PRODUCT", source: { evidenceRef: "reliability.csv" } },
        carbonKgCo2ePerKg: { present: true, value: 1.44, granularity: "PRODUCT_GROUP" },
      },
      source: { kind: "LOCAL_CATALOG", evidenceRef: "catalog.json", catalogHash: "fixture-hash" },
    });
    expect(lookup).not.toHaveBeenCalled();
  });

  it("keeps unavailable static signals unknown and handles unknown product IDs", async () => {
    const adapter = createFixtureAdapter();
    app = await buildApp(new JsonStore("unused.json"), { adapter });

    const detail = await app.inject({ method: "GET", url: "/api/valio/catalog/M3" });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({
      product: { id: "M3", labels: [], verifiedLactoseFree: false, temperatureCondition: null, nutritionalContent: [], structuredIngredients: [] },
      alternatives: [],
      signals: {
        reliability: { present: false, granularity: "UNKNOWN" },
        carbonKgCo2ePerKg: { present: false, granularity: "UNKNOWN" },
      },
    });
    expect(detail.json().signals.reliability.value).toBeUndefined();
    expect(detail.json().signals.carbonKgCo2ePerKg.value).toBeUndefined();
    const missing = await app.inject({ method: "GET", url: "/api/valio/catalog/does-not-exist" });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ error: "Unknown catalog product" });
  });
});
