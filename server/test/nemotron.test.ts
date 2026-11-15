import { describe, expect, it, vi } from "vitest";
import { NEMOTRON_MODEL, readKitchenIntake } from "../src/intake/nemotron.js";

const note = "Laktoositonta maitoa 1000 l, 16.11. klo 11. Budjetti 1450 € alv 0 %.";
const now = new Date("2026-11-14T10:00:00Z");
const extracted = {
  query: "milk", quantity: 1000, unit: "L", deadline: "2026-11-16T11:00:00+02:00",
  budgetCents: 145000, diet: "lactose-free", conflict: null,
  ranking: [], requirementEvidence: [],
  evidence: [
    { field: "query", source: "note", excerpt: "maitoa" },
    { field: "quantity", source: "note", excerpt: "1000 l" },
    { field: "unit", source: "note", excerpt: "1000 l" },
    { field: "deadline", source: "note", excerpt: "16.11. klo 11" },
    { field: "budgetCents", source: "note", excerpt: "1450 € alv 0 %" },
    { field: "diet", source: "note", excerpt: "Laktoositonta" },
  ],
};

function provider(content: unknown, finishReason = "stop") {
  return vi.fn<typeof fetch>().mockResolvedValue(Response.json({
    choices: [{ finish_reason: finishReason, message: { content: JSON.stringify(content) } }],
  }));
}

