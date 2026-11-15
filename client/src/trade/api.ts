export async function tradeApi<T = unknown>(
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    credentials: "same-origin",
    method: body === undefined ? "GET" : "POST",
    headers:
      body === undefined
        ? {}
        : {
            "Content-Type": "application/json",
            "X-Requested-With": "Cosign",
          },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json();
  if (!response.ok)
    throw Object.assign(new Error(result.message ?? "Request failed"), {
      status: response.status,
      code: result.error,
    });
  return result as T;
}
export type Policy = {
  automaticLimitCents: number;
  requiredClaims: string[];
  freeFromAllergens: string[];
};
export type Session = {
  account: { id: string; name: string; email: string; policy: Policy };
  mcpUrl: string;
  nemotronModel: string | null;
  supplierCheckoutAvailable: boolean;
  orderRehearsalAvailable?: boolean;
  valioStubMode?: boolean;
};
export type RequestItem = {
  itemId: string;
  query: string;
  quantity: number;
  unit: string;
};
export type DeliveryMode = "by" | "on" | "preferred_by" | "preferred_on";
type ChangedItem = Omit<RequestItem, "itemId"> & { itemId?: string; productId?: string };
type ChangedTerms<T> = { before: T | null; after: T | null };
export type RequestChange = { revision: number } & (
  | { kind: "item_changed"; before: ChangedItem; after: ChangedItem }
  | { kind: "items_removed"; items: ChangedItem[] }
  | { kind: "constraints_relaxed";
      budget?: ChangedTerms<{ cents: number; mode: "hard" | "preferred" }>;
      delivery?: ChangedTerms<{ deadline: string; mode: DeliveryMode }>;
    }
);
export const isPreferredDelivery = (mode: DeliveryMode | undefined) =>
  mode === "preferred_by" || mode === "preferred_on";
const deliveryModes: readonly string[] = ["by", "on", "preferred_by", "preferred_on"];
export function isDeliveryMode(mode: unknown): mode is DeliveryMode {
  return typeof mode === "string" && deliveryModes.includes(mode);
}
export type Eligibility = { eligible: boolean; reasons: string[] };
export type DraftEligibility = Record<
  string,
  Eligibility
>;
export type DraftLine = {
  imageUrl?: string | null;
  name: string;
  salesUnits: number;
  salesUnit: string;
  totalCents: number;
  observedAt: string;
  availableDate?: string;
  deliveryStatus?: "estimated" | "time_unverified";
  caveats: string[];
};
export type RehearsalReceipt = {
  receiptId: string;
  kind: "order_rehearsal";
  submittedToSupplier: false;
  revision: number;
  totalCents: number;
  currency: "EUR";
  moneyBasis: "VAT_EXCLUSIVE";
  createdAt: string;
  authorization: "buyer_approval" | "account_policy";
};
export type ComparedProduct = {
  productId: string;
  imageUrl?: string | null;
  name: string;
  salesUnit: string;
  salesUnitPriceCents: number | null;
  availableSellUnits: number | null;
  reliability?: number | null;
  carbon?: number | null;
  availableDate?: string | null;
  deliveryStatus?: "estimated" | "after_deadline" | "unverified" | "time_unverified";
  issues: string[];
  estimate?: { totalCents: number | null; salesUnits: number };
};
export type DatedOffer = ComparedProduct & Eligibility & { availableDate: string };
export type ProductChoice = { productId: string; availableDate?: string };
export type ItemChoice = ProductChoice & { itemId: string };
export type BasketPlan = {
  status: "feasible" | "blocked" | "unresolved";
  selections?: ItemChoice[];
  totalCents?: number;
  explanation?: { basis: "earliest_completion_then_lowest_total"; completionDate: string; priceOptimal: boolean };
  reasons?: string[];
};
export type ItemAvailability = {
  status: "eligible" | "no_catalog_match" | "insufficient_stock" | "supplier_blocked" |
    "delivery_unavailable" | "over_budget" | "evidence_unverified" | "refresh_required";
  reasons: string[];
};
export type Comparison = {
  observedAt: string;
  observations?: ComparedProduct[];
  deliveryOffers?: DatedOffer[];
};
export type ItemComparison = { items: (Comparison & { itemId: string })[]; basketPlan?: BasketPlan };
export type Run = {
  id: string;
  source: string;
  status: string;
  title: string;
  revision: number;
  approved_revision: number | null;
  created_at: string;
  requirements?: {
    items?: RequestItem[];
    excludedItems?: RequestItem[];
    budgetCents?: number;
    budgetMode?: "hard" | "preferred";
    deadline?: string;
    deliveryMode?: DeliveryMode;
  };
  draftEligibility?: DraftEligibility;
  itemDraftEligibility?: Record<string, DraftEligibility>;
  itemAvailability?: Record<string, ItemAvailability>;
  partialBasketPlan?: BasketPlan & { status: "feasible"; omittedItemIds: string[] };
  approvalEligibility?: Eligibility;
  requestChanges?: RequestChange[];
  draft?: (
    | DraftLine
    | {
        items: (DraftLine & { itemId: string })[];
        totalCents: number;
        observedAt: string;
        caveats: string[];
      }
  ) & { policy?: Policy } | null;
  comparison?: Comparison | ItemComparison | null;
  receipt?: RehearsalReceipt | null;
};
export type TradeEvent = {
  id: string;
  run_id: string | null;
  action: string;
  status: string;
  actor_id: string;
  created_at: string;
  data: Record<string, unknown>;
};
