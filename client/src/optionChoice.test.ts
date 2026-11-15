import { describe, expect, it } from "vitest";
import { formatEuro } from "./api";
import { choiceFromClosest, choiceFromRunnerUp, describeChoice, describeUnresolved } from "./optionChoice";
import type { SupplierObservation } from "./types";

const now = new Date("2026-11-14T12:00:00Z");
const observation = (productId: string, availableDate: string | null) => ({ productId, availableDate }) as SupplierObservation;

describe("choosing a runner-up option", () => {
  it("raises the budget to cover an over-budget estimate", () => {
    const choice = choiceFromRunnerUp(
      { productId: "P", name: "Pricey milk", totalCents: 2_571, blockers: ["OVER_BUDGET"], openQuestions: [] },
      undefined, { budgetCents: 2_000, deadlineDate: "2026-11-16", now },
    );
    expect(choice).toMatchObject({ budgetCents: 2_600, unresolved: [], healthRisks: [] });
    expect(describeChoice(choice)).toEqual(["Order exactly this product (SKU P)", `Raise the budget to ${formatEuro(2_600)} ex VAT`]);
  });

  it("moves delivery to the day the supplier reports availability", () => {
    const choice = choiceFromRunnerUp(
      { productId: "L", name: "Later milk", totalCents: 1_000, blockers: ["DELIVERY_CONFLICT"], openQuestions: [] },
      observation("L", "2026-11-17"), { budgetCents: 2_000, deadlineDate: "2026-11-16", now },
    );
    expect(choice.deliveryDate).toBe("2026-11-17");
    expect(describeChoice(choice)[1]).toBe("Move delivery to Tue 17 Nov, when Valio reports it available");
  });

  it("keeps blockers that the request cannot fix", () => {
    const choice = choiceFromRunnerUp(
      { productId: "B", name: "Blocked milk", totalCents: 1_000, blockers: ["SALES_BLOCK", "DELIVERY_CONFLICT", "CUTOFF_PASSED"], openQuestions: [] },
      observation("B", "2026-11-01"), { budgetCents: 2_000, deadlineDate: "2026-11-16", now },
    );
    expect(choice.deliveryDate).toBeUndefined();
    expect(choice.unresolved).toEqual(["SALES_BLOCK", "DELIVERY_CONFLICT", "CUTOFF_PASSED"]);
    expect(describeUnresolved(choice)[2]).toContain("use Check dates");
  });

  it("drops unmet requirements from a closest catalog product and records health risks", () => {
    const choice = choiceFromClosest({
      productId: "C", name: "Butter croissant", healthRisk: true,
      mismatches: [
        { kind: "query_word", word: "almond" },
        { kind: "requirement", requirement: "gluten-free", status: "not_met", healthRisk: true },
        { kind: "requirement", requirement: "vegan", status: "unknown", healthRisk: false },
        { kind: "allergen", allergen: "AM", status: "present", healthRisk: true },
      ],
    });
    expect(choice).toMatchObject({ removeRequirements: ["gluten-free", "vegan"], removeAllergens: ["AM"], healthRisks: ["Gluten-free", "free from milk"] });
    expect(describeChoice(choice)).toEqual([
      "Order exactly this product (SKU C)",
      "Drop the requirements: Gluten-free, Vegan",
      "Drop \"declared free from\": milk",
    ]);
  });
});
