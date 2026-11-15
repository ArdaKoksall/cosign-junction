import { eur, eurosToCents } from "./money.js";
import { supplierCalendarDate, supplierInstant } from "./time.js";
import {
  UNKNOWN_STOCK_SENTINEL,
  type AdapterErrorCode,
  type AvailabilityObservation,
  type CatalogProduct,
  type PriceObservation
} from "./types.js";

interface RawMoney {
  value?: number;
  valueWithTax?: number;
  validFrom?: string;
  validTo?: string;
  currency?: string;
}

export interface RawPrice {
  productId: string;
  quantity: number;
  catalogPrice?: RawMoney | null;
  priceWithTax?: RawMoney | null;
  comparisonPrice?: RawMoney | null;
  comparisonUnit?: string | null;
  listPrice?: RawMoney | null;
  tax?: { taxRate?: number; taxValue?: number } | null;
  netPriceFound: boolean;
  error: boolean;
}

export interface RawScheduleLine {
  salesBlock: boolean;
  availableAmount: number;
  availableDate?: string | null;
  salesUnit: string;
}

export interface RawAvailability {
  productId: string;
  closingTime?: string | null;
  salesBlock: boolean;
  logisticModel?: string | null;
  scheduleLines: RawScheduleLine[];
}

function err(code: AdapterErrorCode, detail: string) {
  return { code, detail };
}

function isEuroAmount(value: unknown): value is number {
  return typeof value === "number" && value >= 0 && Number.isSafeInteger(Math.round(value * 100));
}

function coversPricingDate(price: RawMoney | null | undefined, pricingDate: string | undefined) {
  if (pricingDate === undefined) return true;
  const day = supplierCalendarDate(pricingDate);
  const start = supplierCalendarDate(price?.validFrom);
  const end = supplierCalendarDate(price?.validTo);
  if (!day || !start || !end || day < start || day > end) return false;

  const pricedAt = supplierInstant(pricingDate);
  const validFrom = supplierInstant(price?.validFrom);
  const validTo = supplierInstant(price?.validTo);
  if (validFrom && validTo && validFrom > validTo) return false;
  return !pricedAt || ((!validFrom || validFrom <= pricedAt) && (!validTo || pricedAt <= validTo));
}

function observedCents(price: RawMoney | null | undefined, field: "value" | "valueWithTax", pricingDate: string | undefined) {
  const value = price?.[field];
  return price?.currency === "EUR" && isEuroAmount(value) && coversPricingDate(price, pricingDate) ? eurosToCents(value) : undefined;
}

export function normalizePrice(raw: RawPrice, pricingDate?: string): PriceObservation {
  const errors: PriceObservation["errors"] = [];
  if (raw.error) errors.push(err("PRICE_UNUSABLE", "supplier marked error: true"));
  const ex = raw.catalogPrice?.value;
  if (!isEuroAmount(ex) || raw.catalogPrice?.currency !== "EUR" || raw.quantity !== 1) {
    errors.push(err("PRICE_UNUSABLE", "expected a nonnegative EUR price for one sales unit"));
  } else if (!coversPricingDate(raw.catalogPrice, pricingDate)) {
    errors.push(err("PRICE_UNUSABLE", "sales-unit price validity does not cover the supplier pricing date"));
  }
  const comparisonUnit = raw.comparisonUnit === "KG" || raw.comparisonUnit === "L" ? raw.comparisonUnit : undefined;
  const validFrom = raw.catalogPrice?.validFrom ?? raw.priceWithTax?.validFrom;
  const validTo = raw.catalogPrice?.validTo ?? raw.priceWithTax?.validTo;
  const currency = raw.catalogPrice?.currency ?? raw.priceWithTax?.currency;
  const observation: PriceObservation = {
    productId: raw.productId,
    usable: errors.length === 0,
    errors,
    quantity: raw.quantity,
    netPriceFound: raw.netPriceFound,
    comparisonUnit,
    pricingDate,
    validFrom: supplierCalendarDate(validFrom) ? validFrom : undefined,
    validTo: supplierCalendarDate(validTo) ? validTo : undefined,
    currency: typeof currency === "string" ? currency : undefined
  };
  if (!observation.usable || !isEuroAmount(ex)) return observation;

  const netCents = eurosToCents(ex);
  observation.salesUnitPriceExVat = eur(netCents, "VAT_EXCLUSIVE");
  const grossCatalog = observedCents(raw.catalogPrice, "valueWithTax", pricingDate);
  const grossSeparate = observedCents(raw.priceWithTax, "value", pricingDate);
  const gross = grossCatalog !== undefined && grossSeparate !== undefined && grossCatalog !== grossSeparate
    ? undefined : grossCatalog ?? grossSeparate;
  if (gross !== undefined && gross >= netCents) observation.salesUnitPriceIncVat = eur(gross, "VAT_INCLUSIVE");

  const comparison = observedCents(raw.comparisonPrice, "value", pricingDate);
  if (comparisonUnit && comparison !== undefined) {
    observation.comparisonPrice = eur(comparison, "VAT_EXCLUSIVE");
  }
  const listPrice = observedCents(raw.listPrice, "value", pricingDate);
  if (listPrice !== undefined) {
    observation.listPriceExVat = eur(listPrice, "VAT_EXCLUSIVE");
  }
  const tax = raw.tax;
  if (isEuroAmount(tax?.taxValue) && typeof tax.taxRate === "number" && Number.isFinite(tax.taxRate) && tax.taxRate >= 0) {
    const taxCents = eurosToCents(tax.taxValue);
    const expectedTaxCents = ex * tax.taxRate;
    const grossMatchesTax = !observation.salesUnitPriceIncVat
      || Math.abs(observation.salesUnitPriceIncVat.cents - netCents - taxCents) <= 1;
    if (grossMatchesTax && Math.abs(expectedTaxCents - taxCents) <= 1) {
      observation.taxPerSalesUnitCents = taxCents;
      observation.taxRatePercent = tax.taxRate;
    }
  }
  return observation;
}