describe("Nemotron kitchen intake", () => {
  it("returns a draft from a Finnish note and includes source excerpts", async () => {
    const request = provider(extracted);
    const response = await readKitchenIntake({ note }, { now, apiKey: "test", fetch: request });
    expect(response).toMatchObject({
      status: "draft", question: null, model: NEMOTRON_MODEL,
      draft: { quantityLiters: 1000, budgetCents: 145000 }, evidence: expect.arrayContaining(extracted.evidence),
    });
    const body = JSON.parse(String(request.mock.calls[0][1]?.body));
    expect(body.tools).toBeUndefined();
    expect(body.model).toBe(NEMOTRON_MODEL);
    expect(body.response_format.type).toBe("json_schema");
  });

  it("asks for volume when a model proposes unsupported litres", async () => {
    const response = await readKitchenIntake({ note: "Laktoositonta maitoa 10 laatikkoa" }, {
      now, apiKey: "test", fetch: provider(extracted),
    });
    expect(response.status).toBe("clarify");
    expect(response.question).toContain("quantity and unit");
    expect(response.draft.quantityLiters).toBeNull();
  });

  it("rejects a truncated provider response", async () => {
    await expect(readKitchenIntake({ note }, {
      now, apiKey: "test", fetch: provider(extracted, "length"),
    })).rejects.toMatchObject({ statusCode: 502 });
  });

  it("sends an image as a multimodal part and reports source conflicts", async () => {
    const request = provider({ ...extracted, conflict: "The photo and note give different amounts." });
    const response = await readKitchenIntake({ note, image: { mimeType: "image/png", base64: "bWlsaw==" } }, {
      now, apiKey: "test", fetch: request,
    });
    expect(response.status).toBe("review_conflict");
    const body = JSON.parse(String(request.mock.calls[0][1]?.body));
    expect(body.messages[1].content[1]).toEqual({ type: "image_url", image_url: { url: "data:image/png;base64,bWlsaw==" } });
  });

  it("stops on different quantities even when the model selects a value without flagging a conflict", async () => {
    const response = await readKitchenIntake({ note, image: { mimeType: "image/png", base64: "bWlsaw==" } }, {
      now, apiKey: "test", fetch: provider({
        ...extracted,
        evidence: [...extracted.evidence, { field: "quantity", source: "image", excerpt: "Määrä: 100 l" }],
      }),
    });
    expect(response).toMatchObject({
      status: "review_conflict", draft: { quantity: null, unit: null, quantityLiters: null },
      conflictEvidence: [{ source: "note", excerpt: "1000 l" }, { source: "image", excerpt: "Määrä: 100 l" }],
    });
    expect(response.evidence.some(({ field }) => field === "quantity" || field === "unit")).toBe(false);
  });

  it.each(["1 000 000 ml", "1000 l", "1000 l in 1 L bottles"])("accepts the same total in both sources with photo amount %s", async (photo) => {
    const response = await readKitchenIntake({ note, image: { mimeType: "image/png", base64: "bWlsaw==" } }, {
      now, apiKey: "test", fetch: provider({
        ...extracted,
        evidence: [...extracted.evidence, { field: "quantity", source: "image", excerpt: photo }],
      }),
    });
    expect(response).toMatchObject({ status: "draft", draft: { quantityLiters: 1000 } });
    expect(response.conflictEvidence).toBeUndefined();
  });

  it("requires a written time and matching litre amount even when the provider supplies both", async () => {
    const note = "Lactose-free milk, 10 boxes of 1 L each. For 24 November 2080. Total €1450 ex VAT.";
    const response = await readKitchenIntake({ note }, { now, apiKey: "test", fetch: provider({
      ...extracted,
      quantity: 1,
      deadline: "2080-11-24T00:00:00+02:00",
      evidence: [
        { field: "quantity", source: "note", excerpt: "10 boxes of 1 L each" },
        { field: "deadline", source: "note", excerpt: "24 November 2080" },
      ],
    }) });
    expect(response.draft).toMatchObject({ quantityLiters: null, deadline: null, deadlineDate: "2080-11-24" });
    expect(response.status).toBe("clarify");
  });

  it("resolves a relative photo deadline from the cited phrase", async () => {
    const response = await readKitchenIntake({ note: "", image: { mimeType: "image/png", base64: "bWlsaw==" } }, {
      now, apiKey: "test", fetch: provider({
        ...extracted, deadline: null,
        evidence: [{ field: "deadlineDate", source: "image", excerpt: "Before next Friday" }],
      }),
    });
    expect(response.draft).toMatchObject({ deadline: null, deadlineDate: "2026-11-19" });
    expect(response.evidence).toEqual([{ field: "deadlineDate", source: "image", excerpt: "Before next Friday" }]);
  });

  it("keeps the draft empty for different delivery days in a note and photo", async () => {
    const response = await readKitchenIntake({ note: "Deliver by next Friday", image: { mimeType: "image/png", base64: "bWlsaw==" } }, {
      now, apiKey: "test", fetch: provider({
        ...extracted, deadline: null,
        evidence: [{ field: "deadlineDate", source: "image", excerpt: "Before next Friday" }],
      }),
    });
    expect(response).toMatchObject({
      status: "review_conflict", draft: { deadline: null },
      conflictEvidence: [{ source: "note", excerpt: "by next Friday" }, { source: "image", excerpt: "Before next Friday" }],
    });
    expect(response.draft).not.toHaveProperty("deadlineDate");
  });

  it("labels an image-only excerpt as photo evidence and rejects boxes as litres", async () => {
    const response = await readKitchenIntake({ note: "", image: { mimeType: "image/png", base64: "bWlsaw==" } }, {
      now, apiKey: "test", fetch: provider({
        ...extracted,
        quantity: 10,
        evidence: [
          { field: "query", source: "note", excerpt: "maito" },
          { field: "quantity", source: "note", excerpt: "10 laatikkoa" },
        ],
      }),
    });
    expect(response.draft).toMatchObject({ query: "milk", quantityLiters: null });
    expect(response.evidence).toEqual([{ field: "query", source: "image", excerpt: "maito" }]);
  });

  it("preserves sourced conflict evidence without prefilling the conflicting quantity", async () => {
    const note = "Use 100 l or 1000 l for the same order.";
    const response = await readKitchenIntake({ note }, { now, apiKey: "test", fetch: provider({
      ...extracted,
      quantity: null, unit: null,
      conflict: "Two different amounts",
      evidence: [{ field: "conflict", source: "note", excerpt: note }],
    }) });
    expect(response).toMatchObject({ status: "review_conflict", conflictEvidence: [{ source: "note", excerpt: note }] });
    expect(response.draft.quantityLiters).toBeNull();
  });

  it("keeps the explicit source year and removes a redundant dietary qualifier from the query", async () => {
    const response = await readKitchenIntake({ note: "", image: { mimeType: "image/png", base64: "bWlsaw==" } }, {
      now, apiKey: "test", fetch: provider({
        ...extracted,
        query: "milk lactose-free",
        deadline: "2026-11-24T11:00:00+02:00",
        evidence: [
          { field: "query", source: "image", excerpt: "Tuote: laktoositon maito (milk)" },
          { field: "diet", source: "image", excerpt: "laktoositon maito" },
          { field: "deadline", source: "image", excerpt: "Toimitus: 24.11.2080 klo 11 (Helsinki)" },
        ],
      }),
    });
    expect(response.draft).toMatchObject({ query: "milk", deadline: "2080-11-24T09:00:00.000Z" });
  });

  it("uses supported dietary and ranking excerpts from a photographed kitchen request", async () => {
    const response = await readKitchenIntake({ note: "", image: { mimeType: "image/png", base64: "bWlsaw==" } }, {
      now, apiKey: "test", fetch: provider({
        ...extracted,
        query: "gluten-free vegan pasta", diet: null,
        evidence: [{ field: "query", source: "image", excerpt: "Gluteeniton ja vegaaninen pasta" }],
        requirementEvidence: [
          { requirement: "gluten-free", source: "image", excerpt: "Gluteeniton ja vegaaninen pasta" },
          { requirement: "vegan", source: "image", excerpt: "Gluteeniton ja vegaaninen pasta" },
          { requirement: "high-protein", source: "image", excerpt: "High protein optional" },
          { requirement: "lactose-free", source: "image", excerpt: "Regular milk" },
        ],
        ranking: [{ objective: "carbon", source: "image", excerpt: "Suosi pienintä hiilijalanjälkeä." }],
      }),
    });
    expect(response.draft).toMatchObject({ query: "pasta", requirements: ["gluten-free", "vegan"], rankingObjective: "carbon" });
    expect(response.requirementEvidence?.map(({ requirement }) => requirement)).toEqual(["gluten-free", "vegan"]);
    expect(response.rankingEvidence).toEqual({ source: "image", excerpt: "Suosi pienintä hiilijalanjälkeä." });
  });

  it("recovers photo product requirements from the cited product line if the model omits them", async () => {
    const photo = { mimeType: "image/png" as const, base64: "bWlsaw==" };
    const excerpt = "Product: Vegan gluten-free pasta";
    const photoDraft = (query: string, excerpt: string) => readKitchenIntake({ note: "", image: photo }, {
      now, apiKey: "test", fetch: provider({ ...extracted, query, diet: null,
        evidence: [{ field: "query", source: "image", excerpt }],
      }),
    });
    const pantry = await photoDraft("pasta", excerpt);
    expect(pantry).toMatchObject({
      draft: { requirements: ["vegan", "gluten-free"] },
      requirementEvidence: [{ requirement: "vegan", source: "image", excerpt }, { requirement: "gluten-free", source: "image", excerpt }],
    });
    const milk = await photoDraft("milk", "Tuote: laktoositon maito (milk)");
    expect(milk).toMatchObject({ draft: { diet: "lactose-free", requirements: ["lactose-free"] } });
    const optional = await photoDraft("pasta", "Product: Vegan pasta if possible");
    expect(optional.draft.requirements).toBeUndefined();
    const alternative = await photoDraft("pasta", "Product: Vegan or gluten-free pasta");
    expect(alternative.draft.requirements).toBeUndefined();
  });

  it("leaves the priority unset when note and photo priorities disagree", async () => {
    const priority = "Prioritize delivery reliability.";
    const response = await readKitchenIntake({ note: `${note}\n${priority}`, image: { mimeType: "image/png", base64: "bWlsaw==" } }, {
      now, apiKey: "test", fetch: provider({
        ...extracted,
        ranking: [
          { objective: "reliability", source: "note", excerpt: priority },
          { objective: "carbon", source: "image", excerpt: "Prioritize lower carbon." },
        ],
      }),
    });
    expect(response.draft.rankingObjective).toBeUndefined();
    expect(response.rankingEvidence).toBeUndefined();
  });

  it("leaves a typed ranking unset when the model provides no evidence from an attached photo", async () => {
    const priority = "Prioritize delivery reliability.";
    const response = await readKitchenIntake({ note: `${note}\n${priority}`, image: { mimeType: "image/png", base64: "bWlsaw==" } }, {
      now, apiKey: "test", fetch: provider({
        ...extracted,
        ranking: [{ objective: "reliability", source: "note", excerpt: priority }],
      }),
    });
    expect(response.draft.rankingObjective).toBeUndefined();
    expect(response.rankingEvidence).toBeUndefined();
  });

  it("does not accept a shortened excerpt that omits an explicit optional condition or negation", async () => {
    const note = "Milk 1000 L. Lactose-free is optional. Do not prioritize lower carbon.";
    const response = await readKitchenIntake({ note }, {
      now, apiKey: "test", fetch: provider({
        ...extracted,
        evidence: [{ field: "diet", source: "note", excerpt: "Lactose-free" }],
        requirementEvidence: [{ requirement: "lactose-free", source: "note", excerpt: "Lactose-free" }],
        ranking: [{ objective: "carbon", source: "note", excerpt: "prioritize lower carbon" }],
      }),
    });
    expect(response.draft.diet).toBeNull();
    expect(response.draft.requirements).toBeUndefined();
    expect(response.draft.rankingObjective).toBeUndefined();
  });
});
