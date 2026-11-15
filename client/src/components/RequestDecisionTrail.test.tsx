import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import * as api from "../api";
import type { DecisionEvent } from "../types";
import { RequestDecisionTrail } from "./RequestDecisionTrail";

describe("request decision trail", () => {
  it("loads persisted events on disclosure and refreshes after a revision changes", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    const event = { action: "supplier_lookup", at: "2026-11-14T09:00:00Z", outcome: "OBSERVED",
      detail: "1 catalog-shortlisted product", actorId: "buyer", revision: 1 } satisfies DecisionEvent;
    const request = { id: "req_1", createdAt: event.at, deadline: "2026-11-16T09:00:00Z", budgetCents: 100, diet: "none" as const };
    const detail = vi.spyOn(api, "getSavedRequest")
      .mockResolvedValueOnce({ request, comparison: null, approvedVersion: null, placedOrderId: null, events: [event] })
      .mockResolvedValueOnce({ request, comparison: null, approvedVersion: null, placedOrderId: null,
        events: [event, { ...event, revision: 2, detail: "2 catalog-shortlisted products" }] });

    try {
      await act(async () => root.render(<RequestDecisionTrail requestId={request.id} revision={1} approvedVersion={null} />));
      expect(detail).not.toHaveBeenCalled();
      const disclosure = container.querySelector("details")!;
      await act(async () => {
        disclosure.open = true;
        disclosure.dispatchEvent(new Event("toggle"));
      });
      expect(detail).toHaveBeenCalledWith(request.id, expect.any(AbortSignal));
      expect(container.querySelector(".purchase-timeline")?.textContent).toContain("Supplier data checked");
      expect(container.querySelector("time")?.dateTime).toBe(event.at);
      await act(async () => root.render(<RequestDecisionTrail requestId={request.id} revision={2} approvedVersion={null} />));
      expect(container.querySelectorAll(".purchase-timeline li")).toHaveLength(2);
      expect(container.querySelector(".purchase-timeline")?.textContent).toContain("Revision 2");
    } finally {
      act(() => root.unmount());
      container.remove();
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    }
  });
});
