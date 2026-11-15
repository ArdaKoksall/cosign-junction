import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProductionApp } from "./ProductionApp";
import { DisplayProvider } from "../i18n";
import type { Run, Session, TradeEvent } from "./api";

let container: HTMLDivElement;
let root: Root;
let stream: EventSourceStub;

class EventSourceStub {
  onmessage?: (event: MessageEvent) => void;
  constructor() { stream = this; }
  addEventListener() {}
  close() {}
}

const session: Session = {
  account: {
    id: "test-buyer", name: "Test buyer", email: "test@example.test",
    policy: { automaticLimitCents: 0, requiredClaims: [], freeFromAllergens: [] },
  },
  mcpUrl: "https://example.test/mcp", nemotronModel: null, supplierCheckoutAvailable: false,
};

function request(id: string, name: string): Run {
  return {
    id, title: `${name} order`, source: "mcp", status: "active", revision: 2,
    approved_revision: null, created_at: "2026-11-15T12:00:00Z", draft: null,
    comparison: {
      observedAt: "2026-11-15T12:00:00Z",
      observations: [{ productId: id, name, salesUnit: "case", salesUnitPriceCents: 200, availableSellUnits: 20, issues: [] }],
    },
    draftEligibility: { [id]: { eligible: true, reasons: [] } },
  };
}

const reply = (value: unknown) => ({ ok: true, json: async () => value });
const button = (name: string) => [...container.querySelectorAll("button")].find(
  (control) => control.getAttribute("aria-label") === name || control.textContent?.includes(name),
)!;
const drawer = () => container.querySelector(".market-drawer")!;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("EventSource", EventSourceStub);
  const dialog = window.HTMLDialogElement.prototype;
  if (!dialog.showModal) {
    Object.defineProperties(dialog, {
      showModal: { configurable: true, value(this: HTMLDialogElement) { this.open = true; } },
      close: { configurable: true, value(this: HTMLDialogElement) { this.open = false; } },
    });
  }
  vi.stubGlobal("localStorage", { getItem: () => null, setItem() {} });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  window.history.replaceState({}, "", "/");
  vi.unstubAllGlobals();
});

it("keeps a late live refresh from acting on the previously selected request", async () => {
  const milk = request("run_milk", "Milk");
  const rice = request("run_rice", "Rice");
  window.history.replaceState({}, "", `/?run=${milk.id}`);
  let holdMilk = false;
  let releaseMilk: (() => void) | undefined;
  const fetch = vi.fn(async (path: string, _options?: RequestInit) => {
    if (path === "/api/session") return reply(session);
    if (path === "/api/runs") return reply([milk, rice]);
    if (path.startsWith("/api/events?")) return reply([]);
    if (path === "/api/tools/browse_catalog") return reply({ products: [], hasMore: false });
    if (path === `/api/runs/${milk.id}`) {
      if (holdMilk) {
        holdMilk = false;
        await new Promise<void>((resolve) => { releaseMilk = resolve; });
      }
      return reply(milk);
    }
    if (path === `/api/runs/${rice.id}` || path === "/api/tools/prepare_order") return reply(rice);
    throw new Error(`Unexpected request ${path}`);
  });
  vi.stubGlobal("fetch", fetch);
  await act(async () => root.render(<ProductionApp />));
  expect(drawer().textContent).toContain(milk.title);
  await act(async () => button("Close assistant panel").click());
  holdMilk = true;
  const event: TradeEvent = {
    id: "1", run_id: milk.id, action: "compare_products", status: "completed",
    actor_id: "test", created_at: milk.created_at, data: {},
  };
  await act(async () => {
    stream.onmessage?.(new MessageEvent("message", { data: JSON.stringify(event) }));
    await new Promise((resolve) => setTimeout(resolve, 280));
  });
  expect(releaseMilk).toBeTypeOf("function");
  await act(async () => button(rice.title).click());
  expect(drawer().textContent).toContain(rice.title);
  await act(async () => releaseMilk?.());
  expect(new URLSearchParams(window.location.search).get("run")).toBe(rice.id);
  expect(drawer().textContent).toContain(rice.title);
  expect(drawer().textContent).not.toContain(milk.title);
  await act(async () => button("Choose Rice").click());
  const prepared = fetch.mock.calls.find(([path]) => path === "/api/tools/prepare_order");
  expect(JSON.parse(String(prepared?.[1]?.body))).toMatchObject({ runId: rice.id });
});

