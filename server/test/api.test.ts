import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { JsonStore } from "../src/store.js";

const requestBody = {
  quantityLiters: 1000,
  deadline: "2026-11-16T09:00:00Z",
  diet: "lactose-free",
  budgetCents: 145000,
};

describe("simulator API", () => {
  let dir: string;
  let store: JsonStore;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let clock: Date;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "junction-sim-"));
    store = new JsonStore(join(dir, "state.json"));
    await store.load();
    clock = new Date("2026-11-14T10:00:00Z");
    app = await buildApp(store, { now: () => new Date(clock), enableSimulator: true });
  });

  afterEach(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });

  async function json(method: "GET" | "POST", url: string, payload?: Record<string, unknown>, expected = 200) {
    const res = await app.inject({
      method,
      url,
      payload,
      headers: payload ? { "content-type": "application/json" } : undefined,
    });
    expect(res.statusCode, res.body).toBe(expected);
    return res.json();
  }

  it("searches older history and paginates with a stable order when timestamps match", async () => {
    await store.transaction(async (tx) => {
      for (let index = 0; index < 52; index++) {
        await tx.createRequest({
          ...requestBody, id: `req_${String(index).padStart(2, "0")}`, createdAt: clock.toISOString(),
          quantity: 1000, unit: "L", query: index === 0 ? "Historic milk" : "Milk",
          productId: index === 0 ? "463038" : undefined,
        });
      }
    });
    const first = await json("GET", "/api/requests");
    expect(first.requests).toHaveLength(50);
    expect(first.requests.at(-1).id).toBe("req_02");
    const rest = await json("GET", `/api/requests?cursor=${first.nextCursor}`);
    expect(rest.requests.map(({ id }: { id: string }) => id)).toEqual(["req_01", "req_00"]);
    expect(rest.nextCursor).toBeNull();
    for (const query of ["HISTORIC", "463038", "REQ_00"]) {
      const filtered = await json("GET", `/api/requests?query=${query}`);
      expect(filtered.requests.map(({ id }: { id: string }) => id)).toEqual(["req_00"]);
    }
  });

  it.each(["limit=0", "limit=51", "limit=1.5", "cursor=garbage", "cursor=", "query=%00"])(
    "rejects invalid history parameters %s", async (query) => {
      await json("GET", `/api/requests?${query}`, undefined, 400);
    },
  );

  it.each(["not-a-date", "2026-11-16", "2026-11-13T10:00:00Z", "2026-11-14T10:00:00Z"])(
    "rejects invalid or elapsed deadline %s before creating a request",
    async (deadline) => {
      await json("POST", "/api/requests", { ...requestBody, deadline }, 400);
      expect(Object.keys(store.get().requests)).toHaveLength(0);
    },
  );

  it("rejects comparison and approval when the request deadline has elapsed", async () => {
    const created = await json("POST", "/api/requests", requestBody, 201);
    const proposal = await json("POST", `/api/requests/${created.requestId}/compare`);
    clock = new Date(requestBody.deadline);
    await json("POST", `/api/requests/${created.requestId}/compare`, undefined, 409);
    await json("POST", `/api/proposals/${proposal.proposalId}/approve`, { version: 1 }, 409);
    expect(store.get().proposals[proposal.proposalId].approvedVersion).toBeNull();
  });

  it("does not let an earlier approval commit after the delivery deadline", async () => {
    const created = await json("POST", "/api/requests", requestBody, 201);
    const proposal = await json("POST", `/api/requests/${created.requestId}/compare`);
    await json("POST", `/api/proposals/${proposal.proposalId}/approve`, { version: 1 });
    clock = new Date(requestBody.deadline);
    await json("POST", `/api/proposals/${proposal.proposalId}/commit`, { version: 1, idempotencyKey: "late" }, 409);
    expect(Object.keys(store.get().orders)).toHaveLength(0);
  });

  it("keeps placed orders terminal and recovers server history after restart and deadline", async () => {
    const created = await json("POST", "/api/requests", requestBody, 201);
    const requestPath = `/api/requests/${created.requestId}`;
    expect(await json("GET", requestPath)).toMatchObject({ comparison: null, events: [] });
    const proposal = await json("POST", `${requestPath}/compare`);
    clock = new Date("2026-11-14T10:01:00Z");
    await json("POST", `/api/proposals/${proposal.proposalId}/approve`, { version: 1 });
    expect(await json("GET", requestPath)).toMatchObject({
      comparison: { version: 1, status: "approved" }, approvedVersion: 1, placedOrderId: null,
      events: [{ action: "request", revision: 1 }, { action: "compare", revision: 1 }, { action: "approve", revision: 1 }],
    });
    clock = new Date("2026-11-14T10:02:00Z");
    const input = { version: 1, idempotencyKey: "saved-order" };
    const placed = await json("POST", `/api/proposals/${proposal.proposalId}/commit`, input, 201);
    expect(placed.events.map((event: { action: string }) => event.action)).toEqual(["request", "compare", "approve", "commit"]);
    expect(placed.events[2].at).toBe("2026-11-14T10:01:00.000Z");
    expect(placed.events[3].at).toBe("2026-11-14T10:02:00.000Z");
    await json("POST", "/api/demo/price-change", { proposalId: proposal.proposalId }, 409);
    expect(store.get().proposals[proposal.proposalId].status).toBe("placed");
    expect(store.get().proposals[proposal.proposalId].version).toBe(1);
    expect(await json("GET", `/api/orders/${placed.orderId}`)).toEqual(placed);

    await app.close();
    store = new JsonStore(join(dir, "state.json"));
    await store.load();
    app = await buildApp(store, { now: () => new Date(clock), enableSimulator: true });
    expect(await json("GET", requestPath)).toMatchObject({
      comparison: { version: 1, status: "placed" }, approvedVersion: 1, placedOrderId: placed.orderId, events: placed.events,
    });
    const history = await json("GET", "/api/orders");
    expect(history.orders).toEqual([{ orderId: placed.orderId, status: "placed", totalCents: 126400, savedAt: "2026-11-14T10:02:00.000Z" }]);
    expect(history.orders[0]).not.toHaveProperty("idempotencyKey");
    clock = new Date("2026-11-17T10:00:00Z");
    expect(await json("POST", `/api/proposals/${proposal.proposalId}/commit`, input, 201)).toEqual(placed);
    expect((await json("POST", `/api/requests/${created.requestId}/compare`)).status).toBe("placed");
    await json("POST", "/api/demo/reset");
    expect((await json("GET", "/api/orders")).orders).toEqual([]);
  });

  it("does not let approval bypass a blocked budget", async () => {
    const created = await json("POST", "/api/requests", { ...requestBody, budgetCents: 1 }, 201);
    const proposal = await json("POST", `/api/requests/${created.requestId}/compare`);
    expect(proposal.status).toBe("blocked");
    await json("POST", `/api/proposals/${proposal.proposalId}/approve`, { version: proposal.version }, 409);
    await json("POST", `/api/proposals/${proposal.proposalId}/commit`, { version: proposal.version, idempotencyKey: "blocked" }, 409);
  });

  it("covers the 1000L fixture through approval, price change, and idempotent commit", async () => {
    const created = await json("POST", "/api/requests", requestBody, 201);
    expect(created).toEqual({ requestId: expect.any(String) });

    const compared = await json("POST", `/api/requests/${created.requestId}/compare`);
    expect(compared.version).toBe(1);
    expect(compared.uncoveredLiters).toBe(0);
    expect(compared.totalCents).toBe(200 * 120 + 800 * 128);
    expect(compared.offers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "offer_original",
          quantityLiters: 200,
          eligible: true,
          source: "fixture",
        }),
        expect.objectContaining({
          id: "offer_replacement",
          quantityLiters: 800,
          eligible: true,
          reason: "SUBSTITUTION_WITH_APPROVAL",
        }),
        expect.objectContaining({
          id: "offer_rejected",
          eligible: false,
          reason: "CLAIM_NOT_MET",
        }),
      ]),
    );

    const approved = await json("POST", `/api/proposals/${compared.proposalId}/approve`, {
      version: 1,
    });
    expect(approved).toEqual({ approved: true, version: 1 });

    const afterChange = await json("POST", "/api/demo/price-change", {
      proposalId: compared.proposalId,
    });
    expect(afterChange.version).toBe(2);
    expect(afterChange.totalCents).toBe(200 * 120 + 800 * 136);

    const staleCommit = await app.inject({
      method: "POST",
      url: `/api/proposals/${compared.proposalId}/commit`,
      payload: { version: 1, idempotencyKey: "op-1" },
      headers: { "content-type": "application/json" },
    });
    expect(staleCommit.statusCode).toBe(409);

    await json("POST", `/api/proposals/${compared.proposalId}/approve`, { version: 2 });
    const committed = await json(
      "POST",
      `/api/proposals/${compared.proposalId}/commit`,
      { version: 2, idempotencyKey: "op-1" },
      201,
    );
    expect(committed.status).toBe("placed");
    expect(committed.totalCents).toBe(afterChange.totalCents);
    expect(committed.events.length).toBeGreaterThan(0);
    expect(committed.events.map((event: { action: string }) => event.action)).toEqual([
      "request", "compare", "approve", "price_change", "approve", "commit",
    ]);

    const retried = await json(
      "POST",
      `/api/proposals/${compared.proposalId}/commit`,
      { version: 2, idempotencyKey: "op-1" },
      201,
    );
    expect(retried.orderId).toBe(committed.orderId);

    const secondKey = await app.inject({
      method: "POST",
      url: `/api/proposals/${compared.proposalId}/commit`,
      payload: { version: 2, idempotencyKey: "op-2" },
      headers: { "content-type": "application/json" },
    });
    expect(secondKey.statusCode).toBe(409);

    const fetched = await json("GET", `/api/orders/${committed.orderId}`);
    expect(fetched.orderId).toBe(committed.orderId);
    expect(Object.keys(store.get().orders)).toHaveLength(1);

    const reset = await json("POST", "/api/demo/reset");
    expect(reset).toEqual({ reset: true });
    expect(store.get().orders).toEqual({});
  });
});
