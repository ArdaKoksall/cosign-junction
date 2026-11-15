import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { indexCatalog, shortlistCatalog } from "./catalog.js";
import { joinSignals, loadSignalTables, type SignalTables } from "./signals.js";
import { normalizeAvailability, normalizePrice } from "./normalize.js";
import { nowUtcIso } from "./time.js";
import {
  MAX_LOOKUP_PRODUCTS,
  UNKNOWN_STOCK_SENTINEL,
  type CatalogAdapter,
  type CatalogIndex,
  type LookupRequest,
  type LookupResult,
  type ShortlistQuery,
  type SourceProvenance
} from "./types.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "..", "fixtures");

const fixtureSource = (observedAt: string): SourceProvenance => ({
  kind: "FIXTURE",
  label: "synthetic lookup fixture",
  observedAt,
  revision: 1,
  evidenceRef: "adapters/src/fixtures"
});

interface FixtureLookupRow {
  productId: string;
  price: {
    quantity: number;
    catalogPrice: { value: number; valueWithTax: number; validFrom: string; validTo: string; currency: string } | null;
    priceWithTax: { value: number; validFrom: string; validTo: string; currency: string } | null;
    comparisonPrice: { value: number; currency: string } | null;
    comparisonUnit: string | null;
    tax: { taxRate: number; taxValue: number } | null;
    netPriceFound: boolean;
    error: boolean;
  };
  availability: {
    closingTime: string | null;
    salesBlock: boolean;
    logisticModel: string | null;
    scheduleLines: {
      salesBlock: boolean;
      availableAmount: number;
      availableDate: string | null;
      salesUnit: string;
    }[];
  };
}

const LOOKUP: Record<string, FixtureLookupRow> = {
  M0: {
    productId: "M0",
    price: {
      quantity: 1,
      catalogPrice: {
        value: 12,
        valueWithTax: 13.62,
        validFrom: "2026-11-16T00:00:00+0200",
        validTo: "9999-12-31T00:00:00+0200",
        currency: "EUR"
      },
      priceWithTax: {
        value: 13.62,
        validFrom: "2026-11-16T00:00:00+0200",
        validTo: "9999-12-31T00:00:00+0200",
        currency: "EUR"
      },
      comparisonPrice: { value: 1.2, currency: "EUR" },
      comparisonUnit: "L",
      tax: { taxRate: 13.5, taxValue: 1.62 },
      netPriceFound: false,
      error: false
    },
    availability: {
      closingTime: "2026-11-15T17:00:00+0200",
      salesBlock: false,
      logisticModel: "Stock",
      scheduleLines: [
        { salesBlock: false, availableAmount: 20, availableDate: "2026-11-16", salesUnit: "KI" }
      ]
    }
  },
  M1: {
    productId: "M1",
    price: {
      quantity: 1,
      catalogPrice: {
        value: 12.8,
        valueWithTax: 14.53,
        validFrom: "2026-11-16T00:00:00+0200",
        validTo: "9999-12-31T00:00:00+0200",
        currency: "EUR"
      },
      priceWithTax: {
        value: 14.53,
        validFrom: "2026-11-16T00:00:00+0200",
        validTo: "9999-12-31T00:00:00+0200",
        currency: "EUR"
      },
      comparisonPrice: { value: 1.28, currency: "EUR" },
      comparisonUnit: "L",
      tax: { taxRate: 13.5, taxValue: 1.73 },
      netPriceFound: false,
      error: false
    },
    availability: {
      closingTime: "2026-11-15T17:00:00+0200",
      salesBlock: false,
      logisticModel: "Stock",
      scheduleLines: [
        { salesBlock: false, availableAmount: 100, availableDate: "2026-11-16", salesUnit: "KI" }
      ]
    }
  },
  M2: {
    productId: "M2",
    price: {
      quantity: 1,
      catalogPrice: {
        value: 10,
        valueWithTax: 11.35,
        validFrom: "2026-11-16T00:00:00+0200",
        validTo: "9999-12-31T00:00:00+0200",
        currency: "EUR"
      },
      priceWithTax: {
        value: 11.35,
        validFrom: "2026-11-16T00:00:00+0200",
        validTo: "9999-12-31T00:00:00+0200",
        currency: "EUR"
      },
      comparisonPrice: { value: 1, currency: "EUR" },
      comparisonUnit: "L",
      tax: { taxRate: 13.5, taxValue: 1.35 },
      netPriceFound: false,
      error: false
    },
    availability: {
      closingTime: "2026-11-15T17:00:00+0200",
      salesBlock: false,
      logisticModel: "Stock",
      scheduleLines: [
        { salesBlock: false, availableAmount: 200, availableDate: "2026-11-16", salesUnit: "KI" }
      ]
    }
  },
  M3: {
    productId: "M3",
    price: {
      quantity: 1,
      catalogPrice: {
        value: 11,
        valueWithTax: 12.49,
        validFrom: "2026-11-16T00:00:00+0200",
        validTo: "9999-12-31T00:00:00+0200",
        currency: "EUR"
      },
      priceWithTax: {
        value: 12.49,
        validFrom: "2026-11-16T00:00:00+0200",
        validTo: "9999-12-31T00:00:00+0200",
        currency: "EUR"
      },
      comparisonPrice: { value: 1.1, currency: "EUR" },
      comparisonUnit: "L",
      tax: { taxRate: 13.5, taxValue: 1.49 },
      netPriceFound: false,
      error: false
    },
    availability: {
      closingTime: "2026-11-15T17:00:00+0200",
      salesBlock: false,
      logisticModel: "Stock",
      scheduleLines: [
        { salesBlock: false, availableAmount: 80, availableDate: "2026-11-16", salesUnit: "KI" }
      ]
    }
  },
  M4: {
    productId: "M4",
    price: {
      quantity: 1,
      catalogPrice: {
        value: 28,
        valueWithTax: 31.78,
        validFrom: "2026-11-16T00:00:00+0200",
        validTo: "9999-12-31T00:00:00+0200",
        currency: "EUR"
      },
      priceWithTax: {
        value: 31.78,
        validFrom: "2026-11-16T00:00:00+0200",
        validTo: "9999-12-31T00:00:00+0200",
        currency: "EUR"
      },
      comparisonPrice: { value: 1.4, currency: "EUR" },
      comparisonUnit: "L",
      tax: { taxRate: 13.5, taxValue: 3.78 },
      netPriceFound: false,
      error: false
    },
    availability: {
      closingTime: "2026-11-15T17:00:00+0200",
      salesBlock: false,
      logisticModel: "Stock",
      scheduleLines: [
        { salesBlock: false, availableAmount: 50, availableDate: "2026-11-16", salesUnit: "KI" }
      ]
    }
  },
  TERM: {
    productId: "TERM",
    price: {
      quantity: 1,
      catalogPrice: {
        value: 1.95,
        valueWithTax: 2.21,
        validFrom: "2026-11-16T00:00:00+0200",
        validTo: "9999-12-31T00:00:00+0200",
        currency: "EUR"
      },
      priceWithTax: {
        value: 2.21,
        validFrom: "2026-11-16T00:00:00+0200",
        validTo: "9999-12-31T00:00:00+0200",
        currency: "EUR"
      },
      comparisonPrice: { value: 1.95, currency: "EUR" },
      comparisonUnit: "L",
      tax: { taxRate: 13.5, taxValue: 0.26 },
      netPriceFound: true,
      error: false
    },
    availability: {
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
    }
  },
  MISSING: {
    productId: "MISSING",
    price: {
      quantity: 1,
      catalogPrice: null,
      priceWithTax: null,
      comparisonPrice: null,
      comparisonUnit: null,
      tax: null,
      netPriceFound: false,
      error: true
    },
    availability: {
      closingTime: null,
      salesBlock: false,
      logisticModel: null,
      scheduleLines: []
    }
  }
};

