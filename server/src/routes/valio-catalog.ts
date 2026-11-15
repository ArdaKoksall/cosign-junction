import { basename } from "node:path";
import { claimGate, hasExplicitAllergenAbsence, productRequirements, requirementClaims, type CatalogAdapter, type CatalogProduct, type SourceProvenance } from "@cosign/adapters";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { packQuantity } from "../purchasing/quantity.js";

export const catalogProductPath = "/api/valio/catalog/:productId";
export const catalogProductParams = z.object({ productId: z.string().min(1).max(64) });

function sourceReference({ evidenceRef, ...source }: SourceProvenance) {
  return { ...source, ...(evidenceRef && { evidenceRef: basename(evidenceRef) }) };
}

function productSummary(product: CatalogProduct) {
  const packDimensions = (["ml", "g", "each", "case"] as const).flatMap((unit) => {
    const pack = packQuantity(product, unit);
    return pack ? [pack] : [];
  });
  const allergenConflicts = product.allergens.filter(({ id, status }) => status === "VERIFIED_ABSENT"
    && !hasExplicitAllergenAbsence(product, id)).map(({ id }) => id);
  if (product.claims.some(({ id, group, status }) => id === "FREE_FROM_LACTOSE" && group === "nutritionalClaim" && status === "VERIFIED_ABSENT")
    && product.allergens.some(({ id, status }) => id === "ML" && status !== "VERIFIED_ABSENT")) {
    allergenConflicts.push("ML");
  }
  const requirements = productRequirements.filter((requirement) => !claimGate(product, requirementClaims([requirement])));
  return {
    id: product.id,
    name: product.displayName,
    supplier: product.vendorName,
    category: product.category,
    salesUnit: product.salesUnit,
    salesUnitGtin: product.salesUnitGtin ?? null,
    allowedLotSize: product.allowedLotSize,
    packDimensions,
    variableWeight: product.details?.variableWeight ?? null,
    verifiedLactoseFree: requirements.includes("lactose-free"),
    requirements,
    allergens: product.allergens,
    allergenConflicts: [...new Set(allergenConflicts)],
  };
}

export function registerValioCatalogProductRoute(app: FastifyInstance, valio: CatalogAdapter) {
  app.get(catalogProductPath, async (req, reply) => {
    const { productId } = catalogProductParams.parse(req.params);
    const catalog = await valio.loadCatalog();
    const product = catalog.products.get(productId);
    if (!product) return reply.code(404).send({ error: "Unknown catalog product" });

    const [signals] = await valio.signals([productId]);
    const details = product.details;
    const alternatives = [...new Set(product.substituteProductIds)].filter((id) => id !== productId).map((id) => {
      const candidate = catalog.products.get(id);
      return {
        candidateProductId: id,
        product: candidate ? productSummary(candidate) : null,
        relationship: "CATALOG_DECLARED" as const,
      };
    });
    return {
      product: {
        ...productSummary(product),
        names: product.names,
        baseUnit: product.baseUnit,
        units: product.units,
        claims: product.claims.filter(({ group }) => group === "nutritionalClaim"),
        labels: product.claims.filter(({ group }) => group === "packagingMarkedLabel"),
        countryOfOrigin: details?.countryOfOrigin ?? null,
        temperatureCondition: details?.temperatureCondition ?? null,
        deposits: details?.deposits ?? [],
        brand: details?.brand ?? null,
        ingredients: details?.ingredients ?? [],
        structuredIngredients: details?.structuredIngredients ?? [],
        nutritionalContent: details?.nutritionalContent ?? [],
        storageInstructions: details?.storageInstructions ?? [],
        preparationInstructions: details?.preparationInstructions ?? [],
        usageInstructions: details?.usageInstructions ?? [],
        storageTemperatureCelsius: {
          min: details?.minTemperatureCelsius ?? null,
          max: details?.maxTemperatureCelsius ?? null,
        },
        manufacturerUpdatedAt: details?.manufacturerUpdatedAt ?? null,
      },
      alternatives,
      signals: signals ? {
        productId: signals.productId,
        reliability: { ...signals.reliability, source: sourceReference(signals.reliability.source) },
        carbonKgCo2ePerKg: { ...signals.carbonKgCo2ePerKg, source: sourceReference(signals.carbonKgCo2ePerKg.source) },
      } : null,
      source: sourceReference(catalog.source),
    };
  });
}
