import { createFixtureAdapter, indexCatalog, shortlistCatalog } from "@cosign/adapters";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { JsonStore } from "../src/store.js";

const catalog = indexCatalog([{
  id: "croissant", salesUnit: "ST", baseUnit: "ST", units: [{ unitId: "ST", sizeInBaseUnits: 1 }],
  synkkaData: {
    names: [{ language: "en", value: "Butter croissant" }],
    unitConversions: [{ synkkaPackagingType: "BASE_UNIT_OR_EACH", netWeight: { value: 0.06, unit: "KGM" } }],
    classifications: [{ name: "allergen", values: [{ id: "AW", unit: "CONTAINS" }] }],
  },
}], { label: "Comparison closest catalog", revision: 1, observedAt: "2026-11-14T10:00:00Z" });

const fixture = createFixtureAdapter();
const dir = await mkdtemp(join(tmpdir(), "junction-closest-"));
const app = await buildApp(new JsonStore(join(dir, "state.json")), {
  adapter: {
    kind: "FIXTURE", loadCatalog: async () => catalog,
    shortlist: async (query) => shortlistCatalog(catalog, query),
    signals: fixture.signals.bind(fixture), lookup: fixture.lookup.bind(fixture),
  },
});
afterAll(async () => {
  await app.close();
  await rm(dir, { recursive: true, force: true });
});

it("shows the closest catalog products when no product has every required declaration", async () => {
  const created = await app.inject({
    method: "POST", url: "/api/requests",
    payload: { query: "croissant", quantity: 10, unit: "each", requirements: ["gluten-free"], budgetCents: 10_000, deadline: "2099-01-05T09:00:00+02:00" },
  });
  expect(created.statusCode, created.body).toBe(201);
  const { requestId } = created.json();

  const compared = await app.inject({ method: "POST", url: `/api/requests/${requestId}/compare` });
  expect(compared.statusCode, compared.body).toBe(200);
  const expected = [{
    productId: "croissant", name: "Butter croissant", healthRisk: true,
    mismatches: [{ kind: "requirement", requirement: "gluten-free", status: "not_met", healthRisk: true }],
  }];
  expect(compared.json()).toMatchObject({ decision: { outcome: "no_match" }, closestProducts: expected });

  const saved = await app.inject({ method: "GET", url: `/api/requests/${requestId}` });
  expect(saved.json().comparison.closestProducts).toEqual(expected);
});
