import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import * as api from "../api";
import type { SavedRequest, SavedRequestsPage } from "../types";
import { RequestWorkspaceScreen } from "./RequestWorkspaceScreen";

function request(id: string, query: string): SavedRequest {
  return { id, query, createdAt: "2026-11-14T09:00:00Z", deadline: "2026-11-16T09:00:00Z", diet: "none", budgetCents: 1500, quantity: 10, unit: "L" };
}

describe("saved requests", () => {
  it("loads cursor pages and searches the server without showing stale results", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    const open = vi.fn();
    let finishOldSearch: (page: SavedRequestsPage) => void = () => {};
    const oldSearch = new Promise<SavedRequestsPage>((resolve) => { finishOldSearch = resolve; });
    const list = vi.spyOn(api, "getSavedRequests")
      .mockResolvedValueOnce({ requests: [request("recent", "Yogurt")], nextCursor: "second" })
      .mockResolvedValueOnce({ requests: [request("older", "Oats")], nextCursor: null })
      .mockReturnValueOnce(oldSearch)
      .mockResolvedValueOnce({ requests: [request("found", "Vanilla milk")], nextCursor: null });

    try {
      await act(async () => root.render(<RequestWorkspaceScreen currentRequest={null} ready busy={false} approvedVersion={null}
        onNewRequest={() => {}} onCompare={() => {}} onEditRequest={() => {}} onOpenCurrent={() => {}} onOpenRequest={open} />));
      await act(async () => vi.advanceTimersByTimeAsync(0));
      const loadMore = [...container.querySelectorAll("button")].find((button) => button.textContent === "Load more requests");
      expect(loadMore).toBeDefined();
      act(() => loadMore!.click());
      await act(async () => vi.advanceTimersByTimeAsync(0));
      expect(list).toHaveBeenNthCalledWith(2, { query: "", limit: 20, cursor: "second" }, expect.any(AbortSignal));
      const names = () => [...container.querySelectorAll(".purchase-request-list strong")].map((name) => name.textContent);
      expect(names()).toEqual(["Yogurt", "Oats"]);

      const input = container.querySelector<HTMLInputElement>('input[type="search"]')!;
      async function search(value: string) {
        act(() => {
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
          input.dispatchEvent(new Event("input", { bubbles: true }));
        });
        await act(async () => vi.advanceTimersByTimeAsync(200));
      }
      await search("vanilla");
      await search("Vanilla Milk");
      expect(list).toHaveBeenNthCalledWith(4, { query: "Vanilla Milk", limit: 20, cursor: undefined }, expect.any(AbortSignal));
      await act(async () => finishOldSearch({ requests: [request("stale", "Vanilla oats")], nextCursor: null }));
      expect(names()).toEqual(["Vanilla milk"]);
      act(() => container.querySelector<HTMLButtonElement>(".purchase-request-list button")!.click());
      expect(open).toHaveBeenCalledWith("found");
    } finally {
      act(() => root.unmount());
      container.remove();
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });
});
