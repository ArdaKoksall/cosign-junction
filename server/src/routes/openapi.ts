import { productRequirements } from "@cosign/adapters";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { intakeInputSchema, intakeResponseSchema } from "../intake/fields.js";
import { commitBody, rehearsalBody, requestBody, versionBody } from "./purchasing.js";
import { requestUnits } from "../purchasing/quantity.js";
import { rankingObjectiveSchema } from "../purchasing/ranking-objective.js";
import { lookupBody, lookupDatesBody } from "./valio.js";

function json(schema: Record<string, unknown>) {
  return { content: { "application/json": { schema } } };
}

function body(schema: z.ZodType) {
  const { $schema, ...input } = z.toJSONSchema(schema, { io: "input" });
  return { required: true, ...json(input) };
}

function response(description: string, schema?: Record<string, unknown>) {
  return { description, ...(schema && json(schema)) };
}

const pathId = [{ in: "path", name: "id", required: true, schema: { type: "string" } }];
const optionalSimulatorAuth = [{}, { simulatorBearer: [] }];
const simulatorAuth = [{ simulatorBearer: [] }];
const string = { type: "string" };
const integer = { type: "integer" };
const number = { type: "number" };
const nullableNumber = { type: ["number", "null"] };
const nullableString = { type: ["string", "null"] };
const list = (items: Record<string, unknown>) => ({ type: "array", items });
const object = (properties: Record<string, unknown>) => ({ type: "object", required: Object.keys(properties), properties });
const sourceEvidence = {
  type: "object", required: ["kind", "label", "observedAt", "revision"], properties: {
    kind: { enum: ["FIXTURE", "VALIO_LIVE", "LOCAL_CATALOG"] }, label: string, observedAt: string,
    revision: integer, evidenceRef: string, catalogHash: string,
  },
};
const claimEvidence = {
  type: "object", required: ["id", "group", "status"], properties: {
    id: string, group: string, status: { enum: ["DECLARED_PRESENT", "MAY_CONTAIN", "VERIFIED_ABSENT", "UNKNOWN"] }, synkkaId: string,
    unit: { type: "string", description: "Supplier classification unit for nutritional claims, such as DIET or FREE_FROM." },
  },
};
const localizedText = object({ language: string, value: string });
const productSummaryFields = {
  id: string, name: string, supplier: string, category: string, salesUnit: string, salesUnitGtin: nullableString,
  allowedLotSize: number, verifiedLactoseFree: { type: "boolean" }, allergens: list(claimEvidence),
  requirements: list({ enum: productRequirements }),
  variableWeight: { type: ["boolean", "null"], description: "Whether manufacturer data declares this product is sold by variable weight." },
  allergenConflicts: list(string),
  packDimensions: list(object({ amount: number, unit: { enum: ["ml", "g", "each", "case"] }, source: string })),
};
const catalogNutrient = {
  type: "object", required: ["id", "value", "unit", "basisQuantity", "basisQuantityUnit"], properties: {
    id: string, value: number, unit: string, basisQuantity: number, basisQuantityUnit: string,
    unitPrecision: string, servingSize: number, servingSizeUnit: string, dailyValueIntakePercent: number,
  },
};
const catalogIngredient = {
  type: "object", required: ["sequence", "names", "origins"], properties: {
    sequence: integer, names: list(localizedText), origins: list(object({ country: string, type: string })), percentage: number,
  },
};
const catalogSignal = {
  type: "object", required: ["present", "granularity", "source"], properties: {
    present: { type: "boolean" }, value: number, unit: string,
    granularity: { enum: ["PRODUCT", "PRODUCT_GROUP", "UNKNOWN"] }, source: sourceEvidence,
  },
};
const lookupSource = { enum: ["VALIO_LIVE_MOCK_OBSERVATION", "FIXTURE_OBSERVATION"] };
const lookupIssue = {
  type: "object", required: ["code", "detail"], properties: {
    code: string, detail: string, endpoint: { enum: ["price", "availability"] },
    httpStatus: integer,
    retryAfterMs: { type: "integer", minimum: 0, description: "Supplier-requested wait before retrying the affected endpoint, in milliseconds." },
  },
};
const money = object({ currency: { const: "EUR" }, basis: { enum: ["VAT_EXCLUSIVE", "VAT_INCLUSIVE"] }, cents: integer });
const lookupDay = {
  type: "object", required: ["status", "source", "customer", "requestedDate", "prices", "availability", "errors"], properties: {
    status: { enum: ["observed", "partial", "unavailable"] }, source: sourceEvidence,
    customer: string, requestedDate: { type: "string", format: "date" }, errors: list(lookupIssue),
    prices: list({ type: "object", required: ["productId", "usable", "errors", "quantity", "netPriceFound"], properties: {
      productId: string, usable: { type: "boolean" }, errors: list(lookupIssue), quantity: number,
      netPriceFound: { type: "boolean" }, currency: string, pricingDate: string, validFrom: string, validTo: string,
      salesUnitPriceExVat: money, salesUnitPriceIncVat: money, listPriceExVat: money, comparisonPrice: money,
      comparisonUnit: { enum: ["KG", "L"] }, taxRatePercent: number, taxPerSalesUnitCents: integer,
    } }),
    availability: list({ type: "object", required: ["productId", "usable", "errors", "salesBlock", "cutoffPassed", "stockUnknown"], properties: {
      productId: string, usable: { type: "boolean" }, errors: list(lookupIssue), salesBlock: { type: "boolean" },
      scheduleSalesBlock: { type: "boolean" }, cutoffPassed: { type: "boolean" }, stockUnknown: { type: "boolean" },
      logisticModel: nullableString, closingTime: string, timeNow: string, requestedDate: string, availableDate: string,
      salesUnit: string, availableSellUnits: number,
    } }),
  },
};
const lookupEvidence = {
  source: lookupSource, checkout: { enum: ["SIMULATED_SEPARATELY", "SIMULATED_REHEARSAL"] },
  shortlist: list(object({ product: object({ id: string, displayName: string, salesUnit: string }), reasons: list(string), source: sourceEvidence })),
  signals: list(object({ productId: string, reliability: catalogSignal, carbonKgCo2ePerKg: catalogSignal })),
};
const catalogProductDetail = object({
  product: object({
    ...productSummaryFields,
    names: list(localizedText), baseUnit: string,
    units: list({ type: "object", required: ["unitId", "sizeInBaseUnits"], properties: { unitId: string, gtin: string, sizeInBaseUnits: number } }),
    claims: list(claimEvidence), labels: list(claimEvidence),
    countryOfOrigin: nullableString, temperatureCondition: { type: ["integer", "null"] },
    deposits: list(object({ material: string, quantity: number, unit: string })), brand: nullableString,
    ingredients: list(localizedText), storageInstructions: list(localizedText),
    structuredIngredients: list(catalogIngredient), nutritionalContent: list(catalogNutrient),
    preparationInstructions: list(localizedText), usageInstructions: list(localizedText),
    storageTemperatureCelsius: object({ min: nullableNumber, max: nullableNumber }), manufacturerUpdatedAt: nullableString,
  }),
  alternatives: list(object({
    candidateProductId: string, relationship: { const: "CATALOG_DECLARED" },
    product: { anyOf: [object(productSummaryFields), { type: "null" }] },
  })),
  signals: { anyOf: [object({ productId: string, reliability: catalogSignal, carbonKgCo2ePerKg: catalogSignal }), { type: "null" }] },
  source: sourceEvidence,
});
const unit = { enum: requestUnits };
const requirements = { ...list({ enum: productRequirements }), uniqueItems: true };
const rankingObjective = { enum: rankingObjectiveSchema.options };
const savedRequest = { type: "object", required: ["id", "quantity", "unit", "deadline", "diet", "budgetCents", "createdAt"], properties: {
  id: string, query: string, productId: string, quantity: number, unit, quantityLiters: nullableNumber,
  deadline: { type: "string", format: "date-time" }, createdAt: { type: "string", format: "date-time" },
  budgetCents: integer, diet: { enum: ["none", "lactose-free"] }, preset: { const: "monday_milk" },
  requirements, freeFromAllergen: list({ type: "string", pattern: "^[A-Z][A-Z0-9]{1,2}$" }), rankingObjective,
} };
const trace = { type: "array", items: { type: "object", required: ["at", "action", "outcome", "detail"], properties: {
  at: { type: "string", format: "date-time" }, action: string, outcome: string, detail: string, revision: integer, actorId: string,
} } };
const rehearsal = {
  ...object({
    productId: string, name: string, quantity: number, requestedQuantity: number, unit,
    requestedDeadline: { type: "string", format: "date-time", description: "The buyer's requested delivery deadline." },
    salesUnits: number, salesUnit: string, salesUnitPriceCents: integer,
    supplierComparisonId: string, supplierComparisonVersion: integer,
    observedAt: { type: "string", format: "date-time" }, closingTime: string, caveats: list(string),
  }),
  description: "Frozen source for a simulated quote. Approval never commits to the supplier or reserves stock.",
};
const comparison = { type: "object", required: ["proposalId", "requestId", "version", "status"], properties: {
  proposalId: string, requestId: string, version: integer, status: string,
  totalCents: integer, uncoveredLiters: nullableNumber, uncoveredQuantity: number,
  uncoveredUnit: unit, checkoutSupported: { type: "boolean" },
  comparisonMode: { const: "supplier_observations" }, source: string, observedAt: { type: "string", format: "date-time" },
  rehearsal,
  rehearsalCandidates: { ...list(string), description: "Product IDs eligible for quote rehearsal at the time of reading. The quote endpoint revalidates the selection." },
  offers: { type: "array", items: { type: "object" } },
  observations: { type: "array", items: { type: "object", properties: {
    productId: string, name: string, salesUnit: string, amountPerSellUnit: nullableNumber,
    amountUnit: { anyOf: [unit, { type: "null" }] }, salesUnitPriceCents: nullableNumber, packAmountSource: string,
    litersPerSellUnit: nullableNumber, packVolumeSource: string,
    availableSellUnits: { ...nullableNumber, description: "Reported quantity where the schedule evidence supports it." },
    stockUnknown: { type: "boolean" },
    availableDate: { ...nullableString, format: "date", description: "Supplier schedule date in Helsinki. It can differ from the request." },
    closingTime: { ...nullableString, description: "Supplier cutoff timestamp. Valio uses offsets such as +0200." },
    reliability: { ...nullableNumber, description: "Historical delivery reliability from 0 to 1." },
    carbon: { ...nullableNumber, description: "Product-group carbon intensity in kg CO₂e per kg." },
    issues: list(string),
    observedCoverage: {
      ...object({ salesUnits: number, salesUnitIncrement: number, quantity: number, coveredQuantity: number,
        uncoveredQuantity: number, unit, productSubtotalCents: nullableNumber, guaranteed: { const: false } }),
      description: "How much this one SKU could cover from same-day reported stock, using catalog sales increments. Never a reservation or delivery commitment. Older saved observations may omit this field.",
    },
    estimate: { type: ["object", "null"], properties: {
      salesUnits: number, quantity: number, unit, liters: number,
      totalCents: { ...nullableNumber, description: "Estimated product cost before VAT. Deposit charges are unverified where indicated. Final weight may affect the quantity and cost of variable-weight items." },
      budgetFit: { enum: ["within_budget", "over_budget", "unknown"] },
      stockFit: { enum: ["reported_sufficient", "reported_insufficient", "unverified"] },
    } },
  } } },
  decision: { type: "object", properties: {
    outcome: string, withinBudgetCount: integer, bestWithinBudget: { type: ["object", "null"] },
    ranking: {
      type: "object", required: ["objective", "status", "candidateCount", "measuredCount"],
      description: "Buyer-selected priority applied to full-quantity estimates within budget, excluding products with known blockers. The first measured option is advisory.",
      properties: {
        objective: rankingObjective, status: { enum: ["ranked", "unavailable"] },
        candidateCount: integer, measuredCount: integer,
        preferred: object({
          productId: string, name: string, totalCents: integer, blockers: list(string), openQuestions: list(string),
          reliability: { ...nullableNumber, description: "Historical delivery reliability from 0 to 1." },
          carbon: { ...nullableNumber, description: "Product-group carbon intensity in kg CO₂e per kg." },
        }),
      },
    },
  } },
} };
const receipt = { type: "object", required: ["orderId", "status", "totalCents", "events"], properties: {
  orderId: string, status: string, totalCents: integer, uncoveredLiters: integer, events: trace,
  simulated: { const: true }, rehearsal,
} };
const routineRoot = "/api/simulator/routine-milk";
const routineBody = z.object({ period: z.iso.date() });

