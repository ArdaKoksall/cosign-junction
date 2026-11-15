import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import * as api from "./api";
import { App } from "./App";
import { parseHelsinkiDateTime } from "./helsinkiTime";

function enter(input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string) {
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")?.set?.call(input, value);
  input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
}

describe("purchase request form", () => {
  it("builds the structured agent request from the form and requires a unit before sending it", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    vi.spyOn(api, "getCapabilities").mockResolvedValue({
      mode: "valio_challenge", supplierLookup: true, supplierCheckout: false, simulatorEnabled: false,
    });
    vi.spyOn(api, "getSavedRequests").mockResolvedValue({ requests: [], nextCursor: null });
    const create = vi.spyOn(api, "createRequest").mockRejectedValue(new Error("End test after request submission"));
    const button = (name: string) => [...container.querySelectorAll("button")].find(({ textContent }) => textContent?.trim() === name)!;

    try {
      await act(async () => root.render(<App />));
      await act(async () => button("New request").click());
      expect(container.querySelector("textarea")).toBeNull();
      const date = container.querySelector<HTMLInputElement>('input[type="date"]')!;
      const time = container.querySelector<HTMLInputElement>('input[type="time"]')!;
      const product = container.querySelector<HTMLInputElement>("#request-product")!;
      const quantity = container.querySelector<HTMLInputElement>("input[type='number']")!;
      const budget = container.querySelectorAll<HTMLInputElement>("input[type='number']")[1];
      const unit = container.querySelector<HTMLSelectElement>("#request-unit")!;
      const submit = container.querySelector<HTMLButtonElement>('button[type="submit"]')!;

      expect(unit.value).toBe("");
      act(() => {
        enter(product, "chicken breast");
        enter(quantity, "10");
        enter(date, "2026-11-21");
        enter(time, "11:00");
        enter(budget, "390");
      });
      expect(submit.disabled).toBe(true);
      expect(container.querySelector(".agent-request-json")).toBeNull();
      act(() => submit.form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
      expect(create).not.toHaveBeenCalled();

      act(() => enter(unit, "kg"));
      expect(submit.disabled).toBe(false);
      const expected = { query: "chicken breast", quantity: 10, unit: "kg", deadline: "2026-11-21T09:00:00.000Z", budgetCents: 39000 };
      expect(JSON.parse(container.querySelector(".agent-request-json")!.textContent!)).toEqual(expect.objectContaining(expected));
      await act(async () => submit.click());
      expect(create).toHaveBeenCalledWith(expect.objectContaining(expected));
    } finally {
      act(() => root.unmount());
      container.remove();
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    }
  });

  it("requires an unambiguous time on Helsinki clock-change days", () => {
    expect(parseHelsinkiDateTime("2026-03-29", "03:30")).toBeUndefined();
    expect(parseHelsinkiDateTime("2026-10-25", "03:30")).toBeUndefined();
    expect(parseHelsinkiDateTime("2026-03-29", "04:30")).toBe("2026-03-29T01:30:00.000Z");
    expect(parseHelsinkiDateTime("2026-10-25", "04:30")).toBe("2026-10-25T02:30:00.000Z");
  });
});