it("passes the catalog basket to the assistant as exact product IDs and sales units", async () => {
  const products = [
    { id: "valio-milk", name: "Milk", salesUnit: "case", quantity: 2 },
    { id: "valio-juice", name: "Juice", salesUnit: "carton", quantity: 4 },
  ];
  vi.stubGlobal("localStorage", {
    getItem: () => JSON.stringify(products), setItem() {},
  });
  vi.stubGlobal("fetch", vi.fn(async (path: string) => {
    if (path === "/api/session") return reply(session);
    if (path === "/api/runs") return reply([]);
    if (path === "/api/tools/browse_catalog") return reply({ products: [], hasMore: false });
    throw new Error(`Unexpected request ${path}`);
  }));
  await act(async () => root.render(<ProductionApp />));
  await act(async () => button("Basket").click());
  await act(async () => button("Prepare with assistant").click());
  const instruction = drawer().querySelector("textarea")?.value ?? "";
  expect(instruction).toContain("Check the next available offers with any budget or delivery preferences I provide");
  expect(JSON.parse(instruction.split("\n\n")[1])).toEqual({
    items: [
      { productId: "valio-milk", query: "Milk", quantity: 2, unit: "sales_unit" },
      { productId: "valio-juice", query: "Juice", quantity: 4, unit: "sales_unit" },
    ],
  });
});

it("creates a structured Monday milk request without Nemotron and opens it for lookup", async () => {
  const milk = request("run_monday", "Milk");
  const fetch = vi.fn(async (path: string, _options?: RequestInit) => {
    if (path === "/api/session") return reply(session);
    if (path === "/api/runs" || path.startsWith("/api/events?")) return reply([]);
    if (path === "/api/tools/browse_catalog") return reply({ products: [], hasMore: false });
    if (path === "/api/tools/create_request") return reply({ runId: milk.id });
    if (path === `/api/runs/${milk.id}`) return reply(milk);
    throw new Error(`Unexpected request ${path}`);
  });
  vi.stubGlobal("fetch", fetch);
  await act(async () => root.render(<ProductionApp />));
  await act(async () => button("New request").click());
  await act(async () => button("Try the Monday milk example").click());
  await act(async () => button("Create request").click());
  const creation = fetch.mock.calls.find(([path]) => path === "/api/tools/create_request");
  const payload = JSON.parse(String(creation?.[1]?.body));
  expect(payload).toMatchObject({
    query: "milk", quantity: 1000, unit: "L", budgetCents: 180000,
    requirements: ["lactose-free"], deliveryMode: "by",
    idempotencyKey: expect.any(String),
  });
  expect(Date.parse(payload.deadline)).toBeGreaterThan(Date.now());
  expect(drawer().textContent).toContain(milk.title);
  expect(drawer().querySelector("textarea")).toBeNull();
});

