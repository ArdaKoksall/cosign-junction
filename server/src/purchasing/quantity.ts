import type { CatalogProduct, PriceObservation } from "@cosign/adapters";

export const requestUnits = ["kg", "g", "L", "ml", "each", "case"] as const;
export type RequestUnit = typeof requestUnits[number];
export type SupplierRequestUnit = RequestUnit | "sales_unit";

const caseVolumeEvidence = new Map([
  ["6408430100330", { ml: 20_000, pieces: 2, source: "Valio webshop case GTIN" }],
  ["6408430100248", { ml: 5_000, pieces: 5, source: "Valio Aimo product specification and Kespro case GTIN" }],
]);

export function packQuantity(product: CatalogProduct, unit: SupplierRequestUnit): { amount: number; unit: SupplierRequestUnit; source: string } | undefined {
  const source = "Challenge catalog";
  if (unit === "sales_unit") {
    return { amount: 1, unit, source };
  } else if (unit === "kg" || unit === "g") {
    if (product.amountDimension === "g" && product.amountPerSellUnit !== null) {
      return { amount: product.amountPerSellUnit, unit: "g", source };
    }
    if (product.secondaryPackMeasure?.unit === "g") return { ...product.secondaryPackMeasure, source };
  } else if (unit === "L" || unit === "ml") {
    if (product.amountDimension === "ml" && product.amountPerSellUnit !== null) {
      return { amount: product.amountPerSellUnit, unit: "ml", source };
    }
    if (product.salesUnit === "KI" && product.salesUnitGtin) {
      const evidence = caseVolumeEvidence.get(product.salesUnitGtin);
      const packs = product.units.filter((item) => item.unitId === "KI");
      if (evidence && packs.length === 1 && packs[0].gtin === product.salesUnitGtin && packs[0].sizeInBaseUnits === evidence.pieces) {
        return { amount: evidence.ml, unit: "ml", source: evidence.source };
      }
    }
  } else if (unit === "case" && ["KI", "CS"].includes(product.salesUnit)) {
    return { amount: 1, unit, source };
  } else if (unit === "each" && product.baseUnit === "ST") {
    if (product.salesUnit === "ST") return { amount: 1, unit, source };
    const packs = product.units.filter((item) => item.unitId === product.salesUnit
      && (!product.salesUnitGtin || item.gtin === product.salesUnitGtin));
    if (packs.length === 1 && Number.isSafeInteger(packs[0].sizeInBaseUnits) && packs[0].sizeInBaseUnits > 0) {
      return { amount: packs[0].sizeInBaseUnits, unit, source };
    }
  }
}

export function salesUnitIncrement(product: CatalogProduct): number | null {
  const lot = product.allowedLotSize;
  if (!Number.isFinite(lot) || lot <= 0) return null;
  if (product.salesUnit === "KG" || Number.isSafeInteger(lot)) return lot;
  // If a fractional increment divides every whole pack, quote whole packs.
  return Number.isSafeInteger(1 / lot) ? 1 : null;
}

export function stockLimitedSalesUnits(availableSellUnits: number, product: CatalogProduct): number | null {
  const increment = salesUnitIncrement(product);
  if (increment === null || !Number.isFinite(availableSellUnits) || availableSellUnits < 0) return null;
  const lots = availableSellUnits / increment;
  // Count exact multiples such as 9.9 / 3.3 despite binary rounding.
  const nearest = Math.round(lots);
  const count = Math.abs(lots - nearest) <= Number.EPSILON * lots * 4 ? nearest : Math.floor(lots);
  if (!Number.isSafeInteger(count)) return null;
  return Number((count * increment).toPrecision(15));
}

function conversionFactor(unit: SupplierRequestUnit): number {
  return unit === "kg" || unit === "L" ? 1000 : 1;
}

export function packAmountInUnit(amount: number, unit: SupplierRequestUnit): number {
  return amount / conversionFactor(unit);
}

export function requiredSalesUnits(quantity: number, unit: SupplierRequestUnit, product: CatalogProduct): number | null {
  const pack = packQuantity(product, unit);
  const increment = salesUnitIncrement(product);
  if (!pack || !increment) return null;
  const lots = quantity * conversionFactor(unit) / (pack.amount * increment);
  // Account for binary rounding at exact multiples such as 9.9 / 3.3.
  const rounded = Math.round(lots);
  const wholeLots = Math.abs(lots - rounded) <= Number.EPSILON * lots * 4;
  if (unit === "sales_unit") {
    return Number.isSafeInteger(quantity) && quantity >= product.minSellUnits && wholeLots ? quantity : null;
  }
  const count = wholeLots ? rounded : Math.ceil(lots);
  const salesUnits = Number((count * increment).toPrecision(15));
  return Number.isSafeInteger(count) && salesUnits > 0 ? salesUnits : null;
}

export function supplierUnitPriceCents(price: PriceObservation | undefined): number | null {
  const cents = price?.salesUnitPriceExVat?.cents;
  return price?.usable && price.quantity === 1 && (price.currency == null || price.currency === "EUR")
    && cents != null && Number.isSafeInteger(cents) && cents >= 0 ? cents : null;
}

export function supplierCostIssues(product: CatalogProduct) {
  const issues: ("DEPOSIT_CHARGES_UNVERIFIED" | "VARIABLE_WEIGHT")[] = [];
  if (product.details?.deposits.length) issues.push("DEPOSIT_CHARGES_UNVERIFIED");
  if (product.details?.variableWeight) issues.push("VARIABLE_WEIGHT");
  return issues;
}
