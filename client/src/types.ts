export type Diet = "none" | "lactose-free";
export type ProductRequirement = "lactose-free" | "gluten-free" | "vegan" | "vegetarian" | "no-added-sugar" | "high-protein";
export type QuantityUnit = "kg" | "g" | "L" | "ml" | "each" | "case";
export type RankingObjective = "cost" | "reliability" | "carbon";

export type CreateRequestBody = {
  deadline: string;
  diet: Diet;
  requirements?: ProductRequirement[];
  freeFromAllergen?: string[];
  rankingObjective?: RankingObjective;
  budgetCents: number;
  query?: string;
  productId?: string;
  preset?: "monday_milk";
} & ({ quantity: number; unit: QuantityUnit } | { quantityLiters: number });

export interface CreateRequestResponse {
  requestId: string;
  diet?: Diet;
  requirements?: ProductRequirement[];
}

export interface Offer {
  id: string;
  name: string;
  quantityLiters: number;
  priceCents: number;
  eligible: boolean;
  reason: string;
  reliability: number | null;
  carbon: number | null;
  source: string;
}

interface SupplierCandidate {
  productId: string;
  name: string;
  totalCents: number | null;
  blockers: string[];
  openQuestions: string[];
}

export interface RehearsalDetails {
  productId: string;
  name: string;
  requestedQuantity: number;
  requestedDeadline?: string;
  quantity: number;
  unit: QuantityUnit;
  salesUnits: number;
  salesUnit: string;
  salesUnitPriceCents: number;
  supplierComparisonId: string;
  supplierComparisonVersion: number;
  observedAt: string;
  closingTime: string;
  caveats: string[];
}

export interface CompareResponse {
  requestId: string;
  proposalId: string;
  version: number;
  offers: Offer[];
  totalCents: number;
  uncoveredLiters: number | null;
  uncoveredQuantity?: number;
  uncoveredUnit?: QuantityUnit;
  status: string;
  comparisonMode?: "supplier_observations";
  observations?: SupplierObservation[];
  observedAt?: string;
  source?: string;
  checkoutSupported?: boolean;
  rehearsalCandidates?: string[];
  rehearsal?: RehearsalDetails;
  decision?: {
    outcome: "no_match" | "needs_confirmation" | "blocked" | "evidence_complete";
    withinBudgetCount: number;
    bestWithinBudget: SupplierCandidate | null;
    /** Only when every product is blocked: the nearest options, best first. */
    runnersUp?: SupplierCandidate[];
    ranking?: {
      objective: RankingObjective;
      status: "ranked" | "unavailable";
      candidateCount: number;
      measuredCount: number;
      preferred?: SupplierCandidate & { reliability: number | null; carbon: number | null };
    };
  };
  /** Only when no product had every required declaration: the nearest catalog products. */
  closestProducts?: { productId: string; name: string; healthRisk: boolean; mismatches: CatalogMismatch[] }[];
}

export interface SupplierObservation {
  productId: string;
  name: string;
  salesUnit: string;
  litersPerSellUnit: number | null;
  amountPerSellUnit?: number | null;
  amountUnit?: QuantityUnit | null;
  packVolumeSource?: string;
  packAmountSource?: string;
  salesUnitPriceCents: number | null;
  availableSellUnits: number | null;
  stockUnknown: boolean;
  closingTime: string | null;
  availableDate: string | null;
  reliability: number | null;
  carbon: number | null;
  issues: string[];
  observedCoverage?: {
    salesUnits: number;
    salesUnitIncrement: number;
    quantity: number;
    coveredQuantity: number;
    uncoveredQuantity: number;
    unit: QuantityUnit;
    productSubtotalCents: number | null;
    guaranteed: false;
  };
  estimate?: {
    salesUnits: number;
    liters?: number | null;
    quantity?: number;
    unit?: QuantityUnit;
    totalCents: number | null;
    budgetFit: "within_budget" | "over_budget" | "unknown";
    stockFit: "reported_sufficient" | "reported_insufficient" | "unverified";
  } | null;
}

export interface Capabilities {
  mode: "simulator" | "valio_challenge";
  supplierLookup: boolean;
  supplierCheckout: boolean;
  simulatorEnabled: boolean;
  connectedRehearsalEnabled?: boolean;
  purchasingAuthRequired?: boolean;
  intakeEnabled?: boolean;
  intakePhotoEnabled?: boolean;
}

export interface CatalogProduct {
  id: string;
  name: string;
  finnishName: string | null;
  supplier: string;
  salesUnit: string;
  amountPerSellUnit: number | null;
  amountDimension: "ml" | "g" | "each" | "unmapped";
  secondaryPackMeasure?: { amount: number; unit: "g" };
  verifiedLactoseFree: boolean;
  requirements: ProductRequirement[];
  /** Packs needed for an amount typed in the search, e.g. "10 kg". */
  conversion?: CatalogPackConversion;
  /** Only on closest matches: what this product does not meet. */
  mismatches?: CatalogMismatch[];
  healthRisk?: boolean;
}

type PackDimension = CatalogProduct["amountDimension"];

export type CatalogMismatch =
  | { kind: "query_word"; word: string }
  | { kind: "requirement"; requirement: ProductRequirement; status: "not_met" | "unknown"; healthRisk: boolean }
  | { kind: "allergen"; allergen: string; status: "present" | "may_contain" | "undeclared"; healthRisk: true }
  | { kind: "pack_measure"; requested: PackDimension; actual: PackDimension; approximate?: { amount: number; unit: "ml" | "g" } };

export interface CatalogPackConversion {
  requested: { amount: number; unit: "kg" | "g" | "L" | "dl" | "cl" | "ml" };
  packAmount: number;
  packUnit: "ml" | "g";
  packs: number;
  approximate: boolean;
}

