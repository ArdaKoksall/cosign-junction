import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "../api";
import type { CatalogProduct } from "../types";
import { CatalogScreen } from "./CatalogScreen";

const base = { finnishName: null, supplier: "Fixture Bakery", salesUnit: "ST", amountDimension: "g" as const, verifiedLactoseFree: false };
const croissant: CatalogProduct = {
  ...base, id: "111", name: "Butter croissant", amountPerSellUnit: 60, requirements: [], healthRisk: true,
  mismatches: [
    { kind: "requirement", requirement: "gluten-free", status: "not_met", healthRisk: true },
    { kind: "allergen", allergen: "AM", status: "present", healthRisk: true },
  ],
};
const roll: CatalogProduct = {
  ...base, id: "222", name: "Gluten-free roll", amountPerSellUnit: 500, requirements: ["gluten-free"], healthRisk: false,
  mismatches: [{ kind: "query_word", word: "croissant" }],
  conversion: { requested: { amount: 2, unit: "kg" }, packAmount: 500, packUnit: "g", packs: 4, approximate: false },
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

async function renderSearch(products: CatalogProduct[], exactMatch?: false) {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const browse = vi.spyOn(api, "getCatalogProducts").mockResolvedValue({
    products, hasMore: false, lactoseFreeRequired: false, requirements: ["gluten-free"], ...(exactMatch === false && { exactMatch }),
  });
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  await act(async () => {
    root.render(<CatalogScreen initialSku="gluten-free croissant" onUseProduct={vi.fn()} onCheckSku={vi.fn()} />);
  });
  await act(async () => {
    await vi.runAllTimersAsync();
  });
  return { container, browse };
}

describe("catalog closest matches", () => {
  it("asks for closest matches and highlights the best one with each difference", async () => {
    const { container, browse } = await renderSearch([roll, croissant], false);
    expect(browse).toHaveBeenCalledWith("gluten-free croissant", 12, expect.anything(), expect.anything(), { closest: true });

    expect(container.querySelector(".catalog-closest-banner")?.textContent)
      .toContain("No exact match for “gluten-free croissant”");
    const items = [...container.querySelectorAll(".catalog-product")];
    expect(items[0].hasAttribute("data-best")).toBe(true);
    expect(items[0].textContent).toContain("Best available match");
    expect(items[0].textContent).toContain("Name doesn't match “croissant”");
    expect(items[0].textContent).toContain("Your 2 kg = 4 × 500 g packs");
    expect(items[1].hasAttribute("data-best")).toBe(false);

    const risks = [...items[1].querySelectorAll('[data-risk="health"]')].map((item) => item.textContent);
    expect(risks).toEqual([
      "Doesn't meet “Gluten-free”: the supplier's declaration rules it out Health risk for people with coeliac disease or gluten intolerance.",
      "Contains milk Health risk for people allergic to milk.",
    ]);
  });

  it("shows exact matches without the closest-match banner", async () => {
    const { container } = await renderSearch([{ ...roll, mismatches: undefined, healthRisk: undefined }]);
    expect(container.querySelector(".catalog-closest-banner")).toBeNull();
    expect(container.querySelector("[data-best]")).toBeNull();
    expect(container.querySelector(".catalog-mismatches")).toBeNull();
  });
});
