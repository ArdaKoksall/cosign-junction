import type { ProductRequirement } from "@cosign/adapters";
import type { SupplierRequestUnit } from "./quantity.js";
import type { RankingObjective } from "./ranking-objective.js";

export type Offer = {
  id: string;
  name: string;
  quantityLiters: number;
  priceCents: number;
  eligible: boolean;
  reason: string | null;
  reliability: number | null;
  carbon: number | null;
  source: string;
};

export type CompareResponse = {
  requestId: string;
  proposalId: string;
  version: number;
  offers: Offer[];
  totalCents: number;
  uncoveredLiters: number | null;
  uncoveredQuantity?: number;
  uncoveredUnit?: SupplierRequestUnit;
  status: string;
  comparisonMode?: "supplier_observations";
  observations?: SupplierObservation[];
  observedAt?: string;
  source?: string;
  checkoutSupported?: boolean;
  rehearsalCandidates?: string[];
  rehearsal?: ConnectedRehearsal;
  decision?: ReturnType<typeof import("./supplier-decision.js").supplierDecision>;
  /** When no catalog product had every required declaration: the nearest ones and what each misses. */
  closestProducts?: { productId: string; name: string; healthRisk: boolean; mismatches: import("@cosign/adapters").CatalogMismatch[] }[];
};

export type ConnectedRehearsal = {
  productId: string;
  name: string;
  quantity: number;
  requestedQuantity: number;
  requestedDeadline: string;
  unit: SupplierRequestUnit;
  salesUnits: number;
  salesUnit: string;
  salesUnitPriceCents: number;
  supplierComparisonId: string;
  supplierComparisonVersion: number;
  observedAt: string;
  closingTime: string;
  caveats: string[];
};

export type SupplierObservation = {
  productId: string;
  name: string;
  salesUnit: string;
  litersPerSellUnit: number | null;
  amountPerSellUnit?: number | null;
  amountUnit?: SupplierRequestUnit | null;
  salesUnitPriceCents: number | null;
  availableSellUnits: number | null;
  stockUnknown: boolean;
  closingTime: string | null;
  availableDate: string | null;
  deliveryStatus?: "estimated" | "time_unverified" | "after_deadline" | "unverified";
  reliability: number | null;
  carbon: number | null;
  issues: string[];
  packVolumeSource?: string;
  packAmountSource?: string;
  observedCoverage?: {
    salesUnits: number;
    salesUnitIncrement: number;
    quantity: number;
    coveredQuantity: number;
    uncoveredQuantity: number;
    unit: SupplierRequestUnit;
    productSubtotalCents: number | null;
    guaranteed: false;
  };
  estimate?: {
    salesUnits: number;
    liters?: number;
    quantity?: number;
    unit?: SupplierRequestUnit;
    totalCents: number | null;
    budgetFit: "within_budget" | "over_budget" | "above_budget_preference" | "no_budget_limit" | "unknown";
    stockFit: "reported_sufficient" | "reported_insufficient" | "unverified";
  } | null;
};

export type DecisionEvent = {
  at: string;
  action: string;
  outcome: string;
  detail: string;
  revision?: number;
  actorId?: string;
};

export type OrderResponse = {
  orderId: string;
  status: string;
  totalCents: number;
  uncoveredLiters: number;
  rehearsal?: ConnectedRehearsal;
  events: DecisionEvent[];
};

export type RequestRecord = {
  id: string;
  quantityLiters: number | null;
  quantity: number;
  unit: SupplierRequestUnit;
  deadline: string;
  deliveryMode?: "by" | "on";
  diet: string;
  requirements?: ProductRequirement[];
  freeFromAllergen?: string[];
  rankingObjective?: RankingObjective;
  budgetCents: number;
  createdAt: string;
  query?: string;
  productId?: string;
  preset?: "monday_milk";
  createdBy?: string;
};

export type SupplierRequest = Omit<RequestRecord, "deadline" | "deliveryMode" | "budgetCents"> & {
  deadline?: string;
  deliveryMode?: "by" | "on" | "preferred_by" | "preferred_on";
  budgetCents?: number;
  budgetMode?: "hard" | "preferred";
};

export type ProposalRecord = {
  id: string;
  requestId: string;
  version: number;
  offers: Offer[];
  totalCents: number;
  uncoveredLiters: number | null;
  uncoveredQuantity?: number;
  uncoveredUnit?: SupplierRequestUnit;
  status: string;
  approvedVersion: number | null;
  events?: OrderResponse["events"];
  comparisonMode?: CompareResponse["comparisonMode"];
  observations?: SupplierObservation[];
  deliveryOffers?: SupplierObservation[];
  observedAt?: string;
  observationSequence?: number;
  source?: string;
  checkoutSupported?: boolean;
  connectedRehearsal?: boolean;
  rehearsal?: ConnectedRehearsal;
};

export type OrderRecord = OrderResponse & {
  requestId: string;
  proposalId: string;
  version: number;
  idempotencyKey: string;
  mandateId?: string;
  mandatePeriod?: string;
};

export type BuyerMandate = {
  id: string;
  revision: number;
  active: boolean;
  maxTotalCents: number;
  updatedAt: string;
};

export type State = {
  seq: number;
  requests: Record<string, RequestRecord>;
  proposals: Record<string, ProposalRecord>;
  orders: Record<string, OrderRecord>;
  requestOrderId: Record<string, string>;
  idempotency: Record<string, string>;
  mandates?: Record<string, BuyerMandate>;
};

export const emptyState = (): State => ({
  seq: 0,
  requests: {},
  proposals: {},
  orders: {},
  requestOrderId: {},
  idempotency: {},
});
