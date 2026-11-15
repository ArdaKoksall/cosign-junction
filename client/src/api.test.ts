import { afterEach, describe, expect, it, vi } from "vitest";
import {
  API_BASE,
  approveProposal,
  commitProposal,
  compareRequest,
  createRequest,
  createRehearsalQuote,
  formatEuro,
  getOrder,
  getRecentOrders,
  getRehearsalQuote,
  getSimulatorSession,
  injectPriceChange,
  requestJson,
  resetDemo,
  setSimulatorToken,
  sourceKind,
} from "./api";
import { ApiError } from "./types";

afterEach(() => {
  setSimulatorToken("");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("formatEuro", () => {
  it("formats integer cents as EUR", () => {
    expect(formatEuro(250000)).toMatch(/2.?500/);
  });
});

describe("sourceKind", () => {
  it("labels fixture, live, and unknown sources", () => {
    expect(sourceKind("fixture-catalog")).toBe("fixture");
    expect(sourceKind("Valio live mock")).toBe("live");
    expect(sourceKind("internal")).toBe("unknown");
  });
});

describe("requestJson", () => {
  it("loads saved order history from the server for a fresh browser session", async () => {
    const orders = [{ orderId: "ord_saved", status: "placed", totalCents: 126400, savedAt: "2026-11-14T10:02:00Z" }];
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ orders }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(getRecentOrders()).resolves.toEqual({ orders });
    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE}/api/orders`, expect.objectContaining({ headers: expect.any(Object) }));
  });

  it("posts JSON and parses success bodies", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ requestId: "req_1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const body = {
      quantityLiters: 1000,
      deadline: "2026-11-20T10:00:00.000Z",
      diet: "lactose-free" as const,
      budgetCents: 250000,
    };
    await expect(createRequest(body)).resolves.toEqual({ requestId: "req_1" });
    expect(fetchMock).toHaveBeenCalledWith(
      `${API_BASE}/api/requests`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(body),
      }),
    );
  });

  it("maps compare, approve, commit, order, and demo paths", async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })),
    );
    vi.stubGlobal("fetch", fetchMock);

    await compareRequest("req_1");
    await approveProposal("prop_1", 2);
    await commitProposal("prop_1", 2, "idem-1");
    await getOrder("ord_1");
    await injectPriceChange("prop_1");
    await resetDemo();

    const urls = fetchMock.mock.calls.map((call) => call[0]);
    expect(urls).toEqual([
      `${API_BASE}/api/requests/req_1/compare`,
      `${API_BASE}/api/proposals/prop_1/approve`,
      `${API_BASE}/api/proposals/prop_1/commit`,
      `${API_BASE}/api/orders/ord_1`,
      `${API_BASE}/api/demo/price-change`,
      `${API_BASE}/api/demo/reset`,
    ]);

    const approveInit = fetchMock.mock.calls[1][1] as RequestInit;
    expect(approveInit.body).toBe(JSON.stringify({ version: 2 }));
    const commitInit = fetchMock.mock.calls[2][1] as RequestInit;
    expect(commitInit.body).toBe(
      JSON.stringify({ version: 2, idempotencyKey: "idem-1" }),
    );
    const priceInit = fetchMock.mock.calls[4][1] as RequestInit;
    expect(priceInit.body).toBe(JSON.stringify({ proposalId: "prop_1" }));
  });

  it("prepares and recovers a simulated quote by its connected request ID", async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(Response.json({ quote: null, approvedVersion: null, placedOrderId: null, events: [] })),
    );
    vi.stubGlobal("fetch", fetchMock);
    await getSimulatorSession("buyer-example");
    setSimulatorToken("buyer-example");
    await createRehearsalQuote("req_1", 3, "464398");
    await getRehearsalQuote("req_1");
    expect(fetchMock).toHaveBeenNthCalledWith(1, `${API_BASE}/api/session`, expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer buyer-example" }),
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, `${API_BASE}/api/requests/req_1/rehearsal`, expect.objectContaining({
      method: "POST", body: JSON.stringify({ version: 3, productId: "464398" }),
      headers: expect.objectContaining({ Authorization: "Bearer buyer-example" }),
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(3, `${API_BASE}/api/requests/req_1/rehearsal`, expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer buyer-example" }),
    }));
  });

  it("throws ApiError with server message on failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: "approval invalidated", code: "PRICE_DRIFT" }), {
          status: 409,
        }),
      ),
    );

    await expect(requestJson("/api/proposals/x/commit", { method: "POST" })).rejects.toMatchObject({
      name: "ApiError",
      status: 409,
      message: "approval invalidated",
      code: "PRICE_DRIFT",
    } satisfies Partial<ApiError>);
  });

  it("surfaces unreachable API as a network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(resetDemo()).rejects.toBeInstanceOf(ApiError);
    await expect(resetDemo()).rejects.toThrow(/localhost:3001/);
  });
});
