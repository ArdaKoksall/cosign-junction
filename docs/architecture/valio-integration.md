# Valio Aimo challenge integration

Cosign uses product and pack evidence from the Valio Aimo challenge catalog and requests dated price and availability for shortlisted products. The challenge APIs supply synthetic observations. The Junction demo uses a tracked synthetic catalog and a local supplier stub. [Junction demo](../../README.md#run-the-junction-demo)

## Access and operations

For live challenge access, obtain the datasets and participant API key from the organizer. Place the datasets in the ignored local directory as described in the setup guide and set `VALIO_API_KEY` in the repository root `.env`. The server keeps the key and makes the supplier requests. [Valio challenge portal](https://junction26.valioaimo.fi/) · [Valio data setup](../../aimo_resources/README.md)

Build a shortlist from the local catalog and refresh only the products and dates under review. The legacy buyer workspace compares up to 12 shortlisted products per day, and its diagnostic lookup accepts up to three dates.

## Interpret the response

| Supplier evidence | How Cosign uses it |
|---|---|
| Envelope identity | Check the customer and currency on the price feed, the echoed date on both feeds, and the supplier clock on availability. Validate all returned product IDs against the request. If the IDs align, retain valid siblings when a single item is malformed. The independent price and availability feeds can succeed separately. |
| `quantity`, `catalogPrice`, `error` | The contract describes prices for one sales unit. Use usable EUR `catalogPrice.value` as the ex-VAT sales-unit amount. A row error or unusable base price prevents a cost estimate for that product. |
| `catalogPrice.valueWithTax`, `priceWithTax`, `tax` | Keep the inclusive amount and reported tax when the fields agree and their date and currency check out. The two gross fields can coexist. The tax rate is a percent and `taxValue` is an amount. |
| `comparisonPrice`, `comparisonUnit`, `listPrice`, `netPriceFound` | The per-kg or per-litre comparison price is a separate value. List price precedes discounts, and the net-price flag reports the mock's selection. Validate each optional price's own currency and validity interval. A net-price flag does not establish the buyer's entitlement. |
| `requestedDate`, `availableDate`, `timeNow` | Treat delivery dates as Helsinki calendar days. The envelope echo and the returned schedule day are two independent checks. Report a different schedule day separately. The API provides dates and the observation clock, with no hour-level delivery commitment. |
| Product and schedule `salesBlock`, `closingTime` | Either block prevents ordering. An invalid, absent or elapsed cutoff prevents a positive order-window assessment. Compare timestamps as instants against the later of the app and supplier clocks. The app treats the cutoff instant itself as elapsed. |
| `logisticModel`, `scheduleLines`, `availableAmount`, `salesUnit` | An empty schedule means no date is currently supplied. A defensible finite stock amount requires the `Stock` model and a catalog sales-unit match. `Terminal` has unknown quantity. The app also treats `999999` and larger mock values or an unrecognized logistics model as unknown. Zero is distinct from missing stock. |

The mock can echo a requested date while returning a different day on schedule lines. A missing ID can return a row error and no schedule. Gross, list and comparison prices can have independent validity windows. [Adapter](../../adapters/src/live.ts) · [Normalization](../../adapters/src/normalize.ts)

## Static data and buyer workflow

The product catalog supplies search, pack and ingredient evidence. Reliability is a historical delivery signal joined by product ID. Carbon intensity is a product-group estimate and needs a known mass to support an order estimate.

- **Search and eligibility.** Recognized text and selected `requirements` combine. Available choices are lactose-free, gluten-free, vegan, vegetarian, no added sugar and high protein. Code `ML` is lactose and `AM` is milk. A lactose allergen contradiction invalidates a lactose-free claim. Repeated `freeFromAllergen` values require explicit absence for every code. Missing, contradictory and may-contain evidence cannot meet an absence filter. Check the current package for allergy decisions. Catalog selections carry both kinds of requirements into the saved request, where the comparison applies them to broad searches and exact SKUs. Pack-measurement filters are used to browse the catalog.
- **IDs and packs.** Use the challenge `id` with Valio's API. A GTIN search can find a product, and its packaging level needs review before choosing quantity. Use `salesUnit`, `baseUnit`, matching `units`, `unitConversions` and `allowedLotSize` together. When both net mass and volume are declared for the same sales pack, both appear in catalog search and either can support a comparison in its own unit. Unknown conversions stay unknown.
- **Product evidence.** Product details show manufacturer claims, allergens, ingredient statements and structured ingredient rows, ingredient origin and percentages where declared, nutrition with its stated basis and precision, pack evidence, origin, storage and usage, deposits, labels, optional signals and declared alternatives. Keep grams, millilitres and servings distinct. A substitution link is a candidate for review, including where category or order unit differs.
- **Coverage and budget.** Same-day finite stock in a compatible fixed sale unit can support partial coverage and a remaining quantity. An estimate can round up to a supported pack or order step. Product subtotals exclude unverified packaging deposits. Variable weight and deposits can keep budget fit unconfirmed even when a product subtotal is available.

The account workspace and MCP clients use the same catalog and comparison tools through the account service. The legacy connected workspace exposes catalog search at `GET /api/valio/catalog`, SKU evidence at `GET /api/valio/catalog/{productId}`, dated observations at `POST /api/valio/lookup` and `POST /api/valio/lookup/dates`, and persisted request comparisons at `POST /api/requests/{id}/compare`. Its OpenAPI is `GET /api/openapi.json`. [Account service](../../server/src/trade/service.ts) · [GS1 allergen codes](https://ref.gs1.org/voc/AllergenTypeCode) · [Legacy API contract](../../server/src/routes/openapi.ts)

## Checkout boundary

The published challenge contract covers lookup and file downloads. With connected rehearsal enabled, the buyer can select an eligible SKU from a saved comparison and freeze its full-quantity estimate in a local simulated quote on the same request. The quote records the source comparison revision, the buyer's requested delivery deadline and supplier caveats. Eligibility requires a usable price, correct date and pack quantity, an open cutoff, and no known blocker or budget overrun. The buyer approves the quote revision and commits it to receive an idempotent simulated receipt with the same requested deadline. The saved supplier comparison remains available alongside the quote. Valio receives lookup requests only.

The standalone fixture simulator demonstrates repricing and weekly mandates in its own PostgreSQL database. [System design](system-design.md)
