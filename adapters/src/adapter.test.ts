import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import {
  UNKNOWN_STOCK_SENTINEL,
  claimGate,
  createCatalogAdapter,
  createFixtureAdapter,
  createLiveAdapter,
  indexCatalog,
  joinSignals,
  loadCatalogFile,
  loadSignalTables,
  normalizeAvailability,
  normalizeCatalogProduct,
  normalizePrice,
  shortlistCatalog
} from "./index.js";
import type { CatalogIndex } from "./types.js";

const fixtureDir = join(fileURLToPath(new URL(".", import.meta.url)), "..", "fixtures");

describe("fixture catalog shortlist", () => {
  it("filters locally before lookup and keeps lactose-free evidence", async () => {
    const adapter = createFixtureAdapter();
    const items = await adapter.shortlist({
      query: "lactose-free milk",
      requiredClaims: ["FREE_FROM_LACTOSE"],
      includeSubstitutes: true,
      productIds: ["M0"]
    });
    const ids = items.map((i) => i.product.id);
    expect(ids).toContain("M0");
    expect(ids).toContain("M1");
    expect(ids).not.toContain("M2");
    expect(ids).not.toContain("M3");
    expect(items[0]?.product.amountPerSellUnit).toBe(10_000);
    expect(items[0]?.product.amountDimension).toBe("ml");
    expect(items[0]?.source.kind).toBe("FIXTURE");
  });

  it("rejects contradicted and missing lactose evidence via claimGate", async () => {
    const catalog = await createFixtureAdapter().loadCatalog();
    expect(claimGate(catalog.products.get("M1")!, ["FREE_FROM_LACTOSE"])).toBeUndefined();
    expect(claimGate(catalog.products.get("M2")!, ["FREE_FROM_LACTOSE"])).toBe("CLAIM_NOT_MET");
    expect(claimGate(catalog.products.get("M3")!, ["FREE_FROM_LACTOSE"])).toBe("CLAIM_UNKNOWN");
  });
});

describe("catalog packaging levels", () => {
  const casePack = {
    id: "469330",
    salesUnit: "KI",
    salesUnitGtin: "6413300715644",
    baseUnit: "ST",
    units: [
      { unitId: "KI", gtin: "6413300715644", sizeInBaseUnits: 5 },
      { unitId: "ST", gtin: "6413300011531", sizeInBaseUnits: 1 },
    ],
  };
  const caseVolume = { synkkaPackagingType: "CASE", volume: { unit: "LTR", value: 5 } };

  it("uses the case volume directly and scales an explicitly labeled base volume", () => {
    const fromCase = normalizeCatalogProduct({
      ...casePack,
      synkkaData: { unitConversions: [caseVolume] },
    });
    const fromBase = normalizeCatalogProduct({
      ...casePack,
      synkkaData: {
        unitConversions: [{ synkkaPackagingType: "BASE_UNIT_OR_EACH", volume: { unit: "MLT", value: 1000 } }],
      },
    });
    for (const product of [fromCase, fromBase]) {
      expect(product).toMatchObject({ amountPerSellUnit: 5000, amountDimension: "ml", packNotes: [] });
    }
  });

  it("leaves ambiguous measurements unmapped", () => {
    const piece = normalizeCatalogProduct({
      ...casePack,
      salesUnit: "ST",
      salesUnitGtin: casePack.units[1]?.gtin,
      synkkaData: { unitConversions: [caseVolume] },
    });
    const mismatchedBarcode = normalizeCatalogProduct({
      ...casePack,
      salesUnitGtin: casePack.units[1]?.gtin,
      synkkaData: { unitConversions: [caseVolume] },
    });
    for (const product of [piece, mismatchedBarcode]) {
      expect(product).toMatchObject({
        amountPerSellUnit: null,
        amountDimension: "unmapped",
        packNotes: ["PACK_UNMAPPED"],
      });
    }
  });
});

describe("signals", () => {
  it("joins reliability and product-group carbon and labels missing values", async () => {
    const tables = await loadSignalTables({
      reliabilityPath: join(fixtureDir, "reliability.csv"),
      carbonPath: join(fixtureDir, "carbon.csv"),
      kind: "FIXTURE"
    });
    const [m1, m3] = joinSignals(tables, ["M1", "M3"]);
    expect(m1?.reliability.present).toBe(true);
    expect(m1?.reliability.value).toBe(0.91);
    expect(m1?.carbonKgCo2ePerKg.granularity).toBe("PRODUCT_GROUP");
    expect(m3?.reliability.present).toBe(false);
    expect(m3?.carbonKgCo2ePerKg.present).toBe(false);
  });
});

