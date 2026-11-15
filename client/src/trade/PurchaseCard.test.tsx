import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PurchaseCard } from "./PurchaseCard";
import type { ComparedProduct, DatedOffer, DraftLine, RehearsalReceipt, Run } from "./api";
const milkDraft: DraftLine = {
  name: "Milk",
  salesUnits: 10,
  salesUnit: "1 L",
  totalCents: 2570,
  observedAt: "2026-11-14",
  caveats: [],
};
const draft: Run = {
  id: "run_review",
  title: "Milk",
  source: "nemotron",
  status: "awaiting_approval",
  revision: 4,
  approved_revision: null,
  created_at: "2026-11-14",
  draft: milkDraft,
};
let container: HTMLDivElement, root: Root;
const button = (name: string) => [...container.querySelectorAll("button")].find(
  (control) => (control.getAttribute("aria-label") ?? control.textContent?.trim()) === name,
)!;
const response = (value: unknown, ok = true) => ({
  ok,
  json: async () => value,
});
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
describe("inline purchase decisions", () => {
  it("shows material agent changes before approving the same draft revision", async () => {
    const amended: Run = {
      ...draft,
      requestChanges: [
        { revision: 2, kind: "item_changed",
          before: { query: "Whole milk", productId: "123456", quantity: 12, unit: "L" },
          after: { query: "UHT milk", productId: "464398", quantity: 10, unit: "L" } },
        { revision: 3, kind: "items_removed", items: [{ query: "Rice", quantity: 2, unit: "kg", itemId: "rice" }] },
        { revision: 4, kind: "constraints_relaxed",
          budget: { before: { cents: 2000, mode: "hard" }, after: { cents: 3000, mode: "preferred" } },
          delivery: { before: { deadline: "2026-11-17T11:00:00+02:00", mode: "on" }, after: null } },
      ],
    };
    const fetch = vi.fn()
      .mockResolvedValueOnce(response(amended))
      .mockResolvedValueOnce(response({ ...amended, status: "approved", approved_revision: 4 }));
    vi.stubGlobal("fetch", fetch);
    await act(async () => root.render(<PurchaseCard snapshot={amended} />));
    expect(container.textContent).toContain("Changes proposed by the agent");
    expect(container.textContent).toContain("12 L Whole milk (123456) → 10 L UHT milk (464398)");
    expect(container.textContent).toContain("Removed 2 kg Rice");
    expect(container.textContent).toMatch(/Budget cap .*20.00 → Budget target .*30.00/);
    expect(container.textContent).toMatch(/Required on .* → No delivery target/);
    await act(async () => button("Allow draft").click());
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ revision: 4, approve: true });
    expect(container.textContent).toContain("You allowed this draft");
  });

  it.each([true, false])(
    "submits the viewed revision with approve=%s and displays the persisted result",
    async (approve) => {
      const fetch = vi
        .fn()
        .mockResolvedValueOnce(response(draft))
        .mockResolvedValueOnce(
          response({
            ...draft,
            status: approve ? "approved" : "rejected",
            approved_revision: approve ? 4 : null,
          }),
        );
      vi.stubGlobal("fetch", fetch);
      await act(async () => root.render(<PurchaseCard snapshot={draft} />));
      const button = [...container.querySelectorAll("button")].find((b) =>
        b.textContent?.includes(approve ? "Allow draft" : "Decline"),
      )!;
      expect(button.disabled).toBe(false);
      await act(async () => button.click());
      expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({
        revision: 4,
        approve,
      });
      expect(container.textContent).toContain(
        approve ? "You allowed this draft" : "You declined this draft",
      );
      expect(container.textContent).toContain("No supplier order placed");
    },
  );
  it("refreshes a conflicting revision without approving the replacement", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(draft))
      .mockResolvedValueOnce(response({ message: "Draft changed" }, false))
      .mockResolvedValueOnce(response({ ...draft, revision: 5 }));
    vi.stubGlobal("fetch", fetch);
    await act(async () => root.render(<PurchaseCard snapshot={draft} />));
    await act(async () =>
      [...container.querySelectorAll("button")]
        .find((b) => b.textContent?.includes("Allow draft"))!
        .click(),
    );
    expect(container.textContent).toContain("Draft changed");
    expect(container.textContent).toContain("Draft v5");
    expect(
      fetch.mock.calls.filter(([, options]) => options.method === "POST"),
    ).toHaveLength(1);
  });
  it("allows an explicit retry after a transient decision failure and same-revision reload", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response(draft))
      .mockResolvedValueOnce(response({ message: "Try again" }, false))
      .mockResolvedValueOnce(response(draft))
      .mockResolvedValueOnce(response({ ...draft, status: "approved", approved_revision: 4 }));
    vi.stubGlobal("fetch", fetch);
    await act(async () => root.render(<PurchaseCard snapshot={draft} />));
    await act(async () => button("Allow draft").click());
    expect(container.textContent).toContain("Try again");
    expect(button("Allow draft").disabled).toBe(false);
    expect(button("Decline").disabled).toBe(false);
    await act(async () => button("Allow draft").click());
    expect(JSON.parse(fetch.mock.calls[3][1].body)).toEqual({ revision: 4, approve: true });
    expect(container.textContent).toContain("You allowed this draft");
  });
  it("shows a decision that persisted when its response was lost", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response(draft))
      .mockRejectedValueOnce(new Error("Network interrupted"))
      .mockResolvedValueOnce(response({ ...draft, status: "rejected" }));
    vi.stubGlobal("fetch", fetch);
    await act(async () => root.render(<PurchaseCard snapshot={draft} />));
    await act(async () => button("Decline").click());
    expect(container.textContent).toContain("You declined this draft");
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it("keeps decline available for a draft with expired evidence", async () => {
    const expired = { ...draft, approvalEligibility: { eligible: false, reasons: ["Refresh the supplier observations."] } };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(expired)));
    await act(async () => root.render(<PurchaseCard snapshot={expired} />));
    expect(button("Allow draft").disabled).toBe(true);
    expect(button("Decline").disabled).toBe(false);
    expect(button("Check price and availability").disabled).toBe(false);
  });
  it("refreshes supplier evidence after preparation expires and hides actions for closed requests", async () => {
    const open: Run = {
      ...draft, status: "active", draft: null,
      comparison: { observedAt: draft.created_at, observations: [{
        productId: "milk", name: "Milk", salesUnit: "1 L", salesUnitPriceCents: 257,
        availableSellUnits: 20, issues: [],
      }] },
      draftEligibility: { milk: { eligible: true, reasons: [] } },
    };
    const refreshed = { ...open, revision: 5 };
    const closed = { ...refreshed, status: "cancelled" };
    const fetch = vi.fn()
      .mockResolvedValueOnce(response(open))
      .mockResolvedValueOnce(response({ error: "stale_evidence", message: "Refresh supplier evidence" }, false))
      .mockResolvedValueOnce(response(open))
      .mockResolvedValueOnce(response(refreshed))
      .mockResolvedValueOnce(response(closed));
    vi.stubGlobal("fetch", fetch);
    await act(async () => root.render(<PurchaseCard snapshot={open} />));
    await act(async () => button("Choose Milk").click());
    expect(button("Choose Milk").disabled).toBe(true);
    await act(async () => button("Refresh price and availability").click());
    expect(fetch.mock.calls[3][0]).toBe("/api/tools/compare_products");
    expect(JSON.parse(fetch.mock.calls[3][1].body)).toEqual({ runId: open.id, revision: open.revision });
    expect(button("Choose Milk").disabled).toBe(false);
    await act(async () => root.render(<PurchaseCard snapshot={closed} />));
    expect(container.textContent).toContain("Request cancelled");
    expect(button("Choose Milk")).toBeUndefined();
    expect(button("Refresh price and availability")).toBeUndefined();
  });
  it("prepares and approves all selected items together within the order budget", async () => {
    const observedAt = "2026-11-14T18:00:00Z";
    const item = (itemId: string, query: string, quantity: number) => ({
      itemId,
      query,
      quantity,
      unit: "kg",
    });
    const product = (productId: string, name: string, totalCents: number, availableDate: string) => ({
      productId,
      name,
      salesUnit: "1 kg bags",
      salesUnitPriceCents: totalCents,
      availableSellUnits: 20,
      availableDate,
      deliveryStatus: "estimated" as const,
      issues: [],
      estimate: { salesUnits: 1, totalCents },
    });
    const chicken = product("chicken", "Chicken breast pack", 3300, "2026-11-21");
    const rice = product("rice", "Brown rice pack", 700, "2026-11-16");
    const premiumRice = product("premium", "Premium rice pack", 2000, "2026-11-18");
    const lateRice: ComparedProduct = {
      ...rice,
      productId: "late",
      name: "Late rice pack",
      availableDate: "2026-12-03",
      deliveryStatus: "after_deadline",
    };
    const undatedRice: ComparedProduct = {
      ...rice,
      productId: "undated",
      name: "Undated rice pack",
      availableDate: null,
      deliveryStatus: "unverified",
    };
    const eligible = { eligible: true, reasons: [] };
    const request: Run = {
      ...draft,
      source: "mcp",
      status: "active",
      title: "10 kg chicken breast and 2 kg rice",
      draft: null,
      requirements: {
        items: [item("one", "chicken breast", 10), item("two", "rice", 2)],
        budgetCents: 5000,
        deadline: "2026-11-30T22:30:00Z",
      },
      comparison: {
        items: [
          { itemId: "one", observedAt, observations: [chicken] },
          { itemId: "two", observedAt, observations: [rice, premiumRice, lateRice, undatedRice] },
        ],
      },
      itemDraftEligibility: {
        one: { chicken: eligible },
        two: {
          rice: eligible,
          premium: eligible,
          late: { eligible: false, reasons: ["After your deadline", "Order cutoff expired or unknown"] },
          undated: { eligible: false, reasons: ["Delivery date unverified"] },
        },
      },
    };
    const prepared: Run = {
      ...request,
      revision: 5,
      status: "awaiting_approval",
      draft: {
        items: [
          { ...chicken, itemId: "one", salesUnits: 10, totalCents: 3300, observedAt, caveats: [] },
          { ...rice, itemId: "two", salesUnits: 2, totalCents: 700, observedAt, caveats: [] },
        ],
        totalCents: 4000,
        observedAt,
        caveats: [],
      },
    };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(request))
      .mockResolvedValueOnce(response(prepared))
      .mockResolvedValueOnce(
        response({ ...prepared, status: "approved", approved_revision: 5 }),
      );
    vi.stubGlobal("fetch", fetch);
    await act(async () => root.render(<PurchaseCard snapshot={request} />));

    expect(
      [...container.querySelectorAll("legend")].map((label) => label.textContent),
    ).toEqual(["10 kg chicken breast", "2 kg rice"]);
    expect(container.textContent).toContain("1 Dec 2026, 00:30 Helsinki");
    expect(container.textContent).toContain("After your deadline Thursday, 3 December 2026");
    expect(button("Choose Late rice pack").disabled).toBe(true);
    expect(container.textContent?.match(/After your deadline/g)).toHaveLength(1);
    expect(container.textContent).toContain("Order cutoff expired or unknown");
    expect(container.textContent?.match(/Delivery date unverified/g)).toHaveLength(1);
    expect(container.textContent).not.toContain("Refresh price and stock before selecting.");
    await act(async () => button("Choose Chicken breast pack").click());
    expect(button("Prepare draft").disabled).toBe(true);
    expect(container.textContent).not.toContain("Full order estimated by");
    await act(async () => button("Choose Premium rice pack").click());
    expect(button("Prepare draft").disabled).toBe(true);
    expect(container.textContent).toContain("order budget");
    await act(async () => button("Choose Brown rice pack").click());
    expect(button("Prepare draft").disabled).toBe(false);
    const summary = () => [...container.querySelectorAll("dl > div")].map((entry) => [
      entry.querySelector("dt")?.textContent,
      entry.querySelector("time")?.dateTime,
    ]);
    const expectedSchedule = [
      ["Needed by", "2026-11-30T22:30:00Z"],
      ["Next estimated arrival", "2026-11-16"],
      ["Full order estimated by", "2026-11-21"],
    ];
    expect(summary()).toEqual(expectedSchedule);
    await act(async () => button("Prepare draft").click());

    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({
      runId: request.id,
      revision: 4,
      selections: [
        { itemId: "one", productId: "chicken" },
        { itemId: "two", productId: "rice" },
      ],
    });
    const price = new Intl.NumberFormat("en-FI", {
      style: "currency",
      currency: "EUR",
    }).format(40);
    expect(container.textContent).toContain(price);
    expect(summary()).toEqual(expectedSchedule);
    expect([...container.querySelectorAll(".purchase-card-item h3")].map((entry) => entry.textContent))
      .toEqual(["Brown rice pack", "Chicken breast pack"]);
    await act(async () => button("Allow draft").click());
    expect(JSON.parse(fetch.mock.calls[2][1].body)).toEqual({
      revision: 5,
      approve: true,
    });
    expect(container.textContent).toContain("You allowed this draft");
  });
  it("sends dated choices and suggests a feasible pair when the two lines share stock", async () => {
    const early: DatedOffer = {
      productId: "milk", name: "Milk", salesUnit: "case", salesUnitPriceCents: 200,
      availableSellUnits: 3, availableDate: "2026-11-17", deliveryStatus: "estimated",
      issues: [], estimate: { salesUnits: 2, totalCents: 400 }, eligible: true, reasons: [],
    };
    const later: DatedOffer = { ...early, availableDate: "2026-11-18", deliveryStatus: "time_unverified" };
    const selections = [
      { itemId: "item_1", productId: "milk", availableDate: early.availableDate },
      { itemId: "item_2", productId: "milk", availableDate: later.availableDate },
    ];
    const request: Run = {
      ...draft, status: "active", draft: null,
      requirements: { items: selections.map(({ itemId }) => ({ itemId, query: "Milk", unit: "sales_unit", quantity: 2 })), budgetCents: 800 },
      comparison: {
        items: selections.map(({ itemId }) => ({ itemId, observedAt: draft.created_at, deliveryOffers: [early, later] })),
        basketPlan: { status: "feasible", selections, totalCents: 800,
          explanation: { basis: "earliest_completion_then_lowest_total", completionDate: later.availableDate, priceOptimal: true } },
      },
    };
    const fetch = vi.fn().mockResolvedValue(response(request));
    vi.stubGlobal("fetch", fetch);
    await act(async () => root.render(<PurchaseCard snapshot={request} />));
    expect(container.textContent).toContain("Earliest complete basket · Wednesday, 18 November 2026");
    expect(container.textContent).toContain("Lowest total on that date within your budget and delivery settings");
    const earlyChoices = [...container.querySelectorAll<HTMLButtonElement>('button[aria-label="Choose Milk for Tuesday, 17 November 2026"]')];
    expect(earlyChoices).toHaveLength(2);
    await act(async () => earlyChoices.forEach((choice) => choice.click()));
    expect(button("Prepare draft").disabled).toBe(true);
    expect(container.textContent).toContain("exceed the stock reported");
    const suggested = [...container.querySelectorAll("button")].find((control) => control.textContent?.includes("Use suggested options"))!;
    await act(async () => suggested.click());
    expect(button("Prepare draft").disabled).toBe(false);
    expect(container.textContent).toContain("Delivery time unverified");
    expect(container.textContent).not.toContain("Full order estimated by");
    await act(async () => button("Prepare draft").click());
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ runId: request.id, revision: 4, selections });
  });
  it("keeps an over-target selection actionable and displays the preferred date", async () => {
    const offer: DatedOffer = {
      productId: "milk", name: "Milk", salesUnit: "case", salesUnitPriceCents: 200,
      availableSellUnits: 3, availableDate: "2026-11-17", deliveryStatus: "estimated",
      issues: ["OUTSIDE_PREFERRED_DELIVERY_DATE"], estimate: { salesUnits: 2, totalCents: 400 },
      eligible: true, reasons: [],
    };
    const items = [{ itemId: "item_1", query: "Milk", unit: "sales_unit", quantity: 2 }];
    const request: Run = {
      ...draft, status: "active", draft: null,
      requirements: { items, budgetCents: 300, budgetMode: "preferred", deadline: "2020-01-01T08:00:00Z", deliveryMode: "preferred_on" },
      comparison: { items: [{ itemId: "item_1", observedAt: draft.created_at, deliveryOffers: [offer] }] },
    };
    const fetch = vi.fn().mockResolvedValue(response(request));
    vi.stubGlobal("fetch", fetch);
    await act(async () => root.render(<PurchaseCard snapshot={request} />));
    expect(container.textContent).toContain("Preferred for");
    expect(container.textContent).toContain("Outside the preferred delivery date");
    await act(async () => button("Choose Milk for Tuesday, 17 November 2026").click());
    expect(container.textContent).toContain("budget target");
    expect(button("Prepare draft").disabled).toBe(false);
    await act(async () => button("Prepare draft").click());
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({
      runId: request.id, revision: 4,
      selections: [{ itemId: "item_1", productId: "milk", availableDate: "2026-11-17" }],
    });
  });
  it("asks before dropping unavailable items and rechecks the amended basket", async () => {
    const milk = { itemId: "item_1", query: "Milk", unit: "sales_unit", quantity: 2 };
    const rice = { itemId: "item_2", query: "Rice", unit: "kg", quantity: 1 };
    const comparison = { items: [milk, rice].map(({ itemId }) => ({ itemId, observedAt: draft.created_at })) };
    const request: Run = {
      ...draft, status: "needs_attention", draft: null,
      requirements: { items: [milk, rice] }, comparison,
      itemAvailability: { item_2: { status: "insufficient_stock", reasons: ["Reported stock cannot cover this quantity."] } },
      partialBasketPlan: { status: "feasible", omittedItemIds: [rice.itemId], totalCents: 400 },
    };
    const removed: Run = {
      ...request, status: "active", revision: 5, requirements: { items: [milk], excludedItems: [rice] },
      comparison: null, itemAvailability: undefined, partialBasketPlan: undefined,
    };
    const refreshed = { ...removed, revision: 6, comparison: { items: comparison.items.slice(0, 1) } };
    const fetch = vi.fn().mockResolvedValueOnce(response(request)).mockResolvedValueOnce(response(removed)).mockResolvedValueOnce(response(refreshed));
    vi.stubGlobal("fetch", fetch);
    await act(async () => root.render(<PurchaseCard snapshot={request} />));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Reported stock cannot cover this quantity.");
    expect(button("Prepare draft").disabled).toBe(true);
    await act(async () => button("Remove listed items and recheck").click());
    expect(fetch.mock.calls[1][0]).toBe("/api/tools/remove_request_items");
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ runId: request.id, revision: 4, itemIds: [rice.itemId] });
    expect(fetch.mock.calls[2][0]).toBe("/api/tools/compare_products");
    expect(JSON.parse(fetch.mock.calls[2][1].body)).toEqual({ runId: request.id, revision: 5 });
    expect(container.textContent).toContain("Removed from this request");
    expect(container.textContent).toContain("1 kg Rice");
    expect(button("Remove listed items and recheck")).toBeUndefined();
  });
  it("groups arrivals that share a date and omits the full estimate when a line has no date", async () => {
    const run: Run = {
      ...draft,
      draft: {
        items: [
          { ...milkDraft, itemId: "milk" },
          { ...milkDraft, itemId: "rice", name: "Rice", availableDate: "2026-11-17" },
          { ...milkDraft, itemId: "apples", name: "Apples", availableDate: "2026-11-17" },
        ],
        totalCents: 7710,
        observedAt: "2026-11-14",
        caveats: [],
      },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(run)));
    await act(async () => root.render(<PurchaseCard snapshot={run} />));

    const groups = [...container.querySelectorAll(".purchase-delivery-group")];
    expect(groups).toHaveLength(2);
    expect(groups[0].querySelector("time")?.dateTime).toBe("2026-11-17");
    expect([...groups[0].querySelectorAll("h3")].map((entry) => entry.textContent)).toEqual(["Rice", "Apples"]);
    expect(groups[1].textContent).toContain("Delivery date unverified");
    expect(groups[1].textContent).toContain("Milk");
    expect(container.textContent).toContain("Next estimated arrival");
    expect(container.textContent).not.toContain("Full order estimated by");
  });
});

