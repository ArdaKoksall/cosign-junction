import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CatalogProductEvidence } from "../types";
import { CatalogEvidenceDetails } from "./CatalogEvidence";

const details: CatalogProductEvidence = {
  product: {
    id: "101", name: "Milk", supplier: "Supplier", salesUnit: "KI", salesUnitGtin: "6408430100330",
    allowedLotSize: 1, variableWeight: null, packDimensions: [{ amount: 20_000, unit: "ml", source: "Valio webshop case GTIN" }],
    claims: [{ id: "FREE_FROM_LACTOSE", group: "nutritionalClaim", status: "VERIFIED_ABSENT" }],
    requirements: ["lactose-free"],
    allergens: [
      { id: "AM", group: "allergen", status: "DECLARED_PRESENT" },
      { id: "AM", group: "nonAllergen", status: "VERIFIED_ABSENT" },
      { id: "AE", group: "allergen", status: "MAY_CONTAIN" },
      { id: "X99", group: "allergen", status: "UNKNOWN" },
      { id: "AP", group: "nonAllergen", status: "VERIFIED_ABSENT" },
    ],
    allergenConflicts: ["AM"], labels: [], countryOfOrigin: "fi", storageTemperatureCelsius: { min: 0, max: 6 },
    brand: "Valio", deposits: [{ material: "007", quantity: 2, unit: "ST" }],
    ingredients: [{ language: "fi", value: "Maito." }],
    structuredIngredients: [{ sequence: 1, names: [{ language: "fi", value: "Maito" }], origins: [{ country: "246", type: "MILKING" }], percentage: 88 }],
    nutritionalContent: [
      { id: "LACS", value: 0.01, unit: "GRM", basisQuantity: 100, basisQuantityUnit: "MLT", unitPrecision: "LESS_THAN" },
      { id: "PRO-", value: 3.4, unit: "GRM", basisQuantity: 100, basisQuantityUnit: "GRM", unitPrecision: "APPROXIMATELY" },
      { id: "ID", value: 30, unit: "MC", basisQuantity: 1, basisQuantityUnit: "PTN", servingSize: 60, servingSizeUnit: "GRM", dailyValueIntakePercent: 20 },
    ],
    storageInstructions: [], preparationInstructions: [], usageInstructions: [], manufacturerUpdatedAt: null,
  },
  alternatives: [
    {
      candidateProductId: "102", relationship: "CATALOG_DECLARED", product: {
        id: "102", name: "Alternate milk", variableWeight: false, packDimensions: [], verifiedLactoseFree: false,
        allergenConflicts: [], requirements: ["high-protein"],
      },
    },
    { candidateProductId: "103", relationship: "CATALOG_DECLARED", product: null },
  ],
  signals: { reliability: { present: false }, carbonKgCo2ePerKg: { present: true, value: 0.6 } },
  source: { label: "Local product catalog" },
};

describe("catalog evidence display", () => {
  it("keeps allergen declarations, free-from claims, and conflicting evidence distinct", () => {
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(<CatalogEvidenceDetails data={details} onCheckSku={() => {}} onViewProduct={() => {}} />);
    const groups = Object.fromEntries([...container.querySelectorAll("section[aria-label='Allergens and claims'] dt")]
      .map((node) => [node.textContent, node.nextElementSibling?.textContent]));

    expect(groups).toEqual({
      "May contain": "Eggs", "Undeclared status": "Code X99", "Conflicting declarations": "Milk", "Declared free from": "Peanuts",
    });
    expect(container.textContent).toContain("Conflicting allergen evidence. Verify with the supplier.");
    expect(container.textContent).toContain("Free from lactose");
  });

  it("keeps missing substitutes visible without actions and labels incomplete historical signals", () => {
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(<CatalogEvidenceDetails data={details} onCheckSku={() => {}} onViewProduct={() => {}} />);
    const [available, missing] = container.querySelectorAll(".catalog-alternatives li");

    expect(available.querySelectorAll("button")).toHaveLength(2);
    expect(available.textContent).toContain("Declared: High protein");
    expect(missing.querySelectorAll("button")).toHaveLength(0);
    expect(missing.textContent).toContain("SKU 103");
    expect(missing.textContent).toContain("Product details are missing");
    expect(container.textContent).toContain("Delivery reliability scoreUnavailable");
    expect(container.textContent).toContain("Product group carbon estimate0.6 kg CO₂e/kg");
    expect(container.textContent).toContain("20 L (Valio webshop case GTIN)");
    expect(container.textContent).toContain("2 ST of material 007 per sales unit. Deposit charges are unavailable.");
    expect(container.querySelector("dd[lang=fi]")?.textContent).toBe("Maito.");
  });

  it("shows nutrition on each manufacturer basis and keeps ingredient stage origins separate", () => {
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(<CatalogEvidenceDetails data={details} onCheckSku={() => {}} onViewProduct={() => {}} />);
    expect([...container.querySelectorAll(".catalog-nutrition-table caption")].map((caption) => caption.textContent))
      .toEqual(["Per 100 mL", "Per 100 g", "Per 1 portion"]);
    expect(container.querySelector(".catalog-nutrition-table tbody")?.textContent).toContain("Lactose< 0.01 g");
    expect(container.querySelector(".catalog-nutrition-table:last-of-type tbody")?.textContent).toContain("Iodine30 µg60 g20%");
    expect(container.querySelector(".catalog-structured-ingredients")?.textContent).toContain("Maito · 88%Milking: Finland");
  });
});
