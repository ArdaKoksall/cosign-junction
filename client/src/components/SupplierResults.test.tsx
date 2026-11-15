import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { formatEuro } from "../api";
import { SupplierDecision, SupplierResults } from "./SupplierResults";
import type { SupplierObservation } from "../types";

const observation: SupplierObservation = {
  productId: "SKU",
  name: "Supplier milk",
  salesUnit: "ST",
  litersPerSellUnit: null,
  salesUnitPriceCents: null,
  availableSellUnits: 9_999_999_999,
  stockUnknown: true,
  closingTime: null,
  availableDate: null,
  reliability: null,
  carbon: null,
  issues: ["STOCK_UNKNOWN"],
};

describe("supplier observation display", () => {
  it("never displays an unverified giant quantity as usable stock or a missing price as zero", () => {
    const html = renderToStaticMarkup(<SupplierResults observations={[observation]} />);
    expect(html).toContain("Unverified");
    expect(html).toContain("Price unknown");
    expect(html).toContain("Pack size unknown");
    expect(html).toContain("Pack quantity and cost estimates are unavailable.");
    expect(html).not.toContain("9999999999");
    expect(html).not.toContain("0.00");
  });

  it("shows the source, rounded pack quantity, estimated cost and caveats", () => {
    const html = renderToStaticMarkup(<SupplierResults observations={[{
      ...observation,
      litersPerSellUnit: 2,
      packVolumeSource: "Reviewed pack evidence (GTIN match)",
      salesUnitPriceCents: 300,
      estimate: { salesUnits: 51, liters: 102, totalCents: 15_300, budgetFit: "over_budget", stockFit: "unverified" },
      issues: ["STOCK_UNKNOWN", "DELIVERY_TIME_UNVERIFIED"],
    }]} />);
    expect(html).toContain("Reviewed pack evidence (GTIN match)");
    expect(html).toContain("51 ST");
    expect(html).toContain("102 L after rounding to order increments");
    expect(html).toContain(formatEuro(15_300));
    expect(html).toContain("Over budget");
    expect(html).toContain("Stock fit unverified");
    expect(html).toContain("Delivery remains unconfirmed.");
  });

  it("shows partial measured coverage separately from the price for the full request", () => {
    const html = renderToStaticMarkup(<SupplierResults observations={[{
      ...observation, salesUnit: "KI", stockUnknown: false, availableSellUnits: 57,
      observedCoverage: { salesUnits: 57, salesUnitIncrement: 1, quantity: 285, coveredQuantity: 285,
        uncoveredQuantity: 15, unit: "kg", productSubtotalCents: 103_398, guaranteed: false },
      issues: ["DELIVERY_TIME_UNVERIFIED"],
    }]} />);
    expect(html).toContain("95% of request");
    expect(html).toContain("285 kg of 300 kg");
    expect(html).toContain("15 kg");
    expect(html).toContain(formatEuro(103_398));
    expect(html).toContain("Delivery time remains unconfirmed");
  });
});

describe("supplier ranking display", () => {
  const bestWithinBudget = {
    productId: "LOW-COST", name: "Cheapest milk", totalCents: 1000, blockers: [], openQuestions: ["STOCK_UNKNOWN"],
  };

  it("leads with the candidate that best matches the saved priority and shows caveats", () => {
    const html = renderToStaticMarkup(<SupplierDecision decision={{
      outcome: "needs_confirmation", withinBudgetCount: 3, bestWithinBudget,
      ranking: {
        objective: "reliability", status: "ranked", candidateCount: 3, measuredCount: 2,
        preferred: { ...bestWithinBudget, productId: "RELIABLE", name: "Preferred milk", totalCents: 1300, reliability: 0.973, carbon: null },
      },
    }} />);
    expect(html).toContain("Compared 2 of 3 candidates");
    expect(html).toContain("Preferred milk");
    expect(html).not.toContain("Cheapest milk");
    expect(html).toContain("97.3%");
    expect(html).toContain(`Estimated cost is ${formatEuro(300)} higher than SKU LOW-COST.`);
    expect(html).toContain("Stock quantity is unverified");
  });

  it("keeps the budget assessment visible when the requested metric is unavailable", () => {
    const html = renderToStaticMarkup(<SupplierDecision decision={{
      outcome: "needs_confirmation", withinBudgetCount: 1, bestWithinBudget,
      ranking: { objective: "carbon", status: "unavailable", candidateCount: 1, measuredCount: 0 },
    }} />);
    expect(html).toContain("No candidate had a product group carbon estimate");
    expect(html).toContain("Cheapest milk");
    expect(html).not.toContain("First candidate to check");
  });
});