describe("price and availability normalization", () => {
  it.each([9_999_999_999, 1_000_000, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "does not treat unverified stock %s as usable supply",
    (availableAmount) => {
      const observation = normalizeAvailability(
        {
          productId: "SUSPECT",
          salesBlock: false,
          scheduleLines: [{ salesBlock: false, availableAmount, salesUnit: "ST", availableDate: "2026-11-16" }],
        },
        { requestedDate: "2026-11-16" },
      );
      expect(observation.stockUnknown).toBe(true);
      expect(observation.usable).toBe(false);
      expect(observation.availableSellUnits).toBeUndefined();
      expect(observation.errors.map((error) => error.code)).toContain("STOCK_UNKNOWN");
    },
  );

  it("treats 999999 as unknown stock, not a confirmed quantity", () => {
    const observation = normalizeAvailability(
      {
        productId: "TERM",
        closingTime: "2026-11-12T15:00:00+0200",
        salesBlock: false,
        logisticModel: "Terminal",
        scheduleLines: [
          {
            salesBlock: false,
            availableAmount: UNKNOWN_STOCK_SENTINEL,
            availableDate: "2026-11-16",
            salesUnit: "ST"
          }
        ]
      },
      {
        timeNow: "2026-11-13T19:39:00+0200",
        requestedDate: "2026-11-16"
      }
    );
    expect(observation.stockUnknown).toBe(true);
    expect(observation.availableSellUnits).toBeUndefined();
    expect(observation.cutoffPassed).toBe(true);
    expect(observation.usable).toBe(false);
    expect(observation.errors.map((e) => e.code)).toEqual(
      expect.arrayContaining(["STOCK_UNKNOWN", "CUTOFF_PASSED"])
    );
  });

  it("marks empty schedule and price errors unusable", () => {
    const price = normalizePrice({
      productId: "000000",
      quantity: 1,
      netPriceFound: false,
      error: true
    });
    expect(price.usable).toBe(false);
    expect(price.errors[0]?.code).toBe("PRICE_UNUSABLE");
    const availability = normalizeAvailability(
      { productId: "000000", salesBlock: false, scheduleLines: [] },
      { requestedDate: "2026-11-16", timeNow: "2026-11-13T19:39:00+0200" }
    );
    expect(availability.errors[0]?.code).toBe("EMPTY_SCHEDULE");
  });

  it("converts sales-unit prices to integer cents and preserves netPriceFound", () => {
    const price = normalizePrice({
      productId: "M1",
      quantity: 1,
      catalogPrice: {
        value: 12.8,
        valueWithTax: 14.53,
        validFrom: "2026-11-16T00:00:00+0200",
        validTo: "9999-12-31T00:00:00+0200",
        currency: "EUR"
      },
      netPriceFound: false,
      error: false
    });
    expect(price.salesUnitPriceExVat).toEqual({ currency: "EUR", basis: "VAT_EXCLUSIVE", cents: 1280 });
    expect(price.salesUnitPriceIncVat?.cents).toBe(1453);
    expect(price.netPriceFound).toBe(false);
  });

  it("flags sales-unit mismatch against the catalog", () => {
    const catalog = indexCatalog(
      [
        {
          id: "X",
          salesUnit: "KI",
          baseUnit: "ST",
          allowedLotSize: 1,
          units: [{ unitId: "KI", sizeInBaseUnits: 1 }],
          synkkaData: { names: [{ language: "en", value: "X" }], classifications: [] }
        }
      ],
      { label: "test", observedAt: "2026-11-13T00:00:00.000Z", revision: 1 }
    );
    const observation = normalizeAvailability(
      {
        productId: "X",
        salesBlock: false,
        scheduleLines: [
          { salesBlock: false, availableAmount: 5, availableDate: "2026-11-16", salesUnit: "ST" }
        ]
      },
      { catalog: catalog.products.get("X"), requestedDate: "2026-11-16" }
    );
    expect(observation.errors.map((e) => e.code)).toContain("UNIT_MISMATCH");
  });
});

describe("fixture lookup", () => {
  it("returns typed observations with fixture provenance for the demo SKUs", async () => {
    const adapter = createFixtureAdapter();
    const result = await adapter.lookup({
      customer: "H1",
      requestedDate: "2026-11-16",
      productIds: ["M0", "M1", "M4", "TERM", "MISSING", "ZZZ"]
    });
    expect(result.source.kind).toBe("FIXTURE");
    expect(result.prices).toHaveLength(6);
    expect(result.availability.find((a) => a.productId === "M0")?.availableSellUnits).toBe(20);
    expect(result.availability.find((a) => a.productId === "TERM")?.stockUnknown).toBe(true);
    expect(result.prices.find((p) => p.productId === "MISSING")?.usable).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain("PRODUCT_UNKNOWN");
  });

  it("refuses lookups larger than the documented 1000-id cap", async () => {
    const result = await createFixtureAdapter().lookup({
      customer: "H1",
      requestedDate: "2026-11-16",
      productIds: Array.from({ length: 1001 }, (_, i) => `P${i}`)
    });
    expect(result.errors[0]?.code).toBe("LOOKUP_LIMIT");
  });
});

describe("live adapter contract", () => {
  it("does not embed an API key and reports MISSING_API_KEY", async () => {
    const previous = process.env.VALIO_API_KEY;
    delete process.env.VALIO_API_KEY;
    const adapter = createLiveAdapter({ apiKey: undefined });
    const result = await adapter.lookup({
      customer: "123",
      requestedDate: "2026-11-16",
      productIds: ["M1"],
      now: "2026-11-13T19:39:00+0200"
    });
    expect(result.source.kind).toBe("VALIO_LIVE");
    expect(result.errors[0]?.code).toBe("MISSING_API_KEY");
    const source = readFileSync(fileURLToPath(new URL("./live.ts", import.meta.url)), "utf8");
    expect(source).not.toMatch(/junct_/);
    if (previous !== undefined) process.env.VALIO_API_KEY = previous;
  });

  it("posts only the shortlisted ids with X-API-Key from options", async () => {
    const calls: { url: string; headers: HeadersInit; body: string }[] = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), headers: init?.headers ?? {}, body: String(init?.body) });
      const payload =
        String(url).includes("/price")
          ? {
              customerId: "123",
              currency: "EUR",
              pricingDate: "2026-11-16T00:00:00+0200",
              products: [
                {
                  productId: "M1",
                  quantity: 1,
                  catalogPrice: {
                    value: 12.8,
                    valueWithTax: 14.53,
                    validFrom: "2026-11-16T00:00:00+0200",
                    validTo: "9999-12-31T00:00:00+0200",
                    currency: "EUR"
                  },
                  netPriceFound: false,
                  error: false
                }
              ]
            }
          : {
              timeNow: "2026-11-13T19:39:00+0200",
              requestedDate: "2026-11-16T00:00:00+0200",
              products: [
                {
                  productId: "M1",
                  closingTime: "2026-11-15T17:00:00+0200",
                  salesBlock: false,
                  logisticModel: "Stock",
                  scheduleLines: [
                    { salesBlock: false, availableAmount: 100, availableDate: "2026-11-16", salesUnit: "KI" }
                  ]
                }
              ]
            };
      return new Response(JSON.stringify(payload), { status: 200 });
    };
    const adapter = createLiveAdapter({ apiKey: "from-env-or-options", fetchImpl, catalogPath: join(fixtureDir, "catalog.json") });
    const result = await adapter.lookup({
      customer: "123",
      requestedDate: "2026-11-16",
      productIds: ["M1"]
    });
    expect(calls).toHaveLength(2);
    expect(calls.every((c) => (c.headers as Record<string, string>)["X-API-Key"] === "from-env-or-options")).toBe(
      true
    );
    expect(JSON.parse(calls[0]!.body).products).toEqual(["M1"]);
    expect(result.prices[0]?.usable).toBe(true);
    expect(result.availability[0]?.usable).toBe(true);
    expect(result.source.kind).toBe("VALIO_LIVE");
  });
});

