import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "../api";
import type { CatalogProduct } from "../types";
import { CatalogSuggestions } from "./CatalogSuggestions";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("catalog suggestions", () => {
  it("offers the closest products with their differences when nothing matches exactly", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const milk: CatalogProduct = {
      id: "463038", name: "Lactose free milk 1 L", finnishName: null, supplier: "Valio", salesUnit: "ST",
      amountPerSellUnit: 1000, amountDimension: "ml", verifiedLactoseFree: true, requirements: ["lactose-free"], healthRisk: true,
      conversion: { requested: { amount: 1000, unit: "ml" }, packAmount: 1000, packUnit: "ml", packs: 1, approximate: false },
      mismatches: [
        { kind: "requirement", requirement: "gluten-free", status: "unknown", healthRisk: true },
        { kind: "requirement", requirement: "high-protein", status: "unknown", healthRisk: false },
      ],
    };
    const browse = vi.spyOn(api, "getCatalogProducts").mockResolvedValue({
      products: [milk], hasMore: false, lactoseFreeRequired: true, requirements: ["lactose-free", "gluten-free", "high-protein"], exactMatch: false,
    });
    const onSelect = vi.fn();
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    await act(async () => {
      root.render(<CatalogSuggestions query="1000ml lactose free gluten free high protein milk" actionLabel="Use product" onSelect={onSelect} />);
    });
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(browse).toHaveBeenCalledWith(expect.any(String), 5, expect.anything(), expect.any(AbortSignal), { closest: true });
    expect(container.querySelector('[role="status"]')?.textContent).toContain("No exact match. These are the best options available");
    const best = container.querySelector("li[data-best]");
    expect(best?.textContent).toContain("Best available match");
    expect(best?.textContent).toContain("Your 1,000 ml = 1 × 1 L pack");
    expect([...container.querySelectorAll(".catalog-suggestion-mismatches li")].map((item) => item.textContent)).toEqual([
      "⚠ “Gluten-free” isn't declared by the supplier, so it can't be confirmed Health risk for people with coeliac disease or gluten intolerance.",
      "“High protein” isn't declared by the supplier, so it can't be confirmed",
    ]);
  });
});
