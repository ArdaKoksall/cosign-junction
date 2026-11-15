import { createFixtureAdapter, type CatalogAdapter } from "@cosign/adapters";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { estimateBudget } from "../src/intake/budget.js";
import { NEMOTRON_MODEL } from "../src/intake/nemotron.js";
import { JsonStore } from "../src/store.js";

const now = () => new Date("2026-11-14T10:00:00Z");

async function draft(note: string, adapter: CatalogAdapter = createFixtureAdapter(), nvidiaApiKey?: string, image?: { mimeType: string; base64: string }, clock = now) {
  const app = await buildApp(new JsonStore("unused.json"), { adapter, now: clock, nvidiaApiKey });
  try {
    const response = await app.inject({ method: "POST", url: "/api/intake", payload: { note, image } });
    expect(response.statusCode).toBe(200);
    return response.json();
  } finally {
    await app.close();
  }
}

function mockProvider(output: Record<string, unknown>) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
    choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
      query: null, quantity: null, unit: null, deadline: null, budgetCents: null, diet: null,
      conflict: null, evidence: [], requirementEvidence: [], ranking: [], ...output,
    }) } }],
  })));
}

afterEach(() => vi.unstubAllGlobals());

describe("typed product intake", () => {
  it("separates chicken breast, weight and a planning budget without NVIDIA", async () => {
    expect(await draft("10kg chicken breast")).toMatchObject({
      model: "local",
      draft: { query: "chicken breast", quantity: 10, unit: "kg", quantityLiters: null, budgetCents: null },
      budgetEstimate: { totalCents: 9000, source: "planning_reference" },
      question: "What date and time is the delivery due?",
    });
  });

  it("keeps an explicit buyer budget and ignores an ambiguous measurement range", async () => {
    expect(await draft("We need 2,5 kg chicken breast. Budget €25.")).toMatchObject({
      draft: { query: "chicken breast", quantity: 2.5, unit: "kg", budgetCents: 2500 },
      budgetEstimate: null,
    });
    for (const range of ["5–10", "5-10"]) {
      expect(await draft(`${range} kg chicken breast`)).toMatchObject({
        status: "review_conflict",
        draft: { quantity: null, unit: null },
        budgetEstimate: null,
      });
    }
  });

  it("pulls a product, lactose requirement, budget, and delivery from a typed sentence", async () => {
    expect(await draft("I want to buy 2,5 kg of lactos-free Greek yogurt tomorrow at 11 under €40.")).toMatchObject({
      status: "draft",
      draft: {
        query: "Greek yogurt", quantity: 2.5, unit: "kg", diet: "lactose-free", budgetCents: 4000,
        deadline: "2026-11-15T09:00:00.000Z",
      },
      evidence: expect.arrayContaining([{ field: "diet", source: "note", excerpt: "lactos-free" }]),
    });
  });

  it.each([
    ["before next Friday", "2026-11-19"],
    ["by next Friday", "2026-11-20"],
    ["for 20 November 2026", "2026-11-20"],
    ["ennen ensi perjantaita", "2026-11-19"],
  ])("suggests a calendar day for %s and leaves the clock time unset", async (phrase, deadlineDate) => {
    expect(await draft(`12 kg of cheese ${phrase}`)).toMatchObject({
      status: "clarify", question: "What time is the delivery due?",
      draft: { query: "cheese", quantity: 12, unit: "kg", deadlineDate, deadline: null },
      evidence: expect.arrayContaining([{ field: "deadlineDate", source: "note", excerpt: phrase }]),
    });
  });

  it("resolves a Friday deadline at the specified Helsinki time", async () => {
    const result = await draft("12 kg of cheese before next Friday at 14:30. Budget €150 ex VAT.");
    expect(result).toMatchObject({ status: "draft", draft: { query: "cheese", deadline: "2026-11-20T12:30:00.000Z" } });
    expect(result.draft).not.toHaveProperty("deadlineDate");
  });

  it.each([
    ["28 october", "2027-10-28"],
    ["the 28th of October.", "2027-10-28"],
    ["28.10.", "2027-10-28"],
    ["28 November", "2026-11-28"],
    ["29 February", "2028-02-29"],
  ])("fills a standalone yearless date without replacing the product: %s", async (note, deadlineDate) => {
    mockProvider({});
    expect(await draft(note, undefined, "test")).toMatchObject({
      model: "local", question: "What time is the delivery due?",
      draft: { query: null, deadlineDate, deadline: null },
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rolls an exact yearless deadline forward while keeping the spoken Helsinki time", async () => {
    expect(await draft("12 kg chicken breast by 28 October at 10 am. Budget €400.")).toMatchObject({
      draft: { query: "chicken breast", deadline: "2027-10-28T07:00:00.000Z" },
    });
    expect(await draft("12 kg chicken breast before 28 October.")).toMatchObject({
      draft: { deadline: null, deadlineDate: "2027-10-27" },
    });
  });

  it.each(["28 October 2026", "31 April"])("asks for a future date without changing the product for %s", async (note) => {
    const result = await draft(note);
    expect(result).toMatchObject({ question: "What future date and time is the delivery due?", draft: { query: null, deadline: null } });
    expect(result.draft).not.toHaveProperty("deadlineDate");
  });

  it("fills a month-end deadline and explicit carbon priority from the example order", async () => {
    const order = "20 kg of chicken breast until the last day of this month 10 pm";
    const result = await draft(`${order} with lowest carbon priority.`);
    expect(result).toMatchObject({
      draft: { query: "chicken breast", quantity: 20, unit: "kg", deadline: "2026-11-30T20:00:00.000Z", rankingObjective: "carbon" },
      evidence: expect.arrayContaining([{ field: "deadline", source: "note", excerpt: "until the last day of this month 10 pm" }]),
      rankingEvidence: { source: "note", excerpt: expect.stringContaining("lowest carbon priority") },
    });
    const withoutPriority = await draft(order);
    expect(withoutPriority.draft).not.toHaveProperty("rankingObjective");
    expect(withoutPriority).not.toHaveProperty("rankingEvidence");
    expect(await draft("20 kg of chicken breast with lowest carbon priority.")).toMatchObject({
      draft: { query: "chicken breast", quantity: 20, rankingObjective: "carbon" },
    });
  });

  it.each([
    ["2028-01-31T22:30:00Z", "2028-02-29T20:00:00.000Z"],
    ["2026-12-14T10:00:00Z", "2026-12-31T20:00:00.000Z"],
    ["2027-07-14T10:00:00Z", "2027-07-31T19:00:00.000Z"],
  ])("calculates the current Helsinki month's last day from %s", async (reference, deadline) => {
    const result = await draft("20 kg of chicken breast until the end of this month 10 pm", undefined, undefined, undefined, () => new Date(reference));
    expect(result.draft).toMatchObject({ query: "chicken breast", deadline });
  });

  it("keeps the time blank for a month-end date without a clock", async () => {
    expect(await draft("20 kg of chicken breast until the last day of this month")).toMatchObject({
      question: "What time is the delivery due?", draft: { deadline: null, deadlineDate: "2026-11-30" },
    });
  });

  it.each([false, true])("fills the colloquial order when the hosted reader is enabled: %s", async (hosted) => {
    const note = "12 kgs of chicken breast until  20th of this month, 10 am. budget is 400eur, lowest carbon intensity.";
    if (hosted) {
      mockProvider({ query: "chicken breast", budgetCents: 40000, evidence: [
        { field: "query", source: "note", excerpt: "12 kgs of chicken breast" },
        { field: "budgetCents", source: "note", excerpt: "budget is 400eur" },
      ] });
    }
    expect(await draft(note, undefined, hosted ? "test" : undefined)).toMatchObject({
      model: hosted ? NEMOTRON_MODEL : "local", status: "draft", question: null,
      draft: { query: "chicken breast", quantity: 12, unit: "kg", deadline: "2026-11-20T08:00:00.000Z",
        budgetCents: 40000, rankingObjective: "carbon" },
      evidence: expect.arrayContaining([
        { field: "quantity", source: "note", excerpt: "12 kgs" },
        { field: "deadline", source: "note", excerpt: "until  20th of this month, 10 am." },
      ]),
      rankingEvidence: { source: "note", excerpt: expect.stringContaining("lowest carbon intensity") },
    });
  });

  it("keeps a day without a clock and rejects invalid ordinal dates", async () => {
    expect(await draft("12 kgs of chicken breast until the 21st of this month")).toMatchObject({
      question: "What time is the delivery due?", draft: { deadline: null, deadlineDate: "2026-11-21" },
    });
    for (const day of ["31st", "21th"]) {
      const result = await draft(`12 kgs of chicken breast until the ${day} of this month, 10 am`);
      expect(result.draft.deadline).toBeNull();
      expect(result.draft).not.toHaveProperty("deadlineDate");
    }
  });

  it("asks for the date when two different weekdays are given", async () => {
    const result = await draft("12 kg of cheese by Thursday or Friday.");
    expect(result).toMatchObject({ question: "What date and time is the delivery due?", draft: { deadline: null } });
    expect(result.draft).not.toHaveProperty("deadlineDate");
  });

  it.each(["Friday at 10 am or 11 am", "10 am or 11 am on Friday", "Friday 10:00–11:00"])(
    "keeps the date but asks for a time when the note says %s", async (deadlinePhrase) => {
      expect(await draft(`12 kg of cheese by ${deadlinePhrase}. Budget 400 euros.`)).toMatchObject({
        status: "clarify", question: "What time is the delivery due?", draft: { deadline: null, deadlineDate: "2026-11-20" },
      });
    },
  );

  it("retains a numeric product code, even when the product is on its own line", async () => {
    expect(await draft("12 cartons\nSKU: 460001\nBudget 40 EUR")).toMatchObject({
      draft: { query: "460001", quantity: 12, unit: "case", budgetCents: 4000 },
      question: "What date and time is the delivery due?",
    });
    expect(await draft("6408430100330")).toMatchObject({
      draft: { query: "6408430100330", quantity: null, unit: null },
      question: "What total quantity and unit does the kitchen need?",
    });
  });

  it("keeps multiple typed product requirements when filling in a request", async () => {
    const purchase = "I need 3 kg of vegan and gluten-free pasta tomorrow at 12";
    expect(await draft(`${purchase}; budget €40`)).toMatchObject({
      draft: { query: "pasta", quantity: 3, unit: "kg", requirements: ["vegan", "gluten-free"], budgetCents: 4000 },
      requirementEvidence: ["vegan", "gluten-free"].map((requirement) => ({ requirement, source: "note", excerpt: purchase })),
    });
  });

  it("keeps a mandatory dietary requirement beside a separate optional one", async () => {
    const result = await draft("I need 3 kg of vegan pasta, gluten-free if possible. Budget €40.");
    expect(result.draft.requirements).toEqual(["vegan"]);
    expect(result.requirementEvidence).toEqual([{ requirement: "vegan", source: "note", excerpt: "I need 3 kg of vegan pasta" }]);
    expect((await draft("I need 3 kg of lactose-free pasta, if possible. Budget €40.")).draft).toMatchObject({ diet: null });
  });

  it("keeps a sourced buyer priority when Nemotron omits it from a typed draft", async () => {
    mockProvider({ query: "milk", evidence: [{ field: "query", source: "note", excerpt: "milk" }] });
    const priority = "Delivery reliability matters more than the lowest cost.";
    expect(await draft(`1000 L of milk tomorrow at 12. ${priority} Budget 1450 EUR.`, createFixtureAdapter(), "test"))
      .toMatchObject({ model: NEMOTRON_MODEL, draft: { rankingObjective: "reliability" }, rankingEvidence: { source: "note", excerpt: priority } });
  });

  it("uses the typed case count and buyer cap when Nemotron cites a pack size and unit price", async () => {
    const note = "10 cases of 1 L milk by 10 AM on November 20th. Unit price 8 euros per litre. Total budget 80 euros. Lowest carbon intensity.";
    mockProvider({ query: "milk", quantity: 1, unit: "L", deadline: "2026-11-21T10:00:00+02:00", budgetCents: 800, evidence: [
      { field: "query", source: "note", excerpt: "milk" },
      { field: "quantity", source: "note", excerpt: "1 L" },
      { field: "deadline", source: "note", excerpt: "10 AM" },
      { field: "budgetCents", source: "note", excerpt: "8 euros" },
    ] });
    expect(await draft(note, undefined, "test")).toMatchObject({
      model: NEMOTRON_MODEL,
      draft: { query: "milk", quantity: 10, unit: "case", quantityLiters: null, budgetCents: 8000,
        deadline: "2026-11-20T08:00:00.000Z", rankingObjective: "carbon" },
      evidence: expect.arrayContaining([
        { field: "quantity", source: "note", excerpt: "10 cases" },
        { field: "budgetCents", source: "note", excerpt: "80 euros" },
      ]),
    });
  });

  it("fills known fields after every proposed provider excerpt fails grounding", async () => {
    mockProvider({ quantity: 2, unit: "L", evidence: [{ field: "quantity", source: "note", excerpt: "2 litres" }] });
    const note = "12 kilograms of chicken breast by November 20, 2026 at 10 am. Budget 400 euros.";
    const result = await draft(note, undefined, "test");
    expect(result).toMatchObject({
      model: NEMOTRON_MODEL, status: "draft",
      draft: { query: "chicken breast", quantity: 12, unit: "kg", deadline: "2026-11-20T08:00:00.000Z", budgetCents: 40000 },
    });
    expect(result).not.toHaveProperty("providerAbstained");
  });

  it("omits a supplier unit price misread as the buyer's total budget", async () => {
    mockProvider({ query: "milk", budgetCents: 800, evidence: [
      { field: "query", source: "note", excerpt: "milk" },
      { field: "budgetCents", source: "note", excerpt: "8 euros" },
    ] });
    expect(await draft("10 litres of milk tomorrow at 11. Price is 8 euros per litre.", undefined, "test")).toMatchObject({
      status: "clarify", question: "What is the total budget in euros excluding VAT?",
      draft: { quantity: 10, unit: "L", budgetCents: null },
    });
  });

  it("preserves a grounded deadline in a punctuation-free dictation", async () => {
    expect(await draft("12 kilograms of chicken breast until the 20th of this month at 10 AM budget is 400 euros lowest carbon intensity"))
      .toMatchObject({ draft: { query: "chicken breast", quantity: 12, unit: "kg", budgetCents: 40000, deadline: "2026-11-20T08:00:00.000Z", rankingObjective: "carbon" } });
  });

  it("uses the spoken weight, even when the hosted reader omits it", async () => {
    const note = "three kilograms of chicken meat until 28th October.";
    mockProvider({ query: "chicken meat", evidence: [{ field: "query", source: "note", excerpt: "chicken meat" }] });
    const result = await draft(note, undefined, "test");
    expect(result).toMatchObject({
      question: "What time is the delivery due?",
      draft: { query: "chicken meat", quantity: 3, unit: "kg", deadline: null, deadlineDate: "2027-10-28", budgetCents: null },
      evidence: expect.arrayContaining([
        { field: "quantity", source: "note", excerpt: "three kilograms" },
        { field: "unit", source: "note", excerpt: "three kilograms" },
      ]),
    });
  });

  it.each([
    ["twenty-three kilograms", 23],
    ["one hundred and twenty kilograms", 120],
    ["three point five kilograms", 3.5],
  ])("reads %s as a single quantity", async (amount, quantity) => {
    expect(await draft(`${amount} of chicken breast`)).toMatchObject({
      draft: { query: "chicken breast", quantity, unit: "kg" },
    });
  });

  it.each(["two or three kilograms", "two to 3 kilograms", "three kilograms or four"])("does not select a quantity from %s", async (amount) => {
    expect(await draft(`${amount} of chicken meat`)).toMatchObject({
      status: "review_conflict", draft: { quantity: null, unit: null },
    });
  });

  it("keeps a model abstention empty when a typed challenge example has no real request", async () => {
    mockProvider({});
    const example = "Challenge example: order 10 L of lactose-free milk tomorrow at 12. Budget €40.";
    const result = await draft(example, createFixtureAdapter(), "test");
    expect(result).toMatchObject({
      model: NEMOTRON_MODEL, status: "clarify", evidence: [], budgetEstimate: null,
      draft: { query: null, quantity: null, unit: null, deadline: null, budgetCents: null, diet: null },
    });
    expect(result.draft).not.toHaveProperty("requirements");
    expect(result.draft).not.toHaveProperty("rankingObjective");
    expect(result).not.toHaveProperty("providerAbstained");
  });

  it("returns both sources and withholds a budget estimate for a photo and note quantity conflict", async () => {
    mockProvider({
      query: "milk", quantity: 10, unit: "case",
      evidence: [
        { field: "query", source: "image", excerpt: "Tuote: maito" },
        { field: "quantity", source: "image", excerpt: "Määrä: 10 laatikkoa" },
      ],
    });
    expect(await draft("Request 100 L of milk.", createFixtureAdapter(), "test", { mimeType: "image/png", base64: "bWlsaw==" }))
      .toMatchObject({ model: NEMOTRON_MODEL, status: "review_conflict", budgetEstimate: null,
        draft: { query: "milk", quantity: null, unit: null, quantityLiters: null },
        conflictEvidence: [{ source: "note", excerpt: "100 L" }, { source: "image", excerpt: "Määrä: 10 laatikkoa" }],
      });
  });

  it.each([
    "Compare price, delivery reliability and carbon footprint.",
    "Prioritize keeping within budget.",
    "Do not prioritize the lowest carbon footprint.",
    "Prioritize carbon or reliability.",
    "Prioritize carbon. Prioritize reliability.",
    "Prioritize the lowest reliability.",
  ])("leaves ranking unset when the note reads %s", async (phrase) => {
    const result = await draft(`1000 L of milk tomorrow at 12. Budget 1450 EUR. ${phrase}`);
    expect(result.draft).not.toHaveProperty("rankingObjective");
    expect(result).not.toHaveProperty("rankingEvidence");
  });

  it("keeps note qualifiers out of the product name", async () => {
    expect(await draft("6 cases of vegetable stock, no dietary restrictions. 80 EUR ex VAT.")).toMatchObject({
      draft: { query: "vegetable stock", quantity: 6, unit: "case", diet: "none", budgetCents: 8000 },
    });
    expect(await draft("75 L, milk 2026-11-16T09:00Z")).toMatchObject({
      draft: { query: "milk", quantity: 75, unit: "L", deadline: "2026-11-16T09:00:00.000Z" },
    });
    expect(await draft("Need 200 L of milk under 50 EUR")).toMatchObject({
      draft: { query: "milk", quantity: 200, unit: "L", budgetCents: 5000 },
    });
  });

  it("keeps a bottle count separate from its volume", async () => {
    expect(await draft("10 bottles of lactose-free milk")).toMatchObject({
      draft: { query: "milk", quantity: 10, unit: "each", diet: "lactose-free", quantityLiters: null },
    });
    expect(await draft("10 bottles of 500 ml lactose-free milk")).toMatchObject({
      draft: { query: "500 ml milk", quantity: 10, unit: "each", diet: "lactose-free", quantityLiters: null },
    });
  });

  it.each([
    ["availability", { source: "supplier_catalog", totalCents: 11200 }],
    ["price", null],
  ] as const)("handles a failed %s feed when estimating sellable packs", async (endpoint, budgetEstimate) => {
    const fixture = createFixtureAdapter();
    const lookup = vi.fn<CatalogAdapter["lookup"]>(async (input) => {
      const observed = await fixture.lookup(input);
      return {
        ...observed,
        source: { ...observed.source, kind: "VALIO_LIVE" },
        errors: [{ endpoint, code: "HTTP_ERROR", detail: `${endpoint} HTTP 503` }],
      };
    });
    const adapter: CatalogAdapter = {
      kind: "VALIO_LIVE",
      loadCatalog: fixture.loadCatalog.bind(fixture),
      shortlist: fixture.shortlist.bind(fixture),
      signals: fixture.signals.bind(fixture),
      lookup,
    };
    expect(await draft("75 L lactose-free milk, delivery 16.11. klo 11.", adapter)).toMatchObject({
      status: budgetEstimate ? "draft" : "clarify",
      draft: { quantity: 75, unit: "L", quantityLiters: 75, deadline: "2026-11-16T09:00:00.000Z" },
      budgetEstimate,
    });
    expect(lookup).toHaveBeenCalledWith(expect.objectContaining({ requestedDate: "2026-11-16", priceOnly: true }));
  });

  it("cancels the pricing lookup when the intake estimate times out", async () => {
    const fixture = createFixtureAdapter();
    await fixture.loadCatalog();
    const lookup = vi.fn<CatalogAdapter["lookup"]>(() => new Promise(() => {}));
    const adapter: CatalogAdapter = {
      kind: "VALIO_LIVE",
      loadCatalog: fixture.loadCatalog.bind(fixture),
      shortlist: fixture.shortlist.bind(fixture),
      signals: fixture.signals.bind(fixture),
      lookup,
    };
    vi.useFakeTimers();
    try {
      const pending = estimateBudget({
        query: "milk", quantity: 75, unit: "L", diet: "lactose-free", deadline: null, budgetCents: null,
      }, adapter, now(), true);
      await vi.advanceTimersByTimeAsync(4999);
      const signal = lookup.mock.calls[0]?.[0].signal;
      expect(signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(signal?.aborted).toBe(true);
      expect(await pending).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