export function normalizeAvailability(
  raw: RawAvailability,
  options: {
    catalog?: CatalogProduct;
    timeNow?: string;
    cutoffTime?: string;
    requestedDate: string;
    latestDeliveryAt?: string;
  }
): AvailabilityObservation {
  const errors: AvailabilityObservation["errors"] = [];
  // The published mock contract returns zero or one line. Conflicting lines
  // have no documented allocation/cutoff semantics, so don't pick one arbitrarily.
  const line = raw.scheduleLines.length === 1 ? raw.scheduleLines[0] : undefined;
  const amount = line?.availableAmount;
  const logisticModel = raw.logisticModel?.trim().toLowerCase();
  // Conservative review policy, not a claim that every large value is a supplier sentinel.
  const unknownReason = amount === UNKNOWN_STOCK_SENTINEL ? "availableAmount is the 999999 unknown-stock sentinel"
    : logisticModel === "terminal" ? "supplier does not know stock for terminal products"
    : logisticModel !== "stock" ? "supplier logistic model does not verify a stock quantity"
    : typeof amount !== "number" || !Number.isFinite(amount) || amount < 0 || amount > UNKNOWN_STOCK_SENTINEL
      ? "availableAmount is invalid or above the 999999 review threshold; quantity is unverified" : undefined;
  const stockUnknown = Boolean(line && unknownReason);
  const timeNow = options.timeNow;
  const cutoff = supplierInstant(raw.closingTime);
  const observed = supplierInstant(options.cutoffTime ?? timeNow);
  const cutoffPassed = Boolean(cutoff && observed && cutoff <= observed);
  const availableDay = supplierCalendarDate(line?.availableDate);

  if (!raw.scheduleLines.length) {
    errors.push(err("EMPTY_SCHEDULE", "no schedule lines"));
  } else if (!line) {
    errors.push(err("DELIVERY_CONFLICT", "multiple schedule lines have no documented allocation semantics"));
  }
  if (raw.salesBlock || line?.salesBlock) {
    errors.push(err("SALES_BLOCK", "sales block is true"));
  }
  if (cutoffPassed) {
    errors.push(err("CUTOFF_PASSED", "closingTime is not after timeNow"));
  } else if (line && (!cutoff || !observed)) {
    errors.push(err("CUTOFF_UNVERIFIED", "a valid cutoff and observation time are required"));
  }
  if (line && unknownReason) errors.push(err("STOCK_UNKNOWN", unknownReason));
  if (line && !stockUnknown && line.availableAmount === 0) {
    errors.push(err("STOCK_SHORT", "availableAmount is 0"));
  }
  if (options.catalog && line && line.salesUnit !== options.catalog.salesUnit) {
    errors.push(err("UNIT_MISMATCH", `schedule salesUnit ${line.salesUnit} != catalog ${options.catalog.salesUnit}`));
  }
  const deadlineDay = supplierCalendarDate(options.latestDeliveryAt);
  if (line && (!availableDay || availableDay !== options.requestedDate)) {
    errors.push(err("DELIVERY_CONFLICT", availableDay ? "availableDate differs from requestedDate" : "availableDate is missing or invalid"));
  } else if (availableDay && options.latestDeliveryAt && (!deadlineDay || availableDay > deadlineDay)) {
    errors.push(err("DELIVERY_CONFLICT", "availableDate is outside the buyer deadline"));
  }

  return {
    productId: raw.productId,
    usable: errors.length === 0,
    errors,
    salesBlock: raw.salesBlock,
    scheduleSalesBlock: line?.salesBlock,
    logisticModel: raw.logisticModel,
    closingTime: cutoff ? raw.closingTime ?? undefined : undefined,
    timeNow,
    requestedDate: options.requestedDate,
    availableDate: availableDay,
    salesUnit: line?.salesUnit,
    availableSellUnits: stockUnknown ? undefined : line?.availableAmount,
    stockUnknown: !line || stockUnknown,
    cutoffPassed
  };
}