it("finds chicken in the new request form and saves the selected catalog product", async () => {
  const chicken = { id: "470746", name: "Top Choice boneless chicken breast fillet 5 kg", salesUnit: "ST" };
  const run = request("run_chicken", chicken.name);
  const fetch = vi.fn(async (path: string, options?: RequestInit) => {
    if (path === "/api/session") return reply(session);
    if (path === "/api/runs" || path.startsWith("/api/events?")) return reply([]);
    if (path === "/api/tools/browse_catalog") {
      const { query } = JSON.parse(String(options?.body));
      return reply({ products: query === "boneless chicken breast" ? [chicken] : [], hasMore: false });
    }
    if (path === "/api/tools/create_request") return reply({ runId: run.id });
    if (path === `/api/runs/${run.id}`) return reply(run);
    throw new Error(`Unexpected request ${path}`);
  });
  vi.stubGlobal("fetch", fetch);
  await act(async () => root.render(<ProductionApp />));
  await act(async () => button("New request").click());
  const dialog = container.querySelector("dialog")!;
  const product = dialog.querySelector<HTMLInputElement>('input[required]:not([type="number"])')!;
  const quantity = dialog.querySelector<HTMLInputElement>('input[type="number"][required]')!;
  const inputValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;

  vi.useFakeTimers();
  try {
    act(() => {
      inputValue.call(product, "boneless chicken breast");
      product.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => vi.advanceTimersByTimeAsync(500));
  } finally {
    vi.useRealTimers();
  }

  expect(button(chicken.name)).toBeDefined();
  act(() => button(chicken.name).click());
  act(() => {
    inputValue.call(quantity, "20");
    quantity.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => button("Create request").click());

  const creation = fetch.mock.calls.find(([path]) => path === "/api/tools/create_request");
  expect(JSON.parse(String(creation?.[1]?.body))).toMatchObject({ productId: chicken.id, quantity: 20, unit: "kg" });
  expect(drawer().textContent).toContain(run.title);
});

it("opens the requested connector setup and gives each client the workspace MCP address", async () => {
  vi.stubGlobal("fetch", vi.fn(async (path: string) => {
    if (path === "/api/session") return reply(session);
    if (path === "/api/runs" || path === "/api/connections") return reply([]);
    if (path === "/api/tools/browse_catalog") return reply({ products: [], hasMore: false });
    throw new Error(`Unexpected request ${path}`);
  }));
  await act(async () => root.render(<ProductionApp />));
  await act(async () => button("Claude Code").click());
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 300));
  });
  const heading = () => container.querySelector("#mcp-install-title")?.textContent;
  const guide = () => container.querySelector(".mcp-guide")?.textContent;
  expect(heading()).toBe("Connect Claude Code");
  expect(guide()).toContain(`claude mcp add --transport http cosign ${session.mcpUrl}`);

  await act(async () => button("ChatGPT").click());
  expect(heading()).toBe("Connect ChatGPT");
  expect(guide()).toContain(session.mcpUrl);
  expect(guide()).toContain("dynamic client registration");
  expect(container.querySelector(".mcp-open-client")?.getAttribute("href")).toBe("https://chatgpt.com/plugins");

  await act(async () => button("Claude").click());
  expect(heading()).toBe("Connect Claude");
  expect(guide()).toContain("Register automatically");
  expect(container.querySelector(".mcp-open-client")?.getAttribute("href")).toBe("https://claude.ai/customize/connectors");

  await act(async () => button("Codex").click());
  expect(heading()).toBe("Connect Codex");
  expect(guide()).toContain(`codex mcp add cosign --url ${session.mcpUrl}`);
  expect(guide()).toContain("codex mcp login cosign");

  await act(async () => button("Custom agent").click());
  expect(heading()).toBe("Connect your own agent");
  expect(guide()).toContain(session.mcpUrl);
  expect(guide()).toContain("Streamable HTTP");
  expect(guide()).toContain("PKCE (S256)");
  expect(guide()).toContain("get_account_context");
  expect(guide()).not.toContain("codex mcp login");
});

it("follows the browser language and keeps the selected request when switching to English", async () => {
  const rice = request("run_rice", "Rice");
  window.history.replaceState({}, "", `/?run=${rice.id}`);
  const languages = vi.spyOn(navigator, "languages", "get").mockReturnValue(["fi-FI", "en-US"]);
  vi.stubGlobal("fetch", vi.fn(async (path: string) => {
    if (path === "/api/session") return reply(session);
    if (path === "/api/runs") return reply([rice]);
    if (path.startsWith("/api/events?")) return reply([]);
    if (path === `/api/runs/${rice.id}`) return reply(rice);
    if (path === "/api/tools/browse_catalog") return reply({ products: [], hasMore: false });
    throw new Error(`Unexpected request ${path}`);
  }));
  try {
    await act(async () => root.render(<DisplayProvider><ProductionApp /></DisplayProvider>));
    expect(document.documentElement.lang).toBe("fi");
    expect(drawer().textContent).toContain("Hankintapyyntö");
    expect(drawer().textContent).toContain(rice.title);

    await act(async () => button("Sulje avustajapaneeli").click());
    await act(async () => button("Kieli ja ulkoasu").click());
    const languageSelect = container.querySelector<HTMLSelectElement>(".display-preferences-panel select")!;
    await act(async () => {
      languageSelect.value = "en";
      languageSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(document.documentElement.lang).toBe("en");
    await act(async () => button("Assistant").click());
    expect(drawer().textContent).toContain("Purchase request");
    expect(drawer().textContent).toContain(rice.title);
    expect(new URLSearchParams(window.location.search).get("run")).toBe(rice.id);
  } finally {
    languages.mockRestore();
  }
});
