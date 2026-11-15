import { indexCatalog, loadCatalogFile, shortlistCatalog } from "./catalog.js";
import { joinSignals, loadSignalTables, type SignalTables } from "./signals.js";
import { normalizeAvailability, normalizePrice, type RawAvailability, type RawPrice } from "./normalize.js";
import { nowUtcIso, supplierCalendarDate, supplierInstant } from "./time.js";
import {
  DEFAULT_API_BASE_URL,
  MAX_LOOKUP_PRODUCTS,
  type CatalogAdapter,
  type CatalogIndex,
  type LiveAdapterOptions,
  type LookupRequest,
  type LookupResult,
  type ShortlistQuery,
  type SourceProvenance
} from "./types.js";

function liveSource(observedAt: string): SourceProvenance {
  return {
    kind: "VALIO_LIVE",
    label: "Valio Aimo mock price/availability API",
    observedAt,
    revision: 1
  };
}

function resolveKey(options: LiveAdapterOptions): string | undefined {
  return options.apiKey ?? process.env.VALIO_API_KEY;
}

type Endpoint = "price" | "availability";
type LookupIssue = LookupResult["errors"][number];
type EndpointResult = { data: Record<string, unknown> } | { error: LookupIssue };

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPrice(value: unknown): value is RawPrice {
  return object(value) && typeof value.productId === "string" && typeof value.quantity === "number"
    && typeof value.netPriceFound === "boolean" && typeof value.error === "boolean";
}

function isAvailability(value: unknown): value is RawAvailability {
  const optionalText = (field: unknown) => field == null || typeof field === "string";
  return object(value) && typeof value.productId === "string" && typeof value.salesBlock === "boolean"
    && optionalText(value.closingTime) && optionalText(value.logisticModel)
    && Array.isArray(value.scheduleLines) && value.scheduleLines.every((line: unknown) => object(line)
      && typeof line.salesBlock === "boolean" && typeof line.availableAmount === "number"
      && typeof line.salesUnit === "string" && line.salesUnit.trim() !== "" && optionalText(line.availableDate));
}

function readRows<T extends { productId: string }>(value: unknown, requestedIds: Set<string>, isRow: (row: unknown) => row is T) {
  if (!Array.isArray(value) || value.length > requestedIds.size) return undefined;
  const rows = new Map<string, unknown>();
  for (const item of value) {
    if (!object(item) || typeof item.productId !== "string" || !requestedIds.has(item.productId) || rows.has(item.productId)) return undefined;
    rows.set(item.productId, item);
  }
  // An omitted or malformed product does not invalidate evidence tied to another ID.
  return [...requestedIds].map((id) => rows.get(id)).filter(isRow);
}

function retryAfterMs(header: string | null): number | undefined {
  if (!header) return;
  const delay = /^\d+$/.test(header) ? Number(header) * 1_000 : Date.parse(header) - Date.now();
  if (Number.isSafeInteger(delay)) return Math.max(0, delay);
}

async function readEndpoint(endpoint: Endpoint, fetchImpl: typeof fetch, baseUrl: string, key: string, body: string, signal?: AbortSignal):
  Promise<EndpointResult> {
  let response: Response;
  try {
    const timeout = AbortSignal.timeout(12_000);
    response = await fetchImpl(`${baseUrl}/api/${endpoint}`, {
      method: "POST",
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      redirect: "error",
      headers: { "Content-Type": "application/json", "X-API-Key": key },
      body
    });
  } catch {
    return { error: { endpoint, code: "HTTP_ERROR", detail: `${endpoint} request failed or timed out` } };
  }
  if (!response.ok) {
    const retryAfter = retryAfterMs(response.headers.get("retry-after"));
    return { error: {
      endpoint,
      code: response.status === 401 || response.status === 403 ? "AUTH_ERROR" : "HTTP_ERROR",
      detail: `${endpoint} HTTP ${response.status}`,
      httpStatus: response.status,
      ...(retryAfter !== undefined && { retryAfterMs: retryAfter }),
    } };
  }
  try {
    const data: unknown = await response.json();
    if (object(data)) return { data };
  } catch { /* A response without JSON has no usable evidence. */ }
  return { error: { endpoint, code: "INVALID_RESPONSE", detail: `${endpoint} response is not a JSON object` } };
}

export class LiveValioAdapter implements CatalogAdapter {
  readonly kind = "VALIO_LIVE" as const;
  private readonly options: LiveAdapterOptions;
  private readonly rateLimitedUntil: Partial<Record<Endpoint, number>> = {};
  private catalog?: Promise<CatalogIndex>;
  private tables?: Promise<SignalTables>;

  constructor(options: LiveAdapterOptions = {}) {
    this.options = options;
  }

  loadCatalog(): Promise<CatalogIndex> {
    this.catalog ??= this.options.catalogPath
      ? loadCatalogFile(this.options.catalogPath, "Valio local product catalog").catch((error: unknown) => {
        this.catalog = undefined;
        throw error;
      })
      : Promise.resolve(indexCatalog([], {
        kind: "LOCAL_CATALOG",
        label: "empty catalog; set catalogPath",
        observedAt: nowUtcIso(),
        revision: 1
      }));
    return this.catalog;
  }

