import {
  claimGate, closestCatalogMatches, packConversion, productRequirements, requestedAmountFromQuery, requirementClaims, requirementsFromQuery,
  suggestCatalogSpelling, type CatalogAdapter, type CatalogProduct, type LookupResult, type SourceProvenance,
} from "@cosign/adapters";
import type { FastifyInstance } from "fastify";
import { basename } from "node:path";
import { z } from "zod";
import { allergenCode } from "../purchasing/requirements.js";

const productIds = z.array(z.string().trim().min(1).max(32)).min(1).max(12);
export const lookupBody = z.object({
  requestedDate: z.iso.date(),
  productIds,
});

export const lookupDatesBody = z.object({
  requestedDates: z.array(z.iso.date()).min(1).max(3)
    .refine((dates) => new Set(dates).size === dates.length, "Delivery dates must be unique"),
  productIds,
});

const productRequirement = z.enum(productRequirements);
const catalogQuery = z.object({
  query: z.string().trim().max(120).default(""),
  limit: z.coerce.number().int().min(1).max(48).default(12),
  volumeOnly: z.enum(["true", "false"]).default("false"),
  lactoseFreeOnly: z.enum(["true", "false"]).default("false"),
  requirements: z.union([productRequirement, z.array(productRequirement).min(1).max(productRequirements.length)])
    .transform((values) => typeof values === "string" ? [values] : values).optional(),
  amountDimension: z.enum(["ml", "g", "each", "unmapped"]).optional(),
  freeFromAllergen: z.union([allergenCode, z.array(allergenCode).min(1).max(30)])
    .transform((codes) => typeof codes === "string" ? [codes] : [...new Set(codes)]).optional(),
  closest: z.enum(["true", "false"]).default("false"),
}).refine(({ volumeOnly, amountDimension }) => volumeOnly !== "true" || !amountDimension || amountDimension === "ml", {
  path: ["amountDimension"], message: "volumeOnly=true requires amountDimension=ml",
});

function publicSource(source: SourceProvenance): SourceProvenance {
  return { ...source, evidenceRef: source.evidenceRef ? basename(source.evidenceRef) : undefined };
}

function observationStatus(result: LookupResult) {
  if (!result.errors.length) return "observed";
  return result.prices.length || result.availability.length ? "partial" : "unavailable";
}

function lookupUnavailable(results: LookupResult[]) {
  const accessError = results.some(({ errors }) => errors.some(({ code }) => code === "AUTH_ERROR" || code === "MISSING_API_KEY"));
  return accessError ? "Valio lookup requires a current challenge API key" : "Valio lookup unavailable";
}