describe("factory", () => {
  it("defaults to the fixture adapter", () => {
    expect(createCatalogAdapter("fixture").kind).toBe("FIXTURE");
  });
});

describe("query shortlist without ids", () => {
  it("matches display names across the fixture catalog", async () => {
    const items = await createFixtureAdapter().shortlist({ query: "20 L", requiredClaims: ["FREE_FROM_LACTOSE"] });
    expect(items.map((i) => i.product.id)).toEqual(["M4"]);
  });

  it("ranks exact names above a typo or prefix and accepts order amounts, Finnish accents and GTINs", () => {
    const base = { salesUnit: "KG", baseUnit: "KG", allowedLotSize: 4.4, units: [{ unitId: "KG", sizeInBaseUnits: 1, gtin: "2377237400000" }] };
    const index = indexCatalog([
      { ...base, id: "SLICE", units: [], synkkaData: { names: [{ language: "en", value: "Chicken breastfillet strips" }] } },
      { ...base, id: "WHOLE", synkkaData: {
        names: [{ language: "en", value: "Chicken breast" }, { language: "fi", value: "Määtilan kanan rintafileet" }],
        unitConversions: [{ synkkaPackagingType: "BASE_UNIT_OR_EACH", netWeight: { unit: "KGM", value: 4.4 } }],
      } },
    ], { label: "test", observedAt: "2026-11-14T10:00:00Z", revision: 1 });
    for (const query of ["10kg chicken breast", "I need 10 kg of chicken breast", "chikcen breast", "maatilan rintafilee", "2377237400000"]) {
      expect(shortlistCatalog(index, { query, limit: 1 })[0]?.product.id, query).toBe("WHOLE");
    }
    expect(index.products.get("WHOLE")).toMatchObject({ amountPerSellUnit: 1000, amountDimension: "g", allowedLotSize: 4.4 });
    expect(shortlistCatalog(index, { query: "lactose-free chicken breast" })).toEqual([]);
  });

  it("matches grocery wording and enforces lactose-free variants using structured evidence", () => {
    const lactose = (id: string, unit: string) => ({ id, unit, synkkaId: "LACTOSE" });
    const free = lactose("FREE_FROM_LACTOSE", "FREE_FROM");
    const product = (id: string, en: string, fi: string, values: ReturnType<typeof lactose>[] = [], group = "nutritionalClaim") => ({
      id, salesUnit: "ST", baseUnit: "ST",
      synkkaData: { names: [{ language: "en", value: en }, { language: "fi", value: fi }], classifications: [{ name: group, values }] },
    });
    const index = indexCatalog([
      product("101", "Plain milk 1 L", "Maito 1 l", [free]),
      product("102", "Milk drink 2 L", "Maitojuoma 2 l", [free]),
      product("103", "Lactose free milk 1 L", "Maito 1 l"),
      product("104", "Milk 1 L", "Maito 1 l", [lactose("LOW_LACTOSE", "LOW")]),
      product("105", "Milk 1 L", "Maito 1 l", [free, lactose("FREE_FROM_LACTOSE", "CONTAINS")]),
      product("106", "Milk 1 L", "Maito 1 l", [free], "packagingMarkedLabel"),
      product("107", "Oatly Oat Drink 1 L", "Oatly Kaurajuoma 1 l", [free]),
      product("108", "Milk chocolate with oat puffs", "Kaurainen maitosuklaa", [free]),
    ], { label: "test", observedAt: "2026-11-14T10:00:00Z", revision: 1 });
    const ids = (query: string) => shortlistCatalog(index, { query }).map(({ product }) => product.id);
    for (const query of ["lactos-free milk", "laktoositonta maitoa", "I need to buy 5 L of milk; lactosefree by Monday"]) {
      expect(ids(query), query).toEqual(["101", "102"]);
    }
    expect(ids("101 lactose‑free")).toEqual(["101"]);
    expect(ids("5 packs of oat milk by Monday")).toEqual(["107"]);
    expect(ids("Please order 4 bottles of oat milk")).toEqual(["107"]);
    expect(ids("milk chocolate")).toEqual(["108"]);
    expect(ids("lactosefree")).toEqual(["101", "102", "107", "108"]);
    expect(claimGate(index.products.get("105")!, ["FREE_FROM_LACTOSE"])).toBe("CLAIM_NOT_MET");
    expect(claimGate(index.products.get("106")!, ["FREE_FROM_LACTOSE"])).toBe("CLAIM_UNKNOWN");
  });
});