  private async signalsTable(): Promise<SignalTables> {
    this.tables ??= loadSignalTables({
      reliabilityPath: this.options.reliabilityPath,
      carbonPath: this.options.carbonPath,
      kind: "LOCAL_CATALOG"
    }).catch((error: unknown) => {
      this.tables = undefined;
      throw error;
    });
    return this.tables;
  }

  async shortlist(query: ShortlistQuery) {
    return shortlistCatalog(await this.loadCatalog(), query);
  }

  async signals(productIds: string[]) {
    return joinSignals(await this.signalsTable(), productIds);
  }

  private async read(endpoint: Endpoint, baseUrl: string, key: string, body: string, signal?: AbortSignal): Promise<EndpointResult> {
    const remaining = (this.rateLimitedUntil[endpoint] ?? 0) - Date.now();
    if (remaining > 0) return { error: {
      endpoint, code: "HTTP_ERROR", detail: `${endpoint} lookup deferred during supplier rate limit`,
      httpStatus: 429, retryAfterMs: remaining,
    } };
    const result = await readEndpoint(endpoint, this.options.fetchImpl ?? fetch, baseUrl, key, body, signal);
    if ("error" in result && result.error.httpStatus === 429 && result.error.retryAfterMs) {
      this.rateLimitedUntil[endpoint] = Math.max(this.rateLimitedUntil[endpoint] ?? 0, Date.now() + result.error.retryAfterMs);
    }
    return result;
  }

  async lookup(request: LookupRequest): Promise<LookupResult> {
    const source = liveSource(nowUtcIso());
    const key = resolveKey(this.options);
    if (!key) {
      return {
        source,
        customer: request.customer,
        requestedDate: request.requestedDate,
        prices: [],
        availability: [],
        errors: [
          {
            code: "MISSING_API_KEY",
            detail: "Set VALIO_API_KEY or pass apiKey. The key is never hardcoded."
          }
        ]
      };
    }
    if (request.productIds.length === 0) {
      return {
        source,
        customer: request.customer,
        requestedDate: request.requestedDate,
        prices: [],
        availability: [],
        errors: [{ code: "EMPTY_SHORTLIST", detail: "send only locally shortlisted ids" }]
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

    const baseUrl = (this.options.baseUrl ?? process.env.VALIO_API_BASE_URL ?? DEFAULT_API_BASE_URL).replace(
      /\/$/,
      ""
    );
    const ids = new Set(request.productIds);
    if (ids.size !== request.productIds.length) {
      return {
        source, customer: request.customer, requestedDate: request.requestedDate, prices: [], availability: [],
        errors: [{ code: "LOOKUP_LIMIT", detail: "product IDs must be unique" }]
      };
    }
    const catalog = await this.loadCatalog();
    const body = JSON.stringify({
      customer: request.customer,
      requestedDate: request.requestedDate,
      products: request.productIds
    });
    const [priceResponse, availabilityResponse] = await Promise.all([
      this.read("price", baseUrl, key, body, request.signal),
      request.priceOnly ? undefined : this.read("availability", baseUrl, key, body, request.signal)
    ]);
    const result: LookupResult = {
      source, customer: request.customer, requestedDate: request.requestedDate,
      prices: [], availability: [], errors: []
    };
    const invalid = (endpoint: Endpoint) => result.errors.push({
      endpoint, code: "INVALID_RESPONSE", detail: `${endpoint} response does not match the request or published contract`
    });
    const invalidRows = (endpoint: Endpoint, count: number) => {
      if (count < ids.size) result.errors.push({
        endpoint, code: "INVALID_RESPONSE", detail: `${ids.size - count} requested ${endpoint} records were missing or malformed`
      });
    };

    if ("error" in priceResponse) {
      result.errors.push(priceResponse.error);
    } else {
      const { customerId, currency, pricingDate, products } = priceResponse.data;
      const rows = readRows(products, ids, isPrice);
      if (customerId !== request.customer || currency !== "EUR" || typeof pricingDate !== "string"
        || supplierCalendarDate(pricingDate) !== request.requestedDate || !rows) invalid("price");
      else {
        invalidRows("price", rows.length);
        result.prices = rows.map((row) => normalizePrice(row, pricingDate));
      }
    }
    if (!availabilityResponse) return result;
    if ("error" in availabilityResponse) {
      result.errors.push(availabilityResponse.error);
    } else {
      const { timeNow, requestedDate, products } = availabilityResponse.data;
      const rows = readRows(products, ids, isAvailability);
      if (typeof requestedDate !== "string" || supplierCalendarDate(requestedDate) !== request.requestedDate
        || typeof timeNow !== "string" || !supplierInstant(timeNow) || !rows) invalid("availability");
      else {
        invalidRows("availability", rows.length);
        // Never let an earlier app snapshot reopen a supplier cutoff, and
        // reject elapsed cutoffs even when the mock reports an older clock.
        const appTime = supplierInstant(request.now ?? source.observedAt);
        const observedTime = supplierInstant(timeNow)!;
        const cutoffTime = appTime && appTime > observedTime ? appTime.toISOString() : timeNow;
        result.availability = rows.map((row) => normalizeAvailability(row, {
          catalog: catalog.products.get(row.productId),
          timeNow,
          cutoffTime,
          requestedDate: request.requestedDate,
          latestDeliveryAt: request.latestDeliveryAt
        }));
      }
    }
    return result;
  }
}

export function createLiveAdapter(options: LiveAdapterOptions = {}): LiveValioAdapter {
  return new LiveValioAdapter(options);
}
