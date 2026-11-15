export type Instant = string;
export type CalendarDate = string;
export type SourceKind = "FIXTURE" | "VALIO_LIVE" | "LOCAL_CATALOG";
export type MoneyBasis = "VAT_INCLUSIVE" | "VAT_EXCLUSIVE";
export type EvidenceStatus = "DECLARED_PRESENT" | "MAY_CONTAIN" | "VERIFIED_ABSENT" | "UNKNOWN";

export const UNKNOWN_STOCK_SENTINEL = 999_999;
export const MAX_LOOKUP_PRODUCTS = 1_000;
export const DEFAULT_SHORTLIST_LIMIT = 12;
export const DEFAULT_API_BASE_URL = "https://junction26.valioaimo.fi";
export const HELSINKI_TIME_ZONE = "Europe/Helsinki";

export type AdapterErrorCode =
  | "MISSING_API_KEY"
  | "LOOKUP_LIMIT"
  | "EMPTY_SHORTLIST"
  | "HTTP_ERROR"
  | "AUTH_ERROR"
  | "INVALID_RESPONSE"
  | "PRODUCT_UNKNOWN"
  | "UNIT_MISMATCH"
  | "PRICE_UNUSABLE"
  | "STOCK_UNKNOWN"
  | "STOCK_SHORT"
  | "SALES_BLOCK"
  | "CUTOFF_PASSED"
  | "CUTOFF_UNVERIFIED"
  | "EMPTY_SCHEDULE"
  | "DELIVERY_CONFLICT"
  | "CLAIM_UNKNOWN"
  | "CLAIM_NOT_MET"
  | "PACK_UNMAPPED";

export interface SourceProvenance {
  kind: SourceKind;
  label: string;
  observedAt: Instant;
  revision: number;
  evidenceRef?: string;
  catalogHash?: string;
}

export interface Money {
  currency: "EUR";
  basis: MoneyBasis;
  cents: number;
}

export interface LocalizedName {
  language: string;
  value: string;
}

export interface PackUnit {
  unitId: string;
  gtin?: string;
  sizeInBaseUnits: number;
}

export interface ClaimEvidence {
  id: string;
  group: string;
  status: EvidenceStatus;
  synkkaId?: string;
  unit?: string;
}

export interface CatalogNutrient {
  id: string;
  value: number;
  unit: string;
  basisQuantity: number;
  basisQuantityUnit: string;
  unitPrecision?: string;
  servingSize?: number;
  servingSizeUnit?: string;
  dailyValueIntakePercent?: number;
}

export interface CatalogIngredient {
  sequence: number;
  names: LocalizedName[];
  origins: { country: string; type: string }[];
  percentage?: number;
}

export interface CatalogProductDetails {
  countryOfOrigin?: string;
  temperatureCondition?: number;
  deposits: { material: string; quantity: number; unit: string }[];
  brand?: string;
  ingredients: LocalizedName[];
  structuredIngredients: CatalogIngredient[];
  nutritionalContent: CatalogNutrient[];
  storageInstructions: LocalizedName[];
  preparationInstructions: LocalizedName[];
  usageInstructions: LocalizedName[];
  minTemperatureCelsius?: number;
  maxTemperatureCelsius?: number;
  variableWeight?: boolean;
  manufacturerUpdatedAt?: string;
}

export interface CatalogProduct {
  id: string;
  names: LocalizedName[];
  displayName: string;
  category: string;
  vendorName: string;
  salesUnit: string;
  baseUnit: string;
  salesUnitGtin?: string;
  allowedLotSize: number;
  sellUnitIncrement: number;
  minSellUnits: number;
  amountPerSellUnit: number | null;
  amountDimension: "ml" | "g" | "each" | "unmapped";
  secondaryPackMeasure?: { amount: number; unit: "g" };
  units: PackUnit[];
  substituteProductIds: string[];
  claims: ClaimEvidence[];
  allergens: ClaimEvidence[];
  packNotes: AdapterErrorCode[];
  details?: CatalogProductDetails;
}

export interface CatalogIndex {
  products: Map<string, CatalogProduct>;
  hash?: string;
  source: SourceProvenance;
}

export interface ShortlistQuery {
  query?: string;
  productIds?: string[];
  category?: string;
  requiredClaims?: string[];
  freeFromAllergens?: string[];
  amountDimension?: CatalogProduct["amountDimension"];
  includeSubstitutes?: boolean;
  limit?: number;
  offset?: number;
}

export interface ShortlistItem {
  product: CatalogProduct;
  reasons: string[];
  source: SourceProvenance;
}

export interface SignalValue {
  present: boolean;
  value?: number;
  unit?: string;
  granularity: "PRODUCT" | "PRODUCT_GROUP" | "UNKNOWN";
  source: SourceProvenance;
}

export interface ProductSignals {
  productId: string;
  reliability: SignalValue;
  carbonKgCo2ePerKg: SignalValue;
}

export interface PriceObservation {
  productId: string;
  usable: boolean;
  errors: { code: AdapterErrorCode; detail: string }[];
  quantity: number;
  netPriceFound: boolean;
  salesUnitPriceExVat?: Money;
  salesUnitPriceIncVat?: Money;
  comparisonPrice?: Money;
  comparisonUnit?: string;
  listPriceExVat?: Money;
  taxPerSalesUnitCents?: number;
  taxRatePercent?: number;
  validFrom?: Instant;
  validTo?: Instant;
  pricingDate?: Instant;
  currency?: string;
}

export interface AvailabilityObservation {
  productId: string;
  usable: boolean;
  errors: { code: AdapterErrorCode; detail: string }[];
  salesBlock: boolean;
  scheduleSalesBlock?: boolean;
  logisticModel?: string | null;
  closingTime?: Instant;
  timeNow?: Instant;
  requestedDate?: Instant;
  availableDate?: CalendarDate;
  salesUnit?: string;
  availableSellUnits?: number;
  stockUnknown: boolean;
  cutoffPassed: boolean;
}

export interface LookupRequest {
  customer: string;
  requestedDate: CalendarDate;
  productIds: string[];
  latestDeliveryAt?: Instant;
  now?: Instant;
  priceOnly?: boolean;
  signal?: AbortSignal;
}

export interface LookupResult {
  source: SourceProvenance;
  customer: string;
  requestedDate: CalendarDate;
  prices: PriceObservation[];
  availability: AvailabilityObservation[];
  errors: {
    code: AdapterErrorCode;
    detail: string;
    endpoint?: "price" | "availability";
    httpStatus?: number;
    retryAfterMs?: number;
  }[];
}

export interface CatalogAdapter {
  kind: SourceKind;
  loadCatalog(): Promise<CatalogIndex>;
  shortlist(query: ShortlistQuery): Promise<ShortlistItem[]>;
  signals(productIds: string[]): Promise<ProductSignals[]>;
  lookup(request: LookupRequest): Promise<LookupResult>;
}

export interface LiveAdapterOptions {
  apiKey?: string;
  baseUrl?: string;
  customer?: string;
  catalogPath?: string;
  reliabilityPath?: string;
  carbonPath?: string;
  fetchImpl?: typeof fetch;
}