export class FixtureAdapter implements CatalogAdapter {
  readonly kind = "FIXTURE" as const;
  private catalog?: CatalogIndex;
  private signalTables?: SignalTables;
  private readonly timeNow: string;

  constructor(timeNow = "2026-11-13T19:39:00+0200") {
    this.timeNow = timeNow;
  }

  async loadCatalog(): Promise<CatalogIndex> {
    if (this.catalog) return this.catalog;
    const raw = JSON.parse(await readFile(join(fixtureDir, "catalog.json"), "utf8")) as unknown[];
    this.catalog = indexCatalog(raw, fixtureSource(nowUtcIso()));
    return this.catalog;
  }

  private async loadSignals(): Promise<SignalTables> {
    if (this.signalTables) return this.signalTables;
    this.signalTables = await loadSignalTables({
      reliabilityPath: join(fixtureDir, "reliability.csv"),
      carbonPath: join(fixtureDir, "carbon.csv"),
      kind: "FIXTURE"
    });
    return this.signalTables;
  }

  async shortlist(query: ShortlistQuery) {
    const catalog = await this.loadCatalog();
    return shortlistCatalog(catalog, query);
  }

  async signals(productIds: string[]) {
    return joinSignals(await this.loadSignals(), productIds);
  }

  async lookup(request: LookupRequest): Promise<LookupResult> {
    const catalog = await this.loadCatalog();
    request.signal?.throwIfAborted();
    const source = fixtureSource(nowUtcIso());
    const errors: LookupResult["errors"] = [];
    if (request.productIds.length === 0) {
      return {
        source,
        customer: request.customer,
        requestedDate: request.requestedDate,
        prices: [],
        availability: [],
        errors: [{ code: "EMPTY_SHORTLIST", detail: "lookup requires a local shortlist" }]
      };
    }
    if (request.productIds.length > MAX_LOOKUP_PRODUCTS) {
      return {
        source,
        customer: request.customer,
        requestedDate: request.requestedDate,
        prices: [],
        availability: [],
        errors: [{ code: "LOOKUP_LIMIT", detail: `at most ${MAX_LOOKUP_PRODUCTS} product ids` }]
      };
    }

    const prices = [];
    const availability = [];
    for (const id of request.productIds) {
      const row = LOOKUP[id];
      if (!row) {
        errors.push({ code: "PRODUCT_UNKNOWN", detail: id });
        prices.push(
          normalizePrice({
            productId: id,
            quantity: 1,
            netPriceFound: false,
            error: true
          })
        );
        if (!request.priceOnly) availability.push(
          normalizeAvailability(
            { productId: id, salesBlock: false, scheduleLines: [] },
            {
              catalog: catalog.products.get(id),
              timeNow: request.now ?? this.timeNow,
              requestedDate: request.requestedDate,
              latestDeliveryAt: request.latestDeliveryAt
            }
          )
        );
        continue;
      }
      prices.push(normalizePrice({ productId: id, ...row.price }));
      if (!request.priceOnly) availability.push(
        normalizeAvailability(
          { productId: id, ...row.availability },
          {
            catalog: catalog.products.get(id),
            timeNow: request.now ?? this.timeNow,
            requestedDate: request.requestedDate,
            latestDeliveryAt: request.latestDeliveryAt
          }
        )
      );
    }
    return {
      source,
      customer: request.customer,
      requestedDate: request.requestedDate,
      prices,
      availability,
      errors
    };
  }
}

export function createFixtureAdapter(timeNow?: string): FixtureAdapter {
  return new FixtureAdapter(timeNow);
}