describe("runner-up options", () => {
  it("lists the best available options with what blocks each one when every product is blocked", () => {
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(<SupplierDecision budgetCents={2000} decision={{
      outcome: "blocked", withinBudgetCount: 1,
      bestWithinBudget: { productId: "LATE", name: "Late milk", totalCents: 1400, blockers: ["DELIVERY_CONFLICT"], openQuestions: [] },
      runnersUp: [
        { productId: "PRICEY", name: "Pricey milk", totalCents: 2570, blockers: ["OVER_BUDGET"], openQuestions: ["STOCK_UNKNOWN"] },
        { productId: "LATE", name: "Late milk", totalCents: 1400, blockers: ["DELIVERY_CONFLICT"], openQuestions: [] },
      ],
    }} />);
    const options = [...container.querySelectorAll(".decision-runners-up li")];
    expect(options).toHaveLength(2);
    expect(options[0].hasAttribute("data-best")).toBe(true);
    expect(options[0].textContent).toContain("Best available option");
    expect(options[0].textContent).toContain(`Exceeds the requested budget by ${formatEuro(570)}`);
    expect(options[1].textContent).toContain("Availability misses the requested date");
    // The ranked list replaces the single product card.
    expect(container.querySelector(".decision-product")).toBeNull();
  });

  it("lists the closest catalog products with health warnings when nothing had every declaration", () => {
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(<SupplierDecision requirements={["gluten-free"]}
      decision={{ outcome: "no_match", withinBudgetCount: 0, bestWithinBudget: null }}
      closestProducts={[{
        productId: "CROISSANT", name: "Butter croissant", healthRisk: true,
        mismatches: [{ kind: "requirement", requirement: "gluten-free", status: "not_met", healthRisk: true }],
      }]} />);
    const best = container.querySelector(".decision-runners-up li[data-best]");
    expect(best?.textContent).toContain("Butter croissant");
    expect(container.querySelector('.decision-mismatches li[data-risk="health"]')?.textContent)
      .toContain("Health risk for people with coeliac disease or gluten intolerance.");
  });
});

describe("choosing a runner-up", () => {
  it("requires acknowledging a health risk before using a closest product", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const onChoose = vi.fn();
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    await act(async () => {
      root.render(<SupplierDecision decision={{ outcome: "no_match", withinBudgetCount: 0, bestWithinBudget: null }} onChoose={onChoose}
        closestProducts={[{
          productId: "CROISSANT", name: "Butter croissant", healthRisk: true,
          mismatches: [{ kind: "requirement", requirement: "gluten-free", status: "not_met", healthRisk: true }],
        }]} />);
    });
    const button = (label: string) => [...container.querySelectorAll("button")].find((item) => item.textContent?.includes(label))!;

    await act(async () => button("Choose this option").click());
    expect(container.textContent).toContain("Drop the requirement: Gluten-free");
    expect(button("Use this and compare").disabled).toBe(true);
    expect(button("Edit request first").disabled).toBe(true);

    await act(async () => container.querySelector<HTMLInputElement>(".decision-choose-ack input")!.click());
    expect(button("Use this and compare").disabled).toBe(false);
    await act(async () => button("Use this and compare").click());
    expect(onChoose).toHaveBeenCalledWith(expect.objectContaining({ productId: "CROISSANT", removeRequirements: ["gluten-free"] }), true);

    await act(async () => root.unmount());
    container.remove();
  });

  it("offers a blocked option directly when no health declaration is dropped", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const onChoose = vi.fn();
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    await act(async () => {
      root.render(<SupplierDecision budgetCents={1000} onChoose={onChoose} decision={{
        outcome: "blocked", withinBudgetCount: 0, bestWithinBudget: null,
        runnersUp: [{ productId: "PRICEY", name: "Pricey milk", totalCents: 1250, blockers: ["OVER_BUDGET"], openQuestions: [] }],
      }} />);
    });
    const button = (label: string) => [...container.querySelectorAll("button")].find((item) => item.textContent?.includes(label))!;
    await act(async () => button("Choose this option").click());
    expect(container.querySelector(".decision-choose-ack")).toBeNull();
    await act(async () => button("Edit request first").click());
    expect(onChoose).toHaveBeenCalledWith(expect.objectContaining({ productId: "PRICEY", budgetCents: 1300 }), false);

    await act(async () => root.unmount());
    container.remove();
  });
});
