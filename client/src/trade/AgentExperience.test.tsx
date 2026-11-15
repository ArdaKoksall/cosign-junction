import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  AgentExperience,
  AgentMarkdown,
  agentMood,
  conversationTurns,
} from "./AgentExperience";
import type { Run, TradeEvent } from "./api";

beforeAll(() => {
  window.matchMedia = vi.fn().mockReturnValue({
    matches: true,
    addEventListener() {},
    removeEventListener() {},
  });
});
const run = {
  id: "job_test",
  status: "completed",
  source: "nemotron",
  title: "Read-only lookup",
  revision: 0,
  approved_revision: null,
  created_at: "2026-11-14T18:00:00Z",
} satisfies Run;
const event = (action: string, data: Record<string, unknown>): TradeEvent => ({
  id: "1",
  run_id: run.id,
  action,
  status: "completed",
  actor_id: "test",
  created_at: run.created_at,
  data,
});
const render = (events: TradeEvent[]) =>
  renderToStaticMarkup(
    <AgentExperience
      run={run}
      events={events}
      onOpenRun={() => {}}
      onAsk={() => {}}
    />,
  );

describe("agent result presentation", () => {
  it("renders GFM tables as accessible table cells and keeps untrusted HTML inert", () => {
    const html = renderToStaticMarkup(
      <AgentMarkdown
        content={
          "| Product | Price |\n| --- | --- |\n| Milk | €2.57 |\n\n<script>alert(1)</script>\n\n[bad](javascript:alert(1))"
        }
      />,
    );
    expect(html).toContain("<table>");
    expect(html).toContain("<th>Product</th>");
    expect(html).toContain("<td>€2.57</td>");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("javascript:");
  });
  it("renders actual catalog identities without inventing price or stock", () => {
    const html = render([
      event("browse_catalog", {
        products: [{ id: "123", name: "Valio milk", salesUnit: "1 L" }],
        pricesIncluded: false,
      }),
    ]);
    expect(html).toContain("Valio milk");
    expect(html).toContain("Catalog only");
    expect(html).not.toContain("sales units available");
    expect(html).not.toContain("€0");
  });
  it("does not present supplier unknown-stock sentinel as available inventory", () => {
    const html = render([
      event("compare_products", {
        comparison: {
          observations: [
            {
              productId: "123",
              name: "Milk",
              stockUnknown: true,
              availableSellUnits: 9999999999,
              issues: ["STOCK_UNKNOWN"],
            },
          ],
        },
      }),
    ]);
    expect(html).toContain("Availability unverified");
    expect(html).not.toContain("9999999999");
  });
  it("shows the shared deadline and keeps an unverified supplier date out of the chat estimates", () => {
    const html = render([
      event("compare_products", {
        requirements: { deadline: "2026-11-28T12:00:00+02:00" },
        comparison: {
          items: [
            { itemId: "one", observations: [{
              productId: "milk",
              name: "Milk",
              availableDate: "2026-11-16",
              deliveryStatus: "estimated",
            }] },
            { itemId: "two", observations: [{
              productId: "rice",
              name: "Rice",
              availableDate: "2026-11-18",
            }] },
          ],
        },
      }),
    ]);
    expect(html).toContain("Needed by");
    expect(html).toContain("Estimated arrival <time dateTime=\"2026-11-16\">");
    expect(html).toContain("Delivery date unverified");
    expect(html).not.toContain("2026-11-18");
  });
  it("renders a single-item draft before its stored comparison", () => {
    const html = render([event("prepare_order", {
      id: "run_milk", status: "awaiting_approval", revision: 2,
      draft: { name: "Milk", salesUnits: 1, salesUnit: "L", totalCents: 257, caveats: [] },
      comparison: { observations: [{ productId: "milk", name: "Milk", salesUnit: "L" }] },
    })]);
    expect(html).toContain("Allow draft");
    expect(html).not.toContain("Found in the catalog");
  });
  it("explains a completed empty comparison and links to the request", () => {
    const html = render([event("compare_products", { id: "run_milk", comparison: { observations: [] } })]);
    expect(html).toContain("No products were found for this item.");
    expect(html).toContain("Open comparison");
  });
  it("keeps a zero authority limit distinct from missing authority", () => {
    const html = render([
      event("get_account_context", {
        policy: {
          automaticLimitCents: 0,
          requiredClaims: [],
          freeFromAllergens: [],
        },
      }),
    ]);
    expect(html).toContain("Every purchase needs your approval");
    const missing = render([event("get_account_context", { policy: {} })]);
    expect(missing).toContain("Not checked");
  });
  it("keeps inline results attached to the correct user turn without output tabs", () => {
    const first = {
      ...event("agent_job", { instruction: "Find milk" }),
      id: "1",
    };
    const result = {
      ...event("browse_catalog", {
        products: [{ id: "milk", name: "Milk", salesUnit: "1 L" }],
      }),
      id: "2",
    };
    const followup = {
      ...event("buyer_message", { content: "Show my rules" }),
      id: "3",
    };
    const rules = {
      ...event("get_account_context", { policy: { automaticLimitCents: 0 } }),
      id: "4",
    };
    const turns = conversationTurns([first, result, followup, rules]);
    expect(turns.map((turn) => turn.prompt)).toEqual([
      "Find milk",
      "Show my rules",
    ]);
    expect(turns[0].events.map((e) => e.action)).toEqual(["browse_catalog"]);
    expect(turns[1].events.map((e) => e.action)).toEqual([
      "get_account_context",
    ]);
    const html = render([first, result, followup, rules]);
    expect(html).toContain("chat-user-message");
    expect(html).not.toContain("Full answer");
    expect(html).not.toContain("agent-view-switch");
  });
  it("reacts to actual empty, successful, uncertain and failed results without hiding approval", () => {
    const empty = event("browse_catalog", { products: [] });
    const found = event("browse_catalog", { products: [{ name: "Milk" }] });
    expect(agentMood("completed", empty).expression).toBe("triste");
    expect(agentMood("completed", found).expression).toBe("heureux");
    expect(agentMood("awaiting_approval", found).tone).toBe("approval");
    expect(agentMood("completed", { ...found, status: "failed" }).tone).toBe(
      "attention",
    );
    expect(
      agentMood(
        "completed",
        event("compare_products", {
          comparison: { observations: [{ stockUnknown: true }] },
        }),
      ).expression,
    ).toBe("mefiant");
    expect(agentMood("cancelled", found).expression).toBe("somnolent");
  });
  it("gives completed, waiting and failed work different character states", () => {
    expect(agentMood("completed").expression).toBe("heureux");
    expect(agentMood("awaiting_approval").state).toBe("notify");
    expect(agentMood("failed").state).toBe("alert");
    expect(agentMood("running").state).toBe("thinking");
  });
});