export function registerOpenApi(app: FastifyInstance) {
  app.get("/api/openapi.json", async () => ({
    openapi: "3.1.0",
    info: {
      title: "VALIO:Cosign purchasing API",
      version: "1.0.0",
      description: "Valio challenge observations and simulated orders. An enabled rehearsal lets a buyer quote, approve and place a simulated order from a saved supplier comparison on the same request.",
    },
    components: { securitySchemes: { simulatorBearer: { type: "http", scheme: "bearer", description: "The simulator issues separate buyer and agent credentials. Only the buyer credential can approve or commit." } } },
    paths: {
      "/api/capabilities": { get: { operationId: "getCapabilities", responses: { 200: response("Deployment mode and purchasing capabilities", {
        type: "object", properties: {
          mode: { enum: ["valio_challenge", "simulator"] }, supplierLookup: { type: "boolean" }, supplierCheckout: { const: false },
          simulatorEnabled: { type: "boolean" }, connectedRehearsalEnabled: { const: true },
          intakeEnabled: { type: "boolean" }, intakePhotoEnabled: { type: "boolean" }, purchasingAuthRequired: { const: true },
        },
      }) } } },
      "/api/session": { get: { operationId: "getPurchaseSession", security: simulatorAuth, responses: {
        200: response("Simulator actor or connected rehearsal buyer", object({ actorId: string })),
        401: response("Credential required"), 403: response("Buyer authority required for connected rehearsal"),
        404: response("Purchasing session unavailable"),
      } } },
      "/api/intake": { post: {
        operationId: "draftPurchaseRequest",
        requestBody: body(intakeInputSchema),
        responses: {
          200: response("Editable product request draft with evidence and an optional estimate", z.toJSONSchema(intakeResponseSchema)),
          400: response("Invalid note or photo"),
          501: response("Photo intake requires configured NVIDIA access"),
          502: response("Photo intake could not be completed"),
        },
      } },
      "/api/valio/catalog": {
        get: {
          operationId: "searchCatalog",
          parameters: [
            { in: "query", name: "query", description: "Product name or code. Recognized product requirements in the text apply catalog declaration filters.", schema: { type: "string", maxLength: 120 } },
            { in: "query", name: "limit", schema: { type: "integer", minimum: 1, maximum: 48, default: 12 } },
            { in: "query", name: "volumeOnly", description: "Alias for amountDimension=ml when true.", schema: { type: "boolean", default: false } },
            { in: "query", name: "lactoseFreeOnly", schema: { type: "boolean", default: false } },
            { in: "query", name: "requirements", style: "form", explode: true,
              description: "Require an explicit catalog declaration for every selected product requirement.",
              schema: { type: "array", minItems: 1, maxItems: productRequirements.length, items: { enum: productRequirements } } },
            { in: "query", name: "amountDimension", description: "Filter by a supported catalog package measurement, including net mass when a product also declares volume.", schema: { enum: ["ml", "g", "each", "unmapped"] } },
            { in: "query", name: "freeFromAllergen", style: "form", explode: true,
              description: "Require an explicit catalog free-from declaration for every exact allergen code. Missing or conflicting evidence excludes the product. Verify declarations against the current package.",
              schema: { type: "array", minItems: 1, maxItems: 30, items: { type: "string", pattern: "^[A-Z][A-Z0-9]{1,2}$" } } },
            { in: "query", name: "closest", schema: { type: "boolean", default: false },
              description: "When nothing matches exactly, return up to 5 nearest products with exactMatch=false. Each lists its mismatches and whether any is a health risk. Never treat a closest match as meeting the request." },
          ],
          responses: {
            200: response("Matches from the local Valio catalog, ranked by relevance", {
              type: "object",
              required: ["products", "hasMore", "lactoseFreeRequired", "requirements"],
              properties: {
                hasMore: { type: "boolean" },
                lactoseFreeRequired: { type: "boolean", description: "The response was filtered to products with an explicit lactose-free declaration." },
                requirements: { ...list({ enum: productRequirements }), description: "Requirements applied from filters and query text." },
                products: { type: "array", items: { type: "object", properties: {
                  id: string, name: string, supplier: string, salesUnit: string,
                  finnishName: { type: ["string", "null"] },
                  amountPerSellUnit: { type: ["number", "null"] },
                  amountDimension: { enum: ["ml", "g", "each", "unmapped"] },
                  secondaryPackMeasure: object({ amount: number, unit: { const: "g" } }),
                  verifiedLactoseFree: { type: "boolean" },
                  requirements: { ...list({ enum: productRequirements }), description: "Product requirements supported by its catalog declarations." },
                } } },
              },
            }),
            400: response("Invalid search parameters"),
          },
        },
      },
      "/api/valio/catalog/{productId}": { get: {
        operationId: "getCatalogProductEvidence",
        parameters: [{ in: "path", name: "productId", required: true, schema: { type: "string", minLength: 1, maxLength: 64 } }],
        responses: {
          200: response("Local catalog evidence, optional signals and catalog-declared alternatives requiring buyer review", catalogProductDetail),
          400: response("Invalid challenge catalog product ID"),
          404: response("Unknown challenge catalog product ID"),
        },
      } },
      "/api/valio/lookup": { post: {
        operationId: "lookupSupplierDate", requestBody: body(lookupBody),
        responses: {
          200: response("Supplier observations for the requested date, with partial evidence when an upstream feed fails", object({ ...lookupEvidence, observations: lookupDay })),
          400: response("Invalid date or unknown or duplicate catalog IDs"), 502: response("No supplier feed available for the requested date"),
        },
      } },
      "/api/valio/lookup/dates": { post: {
        operationId: "compareSupplierDates", requestBody: body(lookupDatesBody),
        description: "Compares one to three distinct dates for the same catalog products. A schedule date that differs from the requested date is flagged; no slot, stock reservation or order is created.",
        responses: {
          200: response("Evidence for each date in request order, including individual failures", object({ ...lookupEvidence, productIds: list(string), days: list(lookupDay) })),
          400: response("Invalid date selection or unknown or duplicate catalog IDs"),
          502: response("All requested dates failed", object({ error: string, days: list(lookupDay) })),
        },
      } },
      "/api/requests": {
        get: {
          operationId: "listRequests", security: optionalSimulatorAuth,
          parameters: [
            { in: "query", name: "query", description: "Case-insensitive substring of the product name, saved search text, SKU or request ID.", schema: { ...string, maxLength: 120 } },
            { in: "query", name: "limit", schema: { ...integer, minimum: 1, maximum: 50, default: 50 } },
            { in: "query", name: "cursor", description: "Continuation value returned by the previous page. Reuse the same search query.", schema: { ...string, maxLength: 1024 } },
          ],
          responses: {
            200: response("Saved requests newest first, with a continuation value when more matches exist", object({ requests: list(savedRequest), nextCursor: nullableString })),
            400: response("Invalid search, page size or cursor"),
            401: response("Simulator credential required"),
          },
        },
        post: { operationId: "createRequest", security: optionalSimulatorAuth, requestBody: body(requestBody), responses: {
          201: response("Saved request", { type: "object", required: ["requestId"], properties: {
            requestId: string, diet: { enum: ["lactose-free"], description: "Included when the request adds a lactose-free requirement beyond the legacy diet field." },
            requirements: { ...requirements, description: "Effective requirements from selections and product text." },
          } }),
          400: response("Invalid requirement or elapsed deadline"), 401: response("Simulator credential required"),
        } },
      },
      "/api/requests/{id}": { parameters: pathId, get: { operationId: "getRequest", security: optionalSimulatorAuth, responses: {
        200: response("Saved request, latest comparison and decision history", object({
          request: savedRequest,
          comparison: { anyOf: [comparison, { type: "null" }] },
          approvedVersion: { type: ["integer", "null"] },
          placedOrderId: nullableString,
          events: { ...trace, description: "Recorded decisions in ledger order. Empty before the first comparison." },
        })),
        401: response("Simulator credential required"),
        404: response("Unknown request"),
      } } },
      "/api/requests/{id}/compare": { parameters: pathId, post: { operationId: "compareRequest", security: optionalSimulatorAuth, responses: {
        200: response("Valio observations or a simulated basket, depending on capabilities", comparison),
        404: response("Unknown request"), 409: response("Elapsed deadline"), 502: response("Supplier lookup failed"),
      } } },
      "/api/requests/{id}/rehearsal": {
        parameters: pathId,
        get: { operationId: "getConnectedRehearsal", security: simulatorAuth, responses: {
          200: response("Same-request simulated quote, approval state, and decision trail", object({
            quote: { anyOf: [comparison, { type: "null" }] }, approvedVersion: nullableNumber, placedOrderId: nullableString, events: trace,
          })),
          401: response("Credential required"), 403: response("Buyer authority required"), 404: response("Unknown request"),
          501: response("Connected rehearsal disabled"),
        } },
        post: { operationId: "quoteConnectedRehearsal", security: simulatorAuth, requestBody: body(rehearsalBody),
          description: "Save the chosen SKU's estimated price and quantity and the buyer's delivery deadline in a fixed simulated quote. Selecting a new source revision or SKU invalidates any previous quote approval.",
          responses: {
            201: response("Fixed simulated quote for the existing request", comparison), 400: response("Invalid comparison revision or product"),
            401: response("Credential required"), 403: response("Buyer authority required"), 404: response("Unknown request"),
            409: response("Comparison changed, candidate ineligible, or simulated order already placed"),
            501: response("Connected rehearsal disabled"),
          },
        },
      },
      "/api/proposals/{id}/approve": { parameters: pathId, post: { operationId: "approveProposal", security: simulatorAuth, requestBody: body(versionBody), responses: {
        200: response("Approved simulation revision"), 401: response("Credential required"), 403: response("Buyer authority required"),
        409: response("Stale, blocked or terminal proposal"), 501: response("Supplier checkout unavailable"),
      } } },
      "/api/proposals/{id}/commit": { parameters: pathId, post: { operationId: "commitProposal", security: simulatorAuth, requestBody: body(commitBody), responses: {
        201: response("New or replayed simulated receipt", receipt), 401: response("Credential required"), 403: response("Buyer authority required"),
        409: response("Approval missing, stale revision, incompatible key or request already placed"), 501: response("Supplier checkout unavailable"),
      } } },
      "/api/orders": { get: { operationId: "listSimulatedOrders", security: optionalSimulatorAuth,
        description: "The connected rehearsal requires buyer credentials. The fixture simulator accepts buyer or agent credentials.",
        responses: {
          200: response("Recent simulated receipts for the current mode", object({
            orders: list(object({ orderId: string, status: string, totalCents: integer, savedAt: string })),
          })),
          401: response("Credential required when simulation is enabled"), 403: response("Buyer authority required for connected rehearsals"),
        },
      } },
      "/api/orders/{id}": { parameters: pathId, get: { operationId: "getReceipt", security: simulatorAuth,
        description: "The connected rehearsal requires buyer credentials. The fixture simulator accepts buyer or agent credentials.",
        responses: {
          200: response("Simulated receipt", receipt), 401: response("Credential required"), 403: response("Buyer authority required for connected rehearsals"),
          404: response("Unknown receipt or simulated checkout unavailable"),
        },
      } },
      [routineRoot]: { get: { operationId: "getRoutineMilk", security: simulatorAuth, responses: {
        200: response("Current Helsinki week and simulator mandate"),
      } } },
      [`${routineRoot}/mandate`]: { post: { operationId: "setRoutineMilkMandate", security: simulatorAuth,
        requestBody: body(z.object({ active: z.boolean(), maxTotalCents: z.number().int().nonnegative() })),
        responses: { 200: response("Updated mandate"), 403: response("Buyer authority required") },
      } },
      [`${routineRoot}/run`]: { post: { operationId: "runRoutineMilk", security: simulatorAuth, requestBody: body(routineBody), responses: {
        201: response("New or replayed weekly simulated receipt", receipt),
        409: response("Wrong week, missing authority or spend cap exceeded"),
      } } },
    },
  }));
}
