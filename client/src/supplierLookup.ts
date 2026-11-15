import { requestJson } from "./api";
import { ApiError } from "./types";

type EvidenceIssue = { code: string; detail: string; endpoint?: "price" | "availability" };

interface PriceEvidence {
  productId: string;
  usable: boolean;
  salesUnitPriceExVat?: { cents: number };
  salesUnitPriceIncVat?: { cents: number };
  comparisonPrice?: { cents: number };
  comparisonUnit?: "KG" | "L";
  listPriceExVat?: { cents: number };
  netPriceFound: boolean;
  pricingDate?: string;
  validFrom?: string;
  validTo?: string;
  taxRatePercent?: number;
  taxPerSalesUnitCents?: number;
  errors: EvidenceIssue[];
}

interface StockEvidence {
  productId: string;
  usable: boolean;
  availableDate?: string;
  availableSellUnits?: number;
  salesUnit?: string;
  logisticModel?: string | null;
  closingTime?: string;
  timeNow?: string;
  salesBlock?: boolean;
  scheduleSalesBlock?: boolean;
  cutoffPassed?: boolean;
  stockUnknown: boolean;
  errors: EvidenceIssue[];
}

type Signal = { present: boolean; value?: number };

export interface SupplierLookupDay {
  status: "observed" | "partial" | "unavailable";
  requestedDate: string;
  source: { observedAt: string; kind?: string };
  errors: EvidenceIssue[];
  prices: PriceEvidence[];
  availability: StockEvidence[];
}

export interface SupplierLookupResult {
  source: "VALIO_LIVE_MOCK_OBSERVATION" | "FIXTURE_OBSERVATION";
  productIds: string[];
  shortlist: { product: { id: string; displayName: string; salesUnit: string; amountPerSellUnit?: number | null;
    amountDimension?: "ml" | "g" | "each" | "unmapped" } }[];
  days: SupplierLookupDay[];
  signals: { productId: string; reliability: Signal; carbonKgCo2ePerKg: Signal }[];
  error?: string;
}

function isUnavailableDay(value: unknown): value is SupplierLookupDay {
  if (!value || typeof value !== "object") return false;
  const day = value as Partial<SupplierLookupDay>;
  return day.status === "unavailable" && typeof day.requestedDate === "string"
    && typeof day.source?.observedAt === "string" && Array.isArray(day.errors)
    && Array.isArray(day.prices) && day.prices.length === 0
    && Array.isArray(day.availability) && day.availability.length === 0;
}

export async function lookupSupplierDates(productIds: string[], requestedDates: string[]) {
  try {
    return await requestJson<SupplierLookupResult>("/api/valio/lookup/dates", {
      method: "POST", body: JSON.stringify({ productIds, requestedDates }),
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 502 && error.body && typeof error.body === "object") {
      const { days } = error.body as { days?: unknown };
      if (Array.isArray(days) && days.length === requestedDates.length && days.every(isUnavailableDay)
        && days.every(({ requestedDate }, index) => requestedDate === requestedDates[index])) {
        return {
          source: days.every(({ source }) => source.kind === "FIXTURE") ? "FIXTURE_OBSERVATION" : "VALIO_LIVE_MOCK_OBSERVATION",
          productIds,
          days,
          shortlist: [],
          signals: [],
          error: error.message,
        } satisfies SupplierLookupResult;
      }
    }
    throw error;
  }
}
