# Cosign adapters

Isolated TypeScript package for **local catalog shortlist**, optional **targeted Valio price/availability lookup**, and **reliability/carbon joins**. It does not own checkout, quotes, or HTTP routes. Workflow code should import this package and keep API keys on the server.

## Install

From the repository root:

```sh
npm --prefix adapters ci
npm --prefix adapters run build
npm --prefix adapters test
```

`npm test` runs Vitest against synthetic catalog fixtures and simulated Valio responses. The full-catalog tests are optional and skip if the authorized local catalog is absent. [Valio data setup](../aimo_resources/README.md)

## Public surface

```ts
import {
  createCatalogAdapter,
  createFixtureAdapter,
  createLiveAdapter,
  shortlistCatalog,
  UNKNOWN_STOCK_SENTINEL
} from "@cosign/adapters";
```

| Call | Behavior |
|---|---|
| `createFixtureAdapter()` | Synthetic M0–M4 (+ `TERM`) catalog, CSV signals, and lookup. Source `FIXTURE`. |
| `createLiveAdapter(options)` | Local catalog/CSV files plus `POST /api/price` and `POST /api/availability`. Source `VALIO_LIVE`. |
| `adapter.shortlist(query)` | Filter by name, SKU, GTIN, category, requirements, explicit allergen absences or supported pack measurement before lookup. Can include catalog-linked substitute leads. Default limit 12. |
| `adapter.signals(ids)` | Join `deliveryReliability` (0–1, product) and `AVG kg CO2-eq/kg` (product-group). Missing values are `{ present: false }`. |
| `adapter.lookup({ customer, requestedDate, productIds })` | Targeted read of 1–1,000 unique shortlisted IDs. Returns typed EUR prices in cents, dates, availability and feed-specific errors. |

`createCatalogAdapter("fixture" | "live")` follows `VALIO_ADAPTER` when the argument is omitted (default `fixture`).

## Environment (live only)

Never hardcode keys. The live adapter reads:

| Variable | Use |
|---|---|
| `VALIO_API_KEY` | Sent as `X-API-Key`. Required for a live lookup. |
| `VALIO_API_BASE_URL` | Defaults to `https://junction26.valioaimo.fi`. |
| `VALIO_ADAPTER` | `fixture` or `live` for the factory. |

You may pass `apiKey`, `baseUrl`, `catalogPath`, `reliabilityPath`, `carbonPath`, and `fetchImpl` instead of env vars.

```ts
const live = createLiveAdapter({
  catalogPath: "/path/to/valio_aimo_junction26_product_data.json",
  reliabilityPath: "/path/to/valio_aimo_junction26_delivery_reliability.csv",
  carbonPath: "/path/to/valio_aimo_junction26_carbon_footprint.csv"
});
```

Choose the synthetic fixture explicitly for offline adapter tests. The connected server uses the live adapter and surfaces failures. A missing key returns `MISSING_API_KEY` before fetching. A partner 401 or 403 returns `AUTH_ERROR`.

## Normalization contract

See the [Valio integration guide](../docs/architecture/valio-integration.md) for how the workspace uses these observations.

- Filter locally, then send only shortlisted product codes (`customer`, `requestedDate`, `products`).
- A usable quote observation requires `catalogPrice.value` in EUR for one sales unit and a validity interval that covers `pricingDate`. `error: true` or inadequate price evidence gives `PRICE_UNUSABLE`. The response preserves `netPriceFound` and separately supported tax, VAT-inclusive, list and comparison prices.
- Each feed is validated separately for the requested date and exact set of product IDs. A malformed product row with an otherwise valid set of IDs reports a feed issue and preserves valid rows.
- Stock counts require a `Stock` logistics model, a finite nonnegative amount and a matching catalog `salesUnit`. `Terminal`, unknown models, the documented `999999` sentinel and higher mock values yield `STOCK_UNKNOWN`. Zero reported stock is `STOCK_SHORT`.
- Empty `scheduleLines` produce `EMPTY_SCHEDULE`. Multiple lines or a line dated differently from the request produce `DELIVERY_CONFLICT`. Schedule days are interpreted in `Europe/Helsinki`. Product or line `salesBlock` produces `SALES_BLOCK`.
- The cutoff is compared to the later of the supplier clock and the app observation time. Elapsed cutoffs produce `CUTOFF_PASSED`. Missing or invalid timing evidence produces `CUTOFF_UNVERIFIED` whenever a schedule line is present.
- Volume and net weight can coexist for a sales unit. The primary amount fields retain their existing behavior and `secondaryPackMeasure` gives the additional net mass. The raw `allowedLotSize` is the supplier quantity step. Purchasing applies weight or conservative whole-pack increments as appropriate. [Request quantity calculations](../server/src/purchasing/quantity.ts)
- Lactose-free requires an explicit `FREE_FROM_LACTOSE` declaration. Milk allergen (`AM`) is a separate code. Explicit allergen absence is checked independently of dietary claims and catalog-linked alternatives.

Every result carries `source.kind` (`FIXTURE` | `VALIO_LIVE` | `LOCAL_CATALOG`), a label, `observedAt`, and optional `catalogHash` or file references. Live source data represents an observation at the time of lookup.

## Fixture SKUs (server integration)

Matches the planning demo quantities (1,000 L lactose-free request):

| Id | Pack | Ex-VAT unit | Stock | Eligibility notes |
|---|---|---|---|---|
| M0 | 10 L | €12.00 | 20 | Short of 1,000 L; lactose-free declared |
| M1 | 10 L | €12.80 | 100 | Evidenced substitute |
| M2 | 10 L | €10.00 | 200 | Claim contradicted |
| M3 | 10 L | €11.00 | 80 | Claim missing |
| M4 | 20 L | €28.00 | 50 | Evidenced alternative |
| TERM | 1 L | €1.95 | unknown (`999999`) | Terminal + elapsed cutoff |

M3 has no carbon/reliability row so `signals` reports unknown.

## What this package does not do

- No Fastify routes, no simulator quotes, no commits.
- The partner catalog is supplied locally by authorized participants.
- No API key in source. Do not log `X-API-Key` or lookup payloads in callers.