const organizerCatalog = new URL("../../aimo_resources/challenge_portal/valio_aimo_junction26_product_data.json", import.meta.url);

describe.skipIf(!existsSync(organizerCatalog))("Valio product forms", () => {
  let catalog: CatalogIndex;

  beforeAll(async () => {
    catalog = await loadCatalogFile(fileURLToPath(organizerCatalog));
  });

  it("finds dry rice for broad English and Finnish queries and excludes prepared food and grain mixes", () => {
    const rice = shortlistCatalog(catalog, { query: "rice", limit: 100 }).map(({ product }) => product);
    const ids = rice.map(({ id }) => id);
    expect(ids.slice(0, 12)).toContain("469518");
    expect(rice.every(({ category }) => category === "21340")).toBe(true);
    for (const unsuitable of ["460946", "461319", "462272", "464504", "473543", "473645", "473870", "475600"]) {
      expect(ids).not.toContain(unsuitable);
    }
    for (const query of ["plain rice", "I need 2 kg of plain rice by Monday", "riisi", "kuivaa riisiä"]) {
      expect(shortlistCatalog(catalog, { query, limit: 100 }).map(({ product }) => product.id), query).toEqual(ids);
    }
    const basmati = shortlistCatalog(catalog, { query: "basmati rice", limit: 100 }).map(({ product }) => product.id);
    expect(basmati).toContain("469354");
    expect(basmati).not.toContain("473543");
  });

  it("returns the same plain dairy milk offers in English and Finnish", () => {
    const milk = shortlistCatalog(catalog, { query: "lactose-free milk", limit: 100 }).map(({ product }) => product);
    const ids = milk.map(({ id }) => id);
    expect(ids).toContain("464398");
    expect(milk.every(({ category }) => category === "10400")).toBe(true);
    for (const unsuitable of ["462626", "462703", "464237", "466172", "469266", "469331", "473142", "473625"]) {
      expect(ids).not.toContain(unsuitable);
    }
    expect(shortlistCatalog(catalog, { query: "laktoositonta maitoa", limit: 100 }).map(({ product }) => product.id)).toEqual(ids);
  });

  it("matches whole fresh apples without suggesting cut apples, juice or sweets", () => {
    for (const query of ["apples", "fresh apples", "whole apples", "I need 10 kg of fresh apples", "tuoreita omenia"]) {
      const ids = shortlistCatalog(catalog, { query }).map(({ product }) => product.id);
      expect(ids, query).toEqual(expect.arrayContaining(["460853", "460921", "460926"]));
      for (const processed of ["461086", "470229", "470246", "470326", "470757"]) {
        expect(ids, query).not.toContain(processed);
      }
    }
    expect(shortlistCatalog(catalog, { query: "fresh apple juice" }).map(({ product }) => product.id)).toContain("470757");
  });

  it("preserves exact SKU and GTIN lookup for buyers who explicitly select another form", () => {
    const ricePaperId = "464504";
    const gtin = catalog.products.get(ricePaperId)?.salesUnitGtin;
    expect(gtin).toBeTruthy();
    expect(shortlistCatalog(catalog, { query: gtin })[0]?.product.id).toBe(ricePaperId);
    expect(shortlistCatalog(catalog, { productIds: ["473142"] })[0]?.product.id).toBe("473142");
    expect(shortlistCatalog(catalog, { query: "461319" })[0]?.product.id).toBe("461319");
  });
});

describe("catalog paging", () => {
  it("returns stable non-overlapping pages after applying account requirements", async () => {
    const adapter = createFixtureAdapter();
    const catalog = await adapter.loadCatalog();
    for (const query of ["", "milk"]) {
      const options = { query, requiredClaims: ["FREE_FROM_LACTOSE"] };
      const all = shortlistCatalog(catalog, { ...options, limit: 100 });
      const first = shortlistCatalog(catalog, { ...options, limit: 1, offset: 0 });
      const second = shortlistCatalog(catalog, { ...options, limit: 1, offset: 1 });
      expect(first.map(p => p.product.id)).toEqual(all.slice(0,1).map(p => p.product.id));
      expect(second.map(p => p.product.id)).toEqual(all.slice(1,2).map(p => p.product.id));
      expect(shortlistCatalog(catalog, { ...options, offset: all.length, limit: 1 })).toEqual([]);
    }
  });
});
