import { afterEach, describe, expect, it } from "vitest";
import { clearRecentOrders, loadRecentOrders, saveRecentOrder } from "./storage";

afterEach(() => {
  sessionStorage.clear();
});

describe("recent orders storage", () => {
  it("saves newest first and recovers by id uniqueness", () => {
    saveRecentOrder({
      orderId: "ord_a",
      status: "committed",
      totalCents: 100,
      savedAt: "2026-11-13T00:00:00.000Z",
    });
    const next = saveRecentOrder({
      orderId: "ord_b",
      status: "committed",
      totalCents: 200,
      savedAt: "2026-11-13T01:00:00.000Z",
    });
    expect(next.map((item) => item.orderId)).toEqual(["ord_b", "ord_a"]);
    expect(loadRecentOrders()).toHaveLength(2);
    clearRecentOrders();
    expect(loadRecentOrders()).toEqual([]);
  });
});