export interface CatalogSearchResult {
  products: CatalogProduct[];
  hasMore: boolean;
  lactoseFreeRequired: boolean;
  requirements: ProductRequirement[];
  /** False when nothing matched exactly and the products are the closest available. */
  exactMatch?: false;
  /** Spelling-corrected search, e.g. "mils" -> "milk", when a word isn't in the catalog. */
  didYouMean?: string;
}

export interface CatalogFilters {
  requirements: ProductRequirement[];
  amountDimension: "" | "ml" | "g" | "unmapped";
  freeFromAllergen: string[];
}

export interface CatalogClassification {
  id: string;
  group: string;
  status: "DECLARED_PRESENT" | "MAY_CONTAIN" | "VERIFIED_ABSENT" | "UNKNOWN";
  synkkaId?: string;
}

export interface CatalogPackDimension {
  amount: number;
  unit: "ml" | "g" | "each" | "case";
  source: string;
}

interface CatalogText {
  language: string;
  value: string;
}

interface CatalogSignal {
  present: boolean;
  value?: number;
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
  names: CatalogText[];
  origins: { country: string; type: string }[];
  percentage?: number;
}

export interface CatalogProductEvidence {
  product: {
    id: string;
    name: string;
    supplier: string;
    salesUnit: string;
    salesUnitGtin: string | null;
    allowedLotSize: number;
    variableWeight: boolean | null;
    packDimensions: CatalogPackDimension[];
    claims: CatalogClassification[];
    requirements: ProductRequirement[];
    allergens: CatalogClassification[];
    allergenConflicts: string[];
    labels: CatalogClassification[];
    countryOfOrigin: string | null;
    storageTemperatureCelsius: { min: number | null; max: number | null };
    brand: string | null;
    deposits: { material: string; quantity: number; unit: string }[];
    ingredients: CatalogText[];
    structuredIngredients: CatalogIngredient[];
    nutritionalContent: CatalogNutrient[];
    storageInstructions: CatalogText[];
    preparationInstructions: CatalogText[];
    usageInstructions: CatalogText[];
    manufacturerUpdatedAt: string | null;
  };
  alternatives: {
    candidateProductId: string;
    relationship: "CATALOG_DECLARED";
    product: {
      id: string;
      name: string;
      variableWeight: boolean | null;
      packDimensions: CatalogPackDimension[];
      verifiedLactoseFree: boolean;
      requirements: ProductRequirement[];
      allergenConflicts: string[];
    } | null;
  }[];
  signals: { reliability: CatalogSignal; carbonKgCo2ePerKg: CatalogSignal } | null;
  source: { label: string };
}

export interface SavedRequest {
  id: string;
  createdAt: string;
  deadline: string;
  diet: Diet;
  requirements?: ProductRequirement[];
  freeFromAllergen?: string[];
  rankingObjective?: RankingObjective;
  budgetCents: number;
  query?: string;
  productId?: string;
  preset?: "monday_milk";
  quantity?: number;
  unit?: QuantityUnit;
  quantityLiters?: number | null;
}

export interface SavedRequestsPage {
  requests: SavedRequest[];
  nextCursor: string | null;
}

export type IntakeField = "query" | "quantity" | "unit" | "quantityLiters" | "deadline" | "deadlineDate" | "budgetCents" | "diet";

export interface BudgetEstimate {
  totalCents: number;
  source: "supplier_catalog" | "planning_reference";
  label: string;
}

interface IntakeExcerpt {
  source: "note" | "image";
  excerpt: string;
}

export interface IntakeDraft {
  model: string;
  status: "draft" | "clarify" | "review_conflict";
  question: string | null;
  draft: {
    query: string | null;
    quantity: number | null;
    unit: QuantityUnit | null;
    quantityLiters: number | null;
    deadline: string | null;
    deadlineDate?: string;
    budgetCents: number | null;
    diet: Diet | null;
    requirements?: ProductRequirement[];
    rankingObjective?: RankingObjective;
  };
  budgetEstimate?: BudgetEstimate | null;
  evidence: (IntakeExcerpt & { field: IntakeField })[];
  conflictEvidence?: IntakeExcerpt[];
  requirementEvidence?: (IntakeExcerpt & { requirement: ProductRequirement })[];
  rankingEvidence?: IntakeExcerpt;
}

export interface ApproveResponse {
  approved: boolean;
  version: number;
}

export interface CommitBody {
  version: number;
  idempotencyKey: string;
}

export interface DecisionEvent {
  type?: string;
  at?: string;
  message?: string;
  action?: string;
  outcome?: string;
  detail?: string;
  actorId?: string;
  revision?: number;
}

export interface CommitResponse {
  orderId: string;
  status: string;
  totalCents: number;
  uncoveredLiters: number;
  events: DecisionEvent[] | string[];
  simulated?: true;
  rehearsal?: RehearsalDetails;
}

export type OrderResponse = CommitResponse;

export interface ApiErrorShape {
  error?: string;
  message?: string;
  code?: string;
  status?: number;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly body: unknown;

  constructor(message: string, status: number, body?: unknown, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
    this.code = code;
  }
}

export type Screen =
  | "dashboard"
  | "workspace"
  | "request"
  | "compare"
  | "review"
  | "receipt"
  | "history"
  | "catalog"
  | "lookup"
  | "routine";

export interface RoutineMilkStatus {
  period: string;
  placedOrderId: string | null;
  quantityLiters: number;
  mandate: { active: boolean; revision: number; maxTotalCents: number } | null;
}

export interface RecentOrder {
  orderId: string;
  status: string;
  totalCents: number;
  savedAt: string;
}