it("commits only in rehearsal mode and recovers a receipt after a lost response", async () => {
  const approved: Run = { ...draft, status: "approved", approved_revision: draft.revision };
  const receipt: RehearsalReceipt = {
    receiptId: "rehearsal_123",
    kind: "order_rehearsal",
    submittedToSupplier: false,
    currency: "EUR",
    moneyBasis: "VAT_EXCLUSIVE",
    revision: approved.revision,
    totalCents: milkDraft.totalCents,
    createdAt: "2026-11-15T00:10:17Z",
    authorization: "buyer_approval",
  };
  const fetch = vi.fn()
    .mockResolvedValueOnce(response(approved))
    .mockRejectedValueOnce(new Error("Lost connection"))
    .mockResolvedValueOnce(response({ ...approved, status: "completed", receipt }));
  vi.stubGlobal("fetch", fetch);
  await act(async () => root.render(<PurchaseCard snapshot={approved} />));
  expect(button("Commit rehearsal order")).toBeUndefined();
  await act(async () => root.render(<PurchaseCard snapshot={approved} orderRehearsalAvailable />));
  await act(async () => button("Commit rehearsal order").click());
  expect(fetch.mock.calls[1][0]).toBe("/api/tools/place_order");
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({
    runId: draft.id, revision: draft.revision, mode: "rehearsal",
    idempotencyKey: `cosign-web:${draft.id}:${draft.revision}`,
  });
  expect(container.textContent).toContain("Rehearsal receipt");
  expect(container.textContent).toContain(receipt.receiptId);
  expect(container.textContent).toContain("Buyer approval");
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(button("Commit rehearsal order")).toBeUndefined();
});