export function registerValioRoutes(app: FastifyInstance, valio: CatalogAdapter, rehearsalEnabled = false) {
  app.get("/api/valio/catalog", async (req) => {
    const { query, limit, volumeOnly, lactoseFreeOnly, requirements: selectedRequirements, amountDimension, freeFromAllergen, closest } = catalogQuery.parse(req.query);
    const requirements = [...new Set([
      ...(selectedRequirements ?? []),
      ...(lactoseFreeOnly === "true" ? ["lactose-free" as const] : []),
      ...requirementsFromQuery(query),
    ])];
    const packDimension = amountDimension ?? (volumeOnly === "true" ? "ml" : undefined);
    const matches = await valio.shortlist({
      query,
      requiredClaims: requirementClaims(requirements),
      amountDimension: packDimension,
      freeFromAllergens: freeFromAllergen,
      limit: limit + 1,
    });
    const requestedAmount = requestedAmountFromQuery(query);
    const catalogProduct = (product: CatalogProduct) => {
      const declarations = productRequirements.filter((requirement) => !claimGate(product, requirementClaims([requirement])));
      const conversion = requestedAmount && packConversion(product, requestedAmount);
      return {
        id: product.id,
        name: product.displayName,
        finnishName: product.names.find(({ language }) => language === "fi")?.value ?? null,
        supplier: product.vendorName,
        salesUnit: product.salesUnit,
        amountPerSellUnit: product.amountPerSellUnit,
        amountDimension: product.amountDimension,
        ...(product.secondaryPackMeasure && { secondaryPackMeasure: product.secondaryPackMeasure }),
        verifiedLactoseFree: declarations.includes("lactose-free"),
        requirements: declarations,
        ...(conversion && { conversion }),
      };
    };
    const lactoseFreeRequired = requirements.includes("lactose-free");
    const didYouMean = suggestCatalogSpelling(await valio.loadCatalog(), query);
    if (matches.length || closest !== "true") {
      return {
        hasMore: matches.length > limit,
        lactoseFreeRequired,
        requirements,
        ...(didYouMean && { didYouMean }),
        products: matches.slice(0, limit).map(({ product }) => catalogProduct(product)),
      };
    }
    // No exact match: offer the nearest products, each with what it does not meet.
    const nearest = closestCatalogMatches(await valio.loadCatalog(), {
      query, requirements, freeFromAllergens: freeFromAllergen, amountDimension: packDimension, limit: 5,
    });
    return {
      hasMore: false,
      lactoseFreeRequired,
      requirements,
      exactMatch: false as const,
      ...(didYouMean && { didYouMean }),
      products: nearest.map(({ product, mismatches, healthRisk }) => ({ ...catalogProduct(product), mismatches, healthRisk })),
    };
  });

  async function observe(ids: string[], dates: string[]) {
    if (new Set(ids).size !== ids.length) return;
    const shortlist = await valio.shortlist({ productIds: ids, limit: 12 });
    const byId = new Map(shortlist.map((item) => [item.product.id, item]));
    if (ids.some((id) => !byId.has(id))) return;
    const [observations, signals] = await Promise.all([
      Promise.all(dates.map((requestedDate) => valio.lookup({ customer: "123", requestedDate, productIds: ids }))),
      valio.signals(ids),
    ]);
    return {
      source: valio.kind === "VALIO_LIVE" ? "VALIO_LIVE_MOCK_OBSERVATION" : "FIXTURE_OBSERVATION",
      checkout: rehearsalEnabled ? "SIMULATED_REHEARSAL" : "SIMULATED_SEPARATELY",
      observations: observations.map((result) => ({ ...result, source: publicSource(result.source), status: observationStatus(result) })),
      signals: signals.map((signal) => ({ ...signal,
        reliability: { ...signal.reliability, source: publicSource(signal.reliability.source) },
        carbonKgCo2ePerKg: { ...signal.carbonKgCo2ePerKg, source: publicSource(signal.carbonKgCo2ePerKg.source) },
      })),
      shortlist: ids.map((id) => {
        const { product: { details: _details, ...product }, reasons, source } = byId.get(id)!;
        return { product, reasons, source: publicSource(source) };
      }),
    };
  }

  app.post("/api/valio/lookup", async (req, reply) => {
    const { productIds, requestedDate } = lookupBody.parse(req.body);
    const result = await observe(productIds, [requestedDate]);
    if (!result) return reply.code(400).send({ error: "Unknown or duplicate product IDs" });
    const observations = result.observations[0];
    if (observations.status === "unavailable") return reply.code(502).send({ error: lookupUnavailable([observations]) });
    return { ...result, observations };
  });

  app.post("/api/valio/lookup/dates", async (req, reply) => {
    const { productIds, requestedDates } = lookupDatesBody.parse(req.body);
    const result = await observe(productIds, requestedDates);
    if (!result) return reply.code(400).send({ error: "Unknown or duplicate product IDs" });
    const { observations, ...rest } = result;
    if (observations.every(({ status }) => status === "unavailable")) {
      return reply.code(502).send({ error: lookupUnavailable(observations), days: observations });
    }
    return { ...rest, productIds, days: observations };
  });
}
