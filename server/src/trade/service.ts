import { z } from "zod";
import { isDeepStrictEqual } from "node:util";
import {
  calendarDateInHelsinki,
  claimGate,
  hasExplicitAllergenAbsence,
  productRequirements,
  requirementClaims,
  type CatalogAdapter,
} from "@cosign/adapters";
import { compareSupplierRequest, compareSupplierRequests, outsideDeliveryPreference, overBudgetPreference } from "../purchasing/supplier-comparison.js";
import { combinedStock, deliveryStockKey, recommendBasket, type BasketPlan, type StockUse } from "../purchasing/basket-plan.js";
import {
  requestedProductRequirements,
  allergenCode,
} from "../purchasing/requirements.js";
import { supplierBlockers } from "../purchasing/supplier-decision.js";
import { requestUnits, requiredSalesUnits } from "../purchasing/quantity.js";
import type {
  SupplierRequest,
  ProposalRecord,
  SupplierObservation,
} from "../purchasing/types.js";
import {
  TradeDb,
  TradeError,
  id,
  hash,
  requireValue,
  type Actor,
} from "./db.js";

export const policySchema = z
  .object({
    automaticLimitCents: z.number().int().min(0).max(100_000_000),
    requiredClaims: z.array(z.enum(productRequirements)).max(20),
    freeFromAllergens: z.array(allergenCode).max(30),
  })
  .strict();
const productId = z.string().trim().min(1).max(32);
const itemSchema = z
  .object({
    query: z.string().trim().min(1).max(120),
    productId: productId.optional(),
    quantity: z.number().positive().max(1_000_000),
    unit: z.enum([...requestUnits, "sales_unit"]),
    requirements: z.array(z.enum(productRequirements)).max(20).optional(),
    freeFromAllergen: z.array(allergenCode).max(30).optional(),
  })
  .strict();
const itemInputSchema = itemSchema.extend({ query: itemSchema.shape.query.optional() }).refine(
  ({ query, productId, unit }) => Boolean(productId || (query && unit !== "sales_unit")),
  "Provide a query or productId. Supplier sales units require an exact productId.",
);
const orderFields = z.strictObject({
  deadline: z.iso.datetime({ offset: true }).optional(),
  deliveryMode: z.enum(["by", "on", "preferred_by", "preferred_on"]).optional(),
  budgetCents: z.number().int().min(0).max(100_000_000).optional(),
  budgetMode: z.enum(["hard", "preferred"]).optional(),
});
type OrderConstraints = z.infer<typeof orderFields>;
function hardBudgetFor({ budgetCents, budgetMode }: OrderConstraints) {
  return budgetMode === "preferred" ? undefined : budgetCents;
}
function pastHardDeadline({ deadline, deliveryMode }: OrderConstraints, now = Date.now()) {
  return deadline !== undefined && !deliveryMode?.startsWith("preferred_") && Date.parse(deadline) <= now;
}
const maxItems = 10;
const itemId = z.string().min(1).max(32);
const storedItemSchema = itemSchema.extend({
  requirements: z.array(z.enum(productRequirements)).default([]),
  freeFromAllergen: z.array(allergenCode).default([]),
});
const storedBasketItemSchema = storedItemSchema.extend({ itemId });
const changeItemSchema = z.object(storedItemSchema.pick({ query: true, productId: true, quantity: true, unit: true }).shape).extend({
  itemId: itemId.optional(),
});
const budgetTerms = z.object({ cents: orderFields.shape.budgetCents.unwrap(), mode: orderFields.shape.budgetMode.unwrap() });
const deliveryTerms = z.object({ deadline: orderFields.shape.deadline.unwrap(), mode: orderFields.shape.deliveryMode.unwrap() });
const requestChangeDetailsSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("item_changed"), before: changeItemSchema, after: changeItemSchema }),
  z.object({ kind: z.literal("items_removed"), items: z.array(changeItemSchema) }),
  z.object({
    kind: z.literal("constraints_relaxed"),
    budget: z.object({ before: budgetTerms, after: budgetTerms.nullable() }).optional(),
    delivery: z.object({ before: deliveryTerms, after: deliveryTerms.nullable() }).optional(),
  }),
]);
export const requestChangeSchema = z.intersection(requestChangeDetailsSchema, z.object({
  revision: z.number().int().positive(),
  actorSource: z.enum(["mcp", "nemotron"]),
  actorId: z.string(),
}));
type RequestChangeDetails = z.infer<typeof requestChangeDetailsSchema>;
type RequestChange = z.infer<typeof requestChangeSchema>;

function relaxedConstraintChanges(before: OrderConstraints, after: OrderConstraints): RequestChangeDetails | undefined {
  const budget = ({ budgetCents, budgetMode }: OrderConstraints) => budgetCents === undefined ? null
    : { cents: budgetCents, mode: budgetMode ?? "hard" as const };
  const delivery = ({ deadline, deliveryMode }: OrderConstraints) => deadline === undefined ? null
    : { deadline, mode: deliveryMode ?? "by" as const };
  const beforeBudget = budget(before);
  const afterBudget = budget(after);
  const beforeDelivery = delivery(before);
  const afterDelivery = delivery(after);
  const budgetRelaxed = beforeBudget?.mode === "hard"
    && (afterBudget?.mode !== "hard" || afterBudget.cents > beforeBudget.cents);
  const deliveryRelaxed = beforeDelivery && (beforeDelivery.mode === "by" || beforeDelivery.mode === "on") && (
    !afterDelivery || afterDelivery.mode.startsWith("preferred_")
    || Date.parse(afterDelivery.deadline) > Date.parse(beforeDelivery.deadline)
    || (beforeDelivery.mode === "on" && (afterDelivery.mode !== "on"
      || calendarDateInHelsinki(new Date(afterDelivery.deadline)) !== calendarDateInHelsinki(new Date(beforeDelivery.deadline))))
  );
  return budgetRelaxed || deliveryRelaxed ? {
    kind: "constraints_relaxed",
    ...(budgetRelaxed && { budget: { before: beforeBudget, after: afterBudget } }),
    ...(deliveryRelaxed && { delivery: { before: beforeDelivery, after: afterDelivery } }),
  } : undefined;
}
const needSchema = z.union([
  storedItemSchema.extend(orderFields.shape),
  orderFields.extend({
    items: z.array(storedBasketItemSchema).min(1).max(maxItems),
    excludedItems: z.array(storedBasketItemSchema).max(maxItems - 1).optional(),
  }),
]);
const createRequestSchema = orderFields.extend({
  ...itemSchema.partial().shape,
  items: z.array(itemInputSchema).min(1).max(maxItems).optional(),
  idempotencyKey: z.string().trim().min(1).max(100).optional(),
}).refine(
  ({ items, query, productId, quantity, unit, requirements, freeFromAllergen }) => items
    ? [query, productId, quantity, unit, requirements, freeFromAllergen].every(value => value === undefined)
    : Boolean(productId || (query && unit !== "sales_unit")) && quantity !== undefined && unit !== undefined,
  "Provide items or a single item with a query or productId, quantity and unit. Supplier sales units require an exact productId. Put dietary requirements inside each item when using items.",
).refine(({ deadline, deliveryMode }) => deadline !== undefined || deliveryMode === undefined,
  "Provide a deadline when setting a delivery mode.",
).refine(({ budgetCents, budgetMode }) => budgetCents !== undefined || budgetMode === undefined,
  "Provide budgetCents when setting a budget mode.",
);
const availableDate = z.iso.date().optional();
export const runIdSchema = z
  .object({ runId: z.string().min(1).max(100) })
  .strict();
export const toolSchemas = {
  get_account_context: z.object({}).strict(),
  list_requests: z.object({ status: z.enum(["active", "ready", "awaiting_approval", "approved", "needs_attention", "completed", "failed", "cancelled", "rejected", "queued", "running"]).optional(), limit: z.number().int().min(1).max(50).default(20) }).strict(),
  get_activity: runIdSchema.extend({ limit: z.number().int().min(1).max(50).default(20) }),
  browse_catalog: z.object({ query: z.string().trim().max(120).default(""), limit: z.number().int().min(1).max(24).default(12), offset: z.number().int().min(0).max(100000).default(0) }).strict(),
  get_product_details: z.object({ productId }).strict(),
  create_request: createRequestSchema,
  update_request_preferences: runIdSchema.extend({
    revision: z.number().int().nonnegative(),
    deadline: orderFields.shape.deadline.nullable(),
    deliveryMode: orderFields.shape.deliveryMode,
    budgetCents: orderFields.shape.budgetCents.nullable(),
    budgetMode: orderFields.shape.budgetMode,
  }).refine(({ deadline, deliveryMode, budgetCents, budgetMode }) =>
    [deadline, deliveryMode, budgetCents, budgetMode].some(value => value !== undefined),
    "Provide at least one budget or delivery change.",
  ).refine(({ deadline, deliveryMode, budgetCents, budgetMode }) =>
    !(deadline === null && deliveryMode !== undefined) && !(budgetCents === null && budgetMode !== undefined),
    "Clear a target by passing null without its mode.",
  ),
  amend_request: runIdSchema.extend({
    revision: z.number().int().nonnegative(),
    itemId: itemId.optional(),
    item: itemInputSchema,
  }),
  remove_request_items: runIdSchema.extend({
    revision: z.number().int().nonnegative(),
    itemIds: z.array(itemId).min(1).max(maxItems),
  }),
  search_products: runIdSchema.extend({
    query: itemSchema.shape.query.optional(),
    itemId: itemId.optional(),
  }),
  compare_products: runIdSchema.extend({ revision: z.number().int().nonnegative().optional() }),
  prepare_order: runIdSchema.extend({
    productId: productId.optional(),
    availableDate,
    selections: z.array(z.strictObject({ itemId, productId, availableDate })).min(1).max(maxItems).optional(),
    revision: z.number().int().nonnegative(),
  }).refine(({ productId, selections, availableDate }) =>
    Boolean(productId) !== Boolean(selections) && (!availableDate || Boolean(productId)),
    "Provide productId for a single-item request or selections for all items in a multi-item request."),
  get_request_status: runIdSchema,
  place_order: runIdSchema.extend({
    revision: z.number().int().positive(),
    idempotencyKey: z.string().min(16).max(100),
    mode: z.literal("rehearsal").optional(),
  }),
};
export type ToolName = keyof typeof toolSchemas;
export const readTools: string[] = ["get_account_context", "list_requests", "get_activity", "browse_catalog", "get_product_details", "get_request_status", "search_products"];
export function toolScope(tool: ToolName) {
  if (tool === "place_order") return "orders:write";
  return readTools.includes(tool) ? "catalog:read" : "requests:write";
}
export function productImage(product: {baseUnit: string; salesUnitGtin?: string; units: {unitId: string; gtin?: string; sizeInBaseUnits: number}[]}) {
  const gtin = product.units.find(unit => unit.sizeInBaseUnits === 1 && unit.gtin)?.gtin ?? product.salesUnitGtin;
  return gtin && /^\d{8,14}$/.test(gtin) ? `https://public.keskofiles.com/f/k-ruoka/product/${gtin}?w=400` : null;
}
export const toolDescriptions: Record<ToolName, string> = {
  get_account_context: "Read this buyer's current mandatory dietary/allergen rules, automatic spending authority and integration capabilities. No permission to change rules or approve purchases.",
  list_requests: "List only this account's purchase requests and agent tasks, with statuses, budgets, quantities and drafts. Use to answer questions about existing work instead of asking for IDs.",
  get_activity: "Read the durable action history and outputs of an account-owned request or agent task. Use for explaining what happened, errors and approval decisions.",
  browse_catalog: "Discover official catalog products without creating a purchase request. Account dietary/allergen rules apply. Returns product identities and pack information, not live prices or stock. Useful when quantity, budget or delivery date are not known yet.",
  get_product_details: "Read official ingredients, allergen evidence, pack sizes, nutrition, storage and sustainability/reliability signals for one catalog product. Report missing evidence as unknown; never treat an absent allergen claim as safe.",
  create_request:
    "Create one purchasing request with up to 10 items. Each item needs a query or exact productId, quantity, unit and any dietary or allergen rules. Use unit sales_unit with an exact productId to count whole supplier packs. Omit budgetCents when the buyer sets no cap. When they give a target they can exceed, set budgetMode to preferred. Supplied budgets default to hard limits. Omit deadline for the next available delivery dates. With a deadline, use by or on for hard timing and preferred_by or preferred_on for a target the buyer can move. Delivery mode defaults to by. The original flat fields are supported for one item. Reuse the same idempotencyKey and inputs on retries. Clarify ambiguous quantities and units.",
  update_request_preferences:
    "Change budget or delivery on an existing request with the buyer's agreement. Use the current revision. Omit fields to keep them, pass null for budgetCents or deadline to clear that target, or set its mode to mark a target hard or preferred. Changes clear the previous comparison, draft and approval. Compare again.",
  amend_request:
    "Replace one line of an existing request with the buyer's chosen alternative or corrected quantity. Pass the current revision and an itemId for an items-array request. Existing dietary and allergen requirements carry forward. This invalidates the old comparison and approval, so compare the amended request again.",
  remove_request_items:
    "Remove the specified lines from one multi-item request only after the buyer confirms exactly which lines to omit. Use the current revision and the line IDs; at least one item must remain. Removed lines stay visible in the request history. Compare the remaining items again before drafting. This action clears the previous comparison, draft and approval.",
  search_products:
    "Search the official catalog within the item's dietary and allergen rules. Pass itemId for an items-array request. A query override can find an alternative. Use amend_request with the buyer's choice to update the line before comparing. Catalog search does not provide current prices or stock.",
  compare_products:
    "Query official prices and availability for the requested items. Dated offers include estimated dates and draft eligibility. Report timing and price caveats, including offers outside preferred targets. Hard budget caps and dates still apply. When a line is blocked, check itemAvailability for the reason and partialBasketPlan for a possible remaining basket. Ask the buyer whether to retry, choose an alternative, or omit specific lines before revising the request. Missing supplier evidence means availability is unverified.",
  prepare_order:
    "Create one versioned estimate from the current comparison revision. Pass one {itemId, productId, availableDate?} per item in selections, or productId and optional availableDate for a flat request. Use dates from deliveryOffers or the feasible basket plan. The server checks all selections, any hard budget cap and account authority. Agent-proposed material request changes require buyer approval of the revised draft. If the draft needs approval, send the buyer its reviewUrl.",
  get_request_status:
    "Read persisted request state, supplier evidence, purchase draft and human approval. Use after the buyer has reviewed the web approval link.",
  place_order:
    "Supplier submission is unavailable. When the buyer asks to rehearse and orderRehearsalAvailable is true, pass mode: rehearsal to record a simulated receipt for the current authorized draft at its fixed amount. Reuse the same idempotencyKey and revision on retry. A rehearsal submits nothing to the supplier.",
};
type ItemNeed = z.infer<typeof storedItemSchema>;
type ItemInput = z.infer<typeof itemInputSchema>;
type Need = z.infer<typeof needSchema>;
type ItemComparison = ProposalRecord & { itemId: string };
type ItemAvailability = {
  status: "eligible" | "no_catalog_match" | "insufficient_stock" | "supplier_blocked" |
    "delivery_unavailable" | "over_budget" | "evidence_unverified" | "refresh_required";
  reasons: string[];
};
type ProductSelection = { productId: string; availableDate?: string };
type DraftLine = {
  productId: string;
  name: string;
  salesUnits: number;
  salesUnit: string;
  totalCents: number;
  unitPriceCents: number;
  observedAt: string;
  availableDate?: string;
  deliveryStatus?: "estimated" | "time_unverified";
  closingTime?: string;
  caveats: string[];
};
type Draft = (
  DraftLine | {
    items: (DraftLine & { itemId: string })[];
    totalCents: number;
    observedAt: string;
    caveats: string[];
  }
) & { policy: z.infer<typeof policySchema> };

type OrderRehearsalReceipt = {
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

export type Run = {
  id: string;
  account_id: string;
  actor_id: string;
  source: Actor["source"];
  status: string;
  title: string;
  requirements: Need | Record<string, never>;
  request_changes: RequestChange[];
  comparison: ProposalRecord | { items: ItemComparison[]; basketPlan?: BasketPlan } | null;
  draft: Draft | null;
  receipt: OrderRehearsalReceipt | null;
  rehearsal_key_hash: string | null;
  revision: number;
  approved_revision: number | null;
  messages: unknown[];
  step: number;
  [key: string]: unknown;
};
function evidenceBlockers(product: SupplierObservation | undefined, requireDeliveryDate: boolean) {
  if (!product) return ["Product is not in the current comparison"];
  return [
    ...new Set([
      ...supplierBlockers(product).map((issue) =>
        issue.replaceAll("_", " ").toLowerCase(),
      ),
      ...(requireDeliveryDate && (!product.availableDate ||
        (product.deliveryStatus !== "estimated" && product.deliveryStatus !== "time_unverified"))
        ? [product.deliveryStatus === "after_deadline" ? "After your deadline" : "Delivery date unverified"]
        : []),
      ...(product.estimate?.stockFit !== "reported_sufficient"
        ? ["Stock is not verified sufficient"]
        : []),
      ...(!(Date.parse(product.closingTime ?? "") > Date.now())
        ? ["Order cutoff expired or unknown"]
        : []),
      ...(product.salesUnitPriceCents == null ||
      product.estimate?.totalCents == null
        ? ["Price or required pack quantity is unknown"]
        : []),
    ]),
  ];
}

function staleEvidence(observedAt: string | undefined, now = Date.now()) {
  const timestamp = Date.parse(observedAt ?? "");
  return !Number.isFinite(timestamp) || now - timestamp > 300_000;
}

function basketPlanFor(items: ItemComparison[], needs: OrderConstraints, selections?: Map<string, ProductSelection>): BasketPlan {
  if (items.some(item => staleEvidence(item.observedAt))) {
    return { status: "unresolved", reasons: ["Refresh the supplier observations."] };
  }
  const lines = items.map(item => {
    const requested = selections?.get(item.itemId);
    return {
      itemId: item.itemId,
      offers: (item.deliveryOffers ?? []).filter(offer =>
        (!requested || (offer.productId === requested.productId &&
          (!requested.availableDate || offer.availableDate === requested.availableDate))) &&
        !evidenceBlockers(offer, true).length),
    };
  });
  const cap = hardBudgetFor(needs);
  const target = needs.budgetMode === "preferred" ? needs.budgetCents : undefined;
  const withinDates = lines.map(line => ({ ...line, offers: line.offers.filter(offer => !offer.issues.includes(outsideDeliveryPreference)) }));
  const hasDateDeviation = lines.some((line, index) => line.offers.length !== withinDates[index].offers.length);
  const attempts = [
    ...(target !== undefined ? [{ lines: withinDates, limit: target }] : []),
    ...(hasDateDeviation && target !== undefined ? [{ lines, limit: target }] : []),
    ...(hasDateDeviation ? [{ lines: withinDates, limit: cap }] : []),
  ];
  let preferredPlan: BasketPlan | undefined;
  for (const { lines: options, limit } of attempts) {
    const candidate = recommendBasket(options, limit);
    if (candidate.status === "feasible") {
      preferredPlan = candidate;
      break;
    }
  }
  const plan = preferredPlan ?? recommendBasket(lines, cap);
  if (plan.status !== "feasible") return plan;
  const caveats = [
    ...(target !== undefined && plan.totalCents > target ? [overBudgetPreference] : []),
    ...(hasDateDeviation && plan.selections.some(({ itemId, productId, availableDate }) =>
      !withinDates.find(line => line.itemId === itemId)?.offers.some(offer =>
        offer.productId === productId && offer.availableDate === availableDate)) ? [outsideDeliveryPreference] : []),
  ];
  return caveats.length ? { ...plan, caveats } : plan;
}

function observationEligibility(product: SupplierObservation, requireDeliveryDate: boolean, observedAt?: string) {
  const reasons = [
    ...evidenceBlockers(product, requireDeliveryDate),
    ...(staleEvidence(observedAt) ? ["Refresh the supplier observations"] : []),
  ];
  return { eligible: reasons.length === 0, reasons };
}

function draftEligibility(comparison: ProposalRecord, requireDeliveryDate = false) {
  return Object.fromEntries((comparison.observations ?? []).map(product => [
    product.productId, observationEligibility(product, requireDeliveryDate, comparison.observedAt),
  ]));
}

function summarizeAvailability(comparison: ProposalRecord, requireDeliveryDate: boolean): ItemAvailability {
  const observations = comparison.observations ?? [];
  if (!observations.length)
    return { status: "no_catalog_match", reasons: ["No catalog product matched this line and its requirements."] };
  if (staleEvidence(comparison.observedAt))
    return { status: "refresh_required", reasons: ["Refresh the supplier observations."] };

  const offers = comparison.deliveryOffers ?? observations;
  if (offers.some(offer => evidenceBlockers(offer, requireDeliveryDate).length === 0))
    return { status: "eligible", reasons: [] };

  // The representative observations also contain blocked products, including those without a dated offer.
  const checked = [...observations, ...offers];
  const blockers = checked.map(offer => evidenceBlockers(offer, requireDeliveryDate));
  const reasons = [...new Set(blockers.flat())];
  const verifiedDates = new Set(offers.filter(offer => offer.availableDate && !offer.issues.includes("DELIVERY_CONFLICT"))
    .map(offer => deliveryStockKey(offer.productId, offer.availableDate ?? undefined)));
  // A direct check of the supplier's suggested date supersedes the earlier mismatched response for that date.
  const stockChecks = checked.filter(offer => !offer.issues.includes("DELIVERY_CONFLICT") ||
    !verifiedDates.has(deliveryStockKey(offer.productId, offer.availableDate ?? undefined)));
  if (stockChecks.every(offer => !offer.stockUnknown && !offer.issues.includes("DELIVERY_CONFLICT") &&
    (offer.estimate?.stockFit === "reported_insufficient" || offer.issues.includes("STOCK_SHORT"))))
    return { status: "insufficient_stock", reasons };
  if (checked.every(offer => offer.issues.includes("SALES_BLOCK")))
    return { status: "supplier_blocked", reasons };
  if (checked.every(offer => offer.deliveryStatus === "after_deadline" ||
    (offer.availableDate !== null && offer.issues.includes("DELIVERY_CONFLICT"))))
    return { status: "delivery_unavailable", reasons };
  if (blockers.every(line => line.length === 1 && line[0] === "over budget"))
    return { status: "over_budget", reasons };
  if (checked.some(offer => offer.issues.includes("AVAILABILITY_LOOKUP_UNAVAILABLE")))
    reasons.unshift("The supplier did not return usable availability evidence for every checked offer. Refresh the lookup to retry.");
  if (checked.some(offer => offer.issues.includes("EMPTY_SCHEDULE")))
    reasons.push("The supplier returned an empty delivery schedule for at least one offer.");
  if (checked.some(offer => offer.issues.includes("PRICE_LOOKUP_UNAVAILABLE")))
    reasons.push("The supplier did not return usable price evidence for every checked offer. Refresh the lookup to retry.");
  return { status: "evidence_unverified", reasons };
}

function selectDraftLine(
  comparison: ProposalRecord, productId: string, requireDeliveryDate = false, availableDate?: string,
) {
  const { observedAt } = comparison;
  if (!observedAt || staleEvidence(observedAt))
    throw new TradeError(409, "stale_evidence", "Refresh prices and availability before preparing this order");
  const product = availableDate
    ? (comparison.deliveryOffers ?? comparison.observations)?.find(item =>
      item.productId === productId && item.availableDate === availableDate)
    : comparison.observations?.find(item => item.productId === productId);
  if (!product && availableDate && comparison.observations?.some(item => item.productId === productId))
    throw new TradeError(409, "unsuitable_product", `The comparison has no offer for product ${productId} on ${availableDate}. Check the observed delivery dates.`);
  const reasons = evidenceBlockers(product, requireDeliveryDate);
  if (reasons.length || product?.estimate?.totalCents == null || product.salesUnitPriceCents == null)
    throw new TradeError(409, "unsuitable_product", `Cannot prepare product ${productId}: ${reasons.join(", ") || "incomplete evidence"}. Inspect the comparison; do not repeat without new evidence.`);
  const line: DraftLine = {
    productId,
    name: product.name,
    salesUnits: product.estimate.salesUnits,
    salesUnit: product.salesUnit,
    totalCents: product.estimate.totalCents,
    unitPriceCents: product.salesUnitPriceCents,
    observedAt,
    closingTime: product.closingTime ?? undefined,
    ...(requireDeliveryDate && product.availableDate ? { availableDate: product.availableDate } : {}),
    ...(product.deliveryStatus === "estimated" || product.deliveryStatus === "time_unverified"
      ? { deliveryStatus: product.deliveryStatus } : {}),
    caveats: product.issues,
  };
  return { line, availableSellUnits: product.availableSellUnits };
}

function lineCutoff(run: Run, line: DraftLine & { itemId?: string }) {
  if (line.closingTime) return line.closingTime;
  // Drafts created before cutoffs were stored can use their matching observation.
  const comparison = run.comparison && "items" in run.comparison
    ? run.comparison.items.find(item => item.itemId === line.itemId)
    : run.comparison;
  if (comparison?.observedAt !== line.observedAt) return;
  return comparison?.observations?.find(observation =>
    observation.productId === line.productId &&
    (line.availableDate === undefined || observation.availableDate === line.availableDate) &&
    observation.estimate?.salesUnits === line.salesUnits &&
    observation.salesUnitPriceCents === line.unitPriceCents,
  )?.closingTime;
}

function draftProblem(run: Run, draft: Draft, policy: z.infer<typeof policySchema>) {
  const now = Date.now();
  if (pastHardDeadline(run.requirements, now))
    return { code: "past_deadline", message: "The delivery deadline has passed." };
  if (!isDeepStrictEqual(draft.policy, policy))
    return { code: "policy_changed", message: "Your purchasing rules changed. Refresh the comparison and prepare a new draft." };

  const lines = "items" in draft ? draft.items : [draft];
  if (lines.some(line => staleEvidence(line.observedAt, now)))
    return { code: "stale_evidence", message: "Refresh prices and availability and prepare a new draft." };
  if (lines.some(line => !(Date.parse(lineCutoff(run, line) ?? "") > now)))
    return { code: "stale_evidence", message: "A supplier cutoff expired or is unknown. Refresh prices and availability." };
}

function draftRequiresApproval(run: Run, draft: Draft, policy: z.infer<typeof policySchema>) {
  if (run.request_changes.length || draft.totalCents > policy.automaticLimitCents
    || draft.caveats.some(issue => issue !== "DELIVERY_TIME_UNVERIFIED"))
    return true;
  const lines = "items" in draft ? draft.items : [draft];
  // Unknown arrival time is informational when the calendar day satisfies the request.
  return lines.some(line => line.deliveryStatus !== "estimated" && line.caveats.includes("DELIVERY_TIME_UNVERIFIED"));
}

export class TradeService {
  constructor(
    readonly db: TradeDb,
    readonly adapter: CatalogAdapter,
    readonly origin: string,
    readonly orderRehearsalAvailable = false,
    readonly valioStubMode = false,
  ) {}
  async account(actor: Actor) {
    return requireValue(
      await this.db.one(
        "SELECT id,name,customer_id,policy FROM trade_accounts WHERE id=$1",
        [actor.accountId],
      ),
    );
  }
  async run(actor: Actor, runId: string) {
    return requireValue(
      await this.db.one<Run>(
        "SELECT * FROM trade_runs WHERE id=$1 AND account_id=$2",
        [runId, actor.accountId],
      ),
    );
  }
  async visibleRun(actor: Actor, runId: string) {
    const run = await this.run(actor, runId);
    const { messages, lease_until, lease_owner, account_id, approval_waits, creation_fingerprint, rehearsal_key_hash, request_changes, ...visible } = run;
    const catalog = run.comparison || run.draft ? await this.adapter.loadCatalog() : null;
    const withImage = <T extends { productId: string }>(value: T) => {
      const product = catalog?.products.get(value.productId);
      return { ...value, imageUrl: product ? productImage(product) : null };
    };
    const withObservationImages = <T extends ProposalRecord>(comparison: T) => ({
      ...comparison,
      observations: comparison.observations?.map(withImage),
      deliveryOffers: comparison.deliveryOffers?.map(offer => ({
        ...withImage(offer), ...observationEligibility(offer, true, comparison.observedAt),
      })),
    });
    const { comparison, draft } = run;
    const basketComparison = comparison && "items" in comparison ? comparison : undefined;
    const storedPlan = basketComparison?.basketPlan;
    const basketPlan: BasketPlan | undefined = storedPlan?.status === "feasible" && storedPlan.selections.some(selection => {
      const item = basketComparison?.items.find(candidate => candidate.itemId === selection.itemId);
      const offer = item?.deliveryOffers?.find(candidate => candidate.productId === selection.productId &&
        candidate.availableDate === selection.availableDate);
      return !offer || !observationEligibility(offer, true, item?.observedAt).eligible;
    })
      ? { status: "unresolved", reasons: ["Refresh the supplier observations for the recommended dates."] }
      : storedPlan;
    const checkedItems = comparison && "items" in comparison ? comparison.items
      : comparison ? [{ ...comparison, itemId: "item_1" }] : [];
    const itemAvailability = Object.fromEntries(checkedItems.map(item => [
      item.itemId, summarizeAvailability(item, checkedItems.length > 1 || item.deliveryOffers !== undefined),
    ]));
    const eligibleItems = basketComparison?.items.filter(item => itemAvailability[item.itemId].status === "eligible");
    const partialPlan = basketComparison && eligibleItems?.length && eligibleItems.length < basketComparison.items.length
      ? basketPlanFor(eligibleItems, run.requirements)
      : undefined;
    const partialBasketPlan = partialPlan?.status === "feasible" && basketComparison
      ? { ...partialPlan, omittedItemIds: basketComparison.items
        .filter(item => itemAvailability[item.itemId].status !== "eligible").map(item => item.itemId) }
      : undefined;
    const comparisons = comparison && "items" in comparison
      ? {
        comparison: { ...comparison, items: comparison.items.map(withObservationImages), basketPlan },
        itemDraftEligibility: Object.fromEntries(comparison.items.map(item => [
          item.itemId, draftEligibility(item, comparison.items.length > 1 || item.deliveryOffers !== undefined),
        ])),
      }
      : {
        comparison: comparison && withObservationImages(comparison),
        draftEligibility: comparison ? draftEligibility(comparison, comparison.deliveryOffers !== undefined) : {},
      };
    const approval = draft && run.status === "awaiting_approval"
      ? draftProblem(run, draft, policySchema.parse((await this.account(actor)).policy))
      : undefined;
    return {
      ...visible,
      ...comparisons,
      ...(request_changes.length > 0 && { requestChanges: request_changes }),
      itemAvailability,
      ...(partialBasketPlan && { partialBasketPlan }),
      draft: draft && ("items" in draft ? { ...draft, items: draft.items.map(withImage) } : withImage(draft)),
      kind: run.id.startsWith("job_") ? "agent_job" : "purchase_request",
      reviewUrl: `${this.origin}/?run=${encodeURIComponent(runId)}`,
      supplierCheckoutAvailable: false,
      orderRehearsalAvailable: this.orderRehearsalAvailable,
      ...(draft && run.status === "awaiting_approval" && {
        approvalEligibility: { eligible: !approval, reasons: approval ? [approval.message] : [] },
      }),
    };
  }
  async execute(
    actor: Actor,
    tool: ToolName,
    input: unknown,
    retryKey?: string,
  ) {
    const scope = toolScope(tool);
    if (!actor.scopes.includes(scope))
      throw new TradeError(
        403,
        "insufficient_scope",
        `Required permission: ${scope}`,
      );
    const args = toolSchemas[tool].parse(input);
    const runId = "runId" in args ? args.runId : null;
    if (runId) await this.run(actor, runId);
    const eventInput = "idempotencyKey" in args ? { ...args, idempotencyKey: undefined } : args;
    await this.db.event(actor, runId, tool, "started", eventInput);
    try {
      const result = await this.perform(actor, tool, args, retryKey);
      const auditResult = tool === "get_activity" ? { eventCount: (result as { events: unknown[] }).events.length } : result;
      await this.db.event(
        actor,
        runId ?? (result as { runId?: string }).runId ?? null,
        tool,
        "completed",
        auditResult,
      );
      return result;
    } catch (error) {
      const message =
        error instanceof TradeError
          ? error.message
          : "The operation failed; no supplier order was confirmed.";
      await this.db.event(actor, runId, tool, "failed", {
        code: error instanceof TradeError ? error.code : "upstream_error",
        message,
      });
      throw error;
    }
  }
  private async perform(
    actor: Actor,
    tool: ToolName,
    raw: unknown,
    retryKey?: string,
  ): Promise<unknown> {
    const account = await this.account(actor);
    const policy = policySchema.parse(account.policy);
    if (tool === "get_account_context") return {
      name: account.name,
      policy,
      supplierCheckoutAvailable: false,
      orderRehearsalAvailable: this.orderRehearsalAvailable,
      ...(this.valioStubMode && { valioStubMode: true }),
      currency: "EUR",
      moneyBasis: "VAT_EXCLUSIVE",
      timeZone: "Europe/Helsinki",
    };
    if (tool === "list_requests") {
      const {status, limit} = toolSchemas.list_requests.parse(raw);
      const requests = await this.db.rows("SELECT id,title,source,status,requirements,draft,receipt,revision,created_at,updated_at FROM trade_runs WHERE account_id=$1 AND ($2::text IS NULL OR status=$2) ORDER BY updated_at DESC LIMIT $3", [actor.accountId, status ?? null, limit]);
      return {requests: requests.map(row => ({...row, kind: row.id.startsWith("job_") ? "agent_job" : "purchase_request", reviewUrl: `${this.origin}/?run=${row.id}`}))};
    }
    if (tool === "get_activity") {
      const {runId, limit} = toolSchemas.get_activity.parse(raw);
      await this.run(actor, runId);
      return {runId, events: await this.db.rows("SELECT id,action,status,data,created_at FROM trade_events WHERE account_id=$1 AND run_id=$2 AND action <> 'get_activity' ORDER BY id DESC LIMIT $3", [actor.accountId, runId, limit])};
    }
    if (tool === "browse_catalog") {
      const {query, limit, offset} = toolSchemas.browse_catalog.parse(raw);
      const products = await this.adapter.shortlist({query, limit: limit + 1, offset, requiredClaims: requirementClaims(policy.requiredClaims as typeof productRequirements[number][]), freeFromAllergens: policy.freeFromAllergens});
      return {offset, limit, hasMore: products.length > limit, products: products.slice(0, limit).map(({product,source}) => ({id: product.id, name: product.displayName, salesUnit: product.salesUnit, amountPerSellUnit: product.amountPerSellUnit, amountDimension: product.amountDimension, brand: product.details?.brand, claims: product.claims, allergens: product.allergens, imageUrl: productImage(product), source})), policyApplied: policy, pricesIncluded: false};
    }
    if (tool === "get_product_details") {
      const {productId} = toolSchemas.get_product_details.parse(raw);
      const catalog = await this.adapter.loadCatalog();
      const product = requireValue(catalog.products.get(productId), "Product not found in official catalog");
      return {product: {...product, imageUrl: productImage(product)}, signals: (await this.adapter.signals([productId]))[0] ?? null, source: catalog.source, policy, pricesIncluded: false};
    }
    if (tool === "create_request") {
      const { items, idempotencyKey, deadline, deliveryMode, budgetCents, budgetMode, ...single } = createRequestSchema.parse(raw);
      const lines = items ?? [itemInputSchema.parse(single)];
      const order = {
        ...(deadline !== undefined && { deadline, deliveryMode: deliveryMode ?? "by" as const }),
        ...(budgetCents !== undefined && { budgetCents }),
        ...(budgetMode === "preferred" && { budgetMode }),
      };
      const replayKey = idempotencyKey ? `external:create_request:${idempotencyKey}` : retryKey;
      const runId = replayKey
        ? `run_${hash(`${actor.accountId}:${replayKey}`).slice(0, 32)}`
        : id("run");
      const fingerprint = replayKey
        ? hash(JSON.stringify({ ...order, itemLayout: items ? "array" : "flat", lines }))
        : null;
      const replay = async () => {
        const existing = await this.db.one<{ creation_fingerprint: string | null }>(
          "SELECT creation_fingerprint FROM trade_runs WHERE id=$1 AND account_id=$2",
          [runId, actor.accountId],
        );
        if (!existing) return null;
        const legacyInternalRetry = !idempotencyKey && retryKey && existing.creation_fingerprint === null;
        if (!legacyInternalRetry && (!fingerprint || existing.creation_fingerprint !== fingerprint))
          throw new TradeError(409, "idempotency_conflict", "This request key already belongs to different inputs.");
        return { runId, ...(await this.visibleRun(actor, runId)) };
      };
      if (replayKey) {
        const existing = await replay();
        if (existing) return existing;
      }
      if (pastHardDeadline(order))
        throw new TradeError(
          400,
          "past_deadline",
          "Delivery deadline must be in the future",
        );
      const requested = await Promise.all(lines.map(item => this.requestedItem(item, policy)));
      const needs = items
        ? {
          ...order,
          items: requested.map((item, index) => ({ ...item, itemId: `item_${index + 1}` })),
        }
        : { ...order, ...requested[0] };
      const created = await this.db.one(
        "INSERT INTO trade_runs(id,account_id,actor_id,source,title,requirements,creation_fingerprint) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO NOTHING RETURNING id",
        [
          runId,
          actor.accountId,
          actor.actorId,
          actor.source,
          this.requestTitle(needs),
          JSON.stringify(needs),
          fingerprint,
        ],
      );
      if (!created) return requireValue(await replay());
      return { runId, ...(await this.visibleRun(actor, runId)) };
    }
    const { runId } = runIdSchema.passthrough().parse(raw);
    const run = await this.run(actor, runId);
    if (tool === "get_request_status") return this.visibleRun(actor, runId);
    if (tool === "place_order") {
      const order = toolSchemas.place_order.parse(raw);
      if (order.mode === "rehearsal") return this.rehearseOrder(actor, order);
      this.requireOrderAuthorization(run, order.revision, policy);
      throw new TradeError(
        501,
        "supplier_checkout_unavailable",
        "Valio's supplied interface currently documents lookup only. This draft has NOT been sent to the supplier and no order has been placed.",
      );
    }
    if (["cancelled", "rejected"].includes(run.status))
      throw new TradeError(409, "request_closed", "This request is closed");
    if (run.status === "completed" && tool !== "search_products")
      throw new TradeError(409, "request_closed", "This request is complete. Create a new request to make changes.");
    const stored = needSchema.parse(run.requirements);
    if (tool === "update_request_preferences") {
      const patch = toolSchemas.update_request_preferences.parse(raw);
      if (patch.revision !== run.revision)
        throw new TradeError(409, "stale_revision", "Request changed before the edit. Refresh it and try again.");
      const { deadline, deliveryMode, budgetCents, budgetMode, ...lines } = stored;
      const nextDeadline = patch.deadline === null ? undefined : patch.deadline ?? deadline;
      const nextBudget = patch.budgetCents === null ? undefined : patch.budgetCents ?? budgetCents;
      if (nextDeadline === undefined && patch.deliveryMode !== undefined)
        throw new TradeError(400, "invalid_preferences", "Provide a deadline when setting a delivery mode.");
      if (nextBudget === undefined && patch.budgetMode !== undefined)
        throw new TradeError(400, "invalid_preferences", "Provide budgetCents when setting a budget mode.");
      const nextDeliveryMode = nextDeadline !== undefined
        ? patch.deliveryMode ?? deliveryMode ?? (patch.deadline === undefined ? undefined : "by") : undefined;
      const nextBudgetMode = nextBudget !== undefined ? patch.budgetMode ?? budgetMode : undefined;
      const updated = {
        ...lines,
        ...(nextDeadline !== undefined && { deadline: nextDeadline }),
        ...(nextDeliveryMode !== undefined && { deliveryMode: nextDeliveryMode }),
        ...(nextBudget !== undefined && { budgetCents: nextBudget }),
        ...(nextBudgetMode === "preferred" && { budgetMode: nextBudgetMode }),
      };
      if (pastHardDeadline(updated))
        throw new TradeError(400, "past_deadline", "Move or clear the expired delivery deadline, or make it a preferred date.");
      if (isDeepStrictEqual(updated, stored)) return this.visibleRun(actor, runId);
      return this.reviseRequest(actor, runId, patch.revision, updated, relaxedConstraintChanges(stored, updated));
    }
    const needs = this.enforcePolicy(stored, policy);
    if (pastHardDeadline(needs))
      throw new TradeError(
        409,
        "past_deadline",
        "Delivery deadline has passed",
      );
    if (tool === "amend_request") {
      const { itemId, item, revision } = toolSchemas.amend_request.parse(raw);
      if (run.revision !== revision)
        throw new TradeError(409, "stale_revision", "Request changed before the edit. Refresh it and try again.");
      const previous = "items" in needs ? needs.items.find(line => line.itemId === itemId) : itemId ? undefined : needs;
      if (!previous)
        throw new TradeError(400, "invalid_amend_item", "Choose a line from this request to edit.");
      const replacement = await this.requestedItem({
        ...item,
        requirements: [...new Set([...previous.requirements, ...(item.requirements ?? [])])],
        freeFromAllergen: [...new Set([...previous.freeFromAllergen, ...(item.freeFromAllergen ?? [])])],
      }, policy);
      const updated = "items" in needs
        ? { ...needs, items: needs.items.map(line => line.itemId === itemId ? { ...replacement, itemId: line.itemId } : line) }
        : { ...needs, ...replacement, productId: replacement.productId };
      if (isDeepStrictEqual(updated, stored)) return this.visibleRun(actor, runId);
      const changesProduct = previous.productId !== replacement.productId
        || (!replacement.productId && previous.query !== replacement.query);
      const changesQuantity = previous.quantity !== replacement.quantity || previous.unit !== replacement.unit;
      const change: RequestChangeDetails | undefined = changesProduct || changesQuantity ? {
        kind: "item_changed",
        before: changeItemSchema.parse(previous),
        after: changeItemSchema.parse({ ...replacement, itemId }),
      } : undefined;
      return this.reviseRequest(actor, runId, revision, updated, change);
    }
    if (tool === "remove_request_items") {
      const { itemIds, revision } = toolSchemas.remove_request_items.parse(raw);
      if (run.revision !== revision)
        throw new TradeError(409, "stale_revision", "Request changed before the edit. Refresh it and try again.");
      const ids = new Set(itemIds);
      if (!("items" in needs) || ids.size !== itemIds.length || ids.size >= needs.items.length)
        throw new TradeError(400, "invalid_remove_items", "Choose distinct lines from an items-array request and keep at least one item.");
      const excluded = needs.items.filter(line => ids.has(line.itemId));
      if (excluded.length !== itemIds.length)
        throw new TradeError(400, "invalid_remove_items", "Choose only current item IDs from this request.");
      return this.reviseRequest(actor, runId, revision, {
        ...needs,
        items: needs.items.filter(line => !ids.has(line.itemId)),
        excludedItems: [...(needs.excludedItems ?? []), ...excluded],
      }, { kind: "items_removed", items: excluded.map(item => changeItemSchema.parse(item)) });
    }
    if (tool === "search_products") {
      const { query, itemId } = toolSchemas.search_products.parse(raw);
      const item = "items" in needs
        ? needs.items.find(line => line.itemId === itemId)
        : itemId ? undefined : needs;
      if (!item)
        throw new TradeError(
          400,
          "invalid_search_item",
          "Provide an itemId from this items-array request, or omit itemId for a flat request.",
        );
      const products = await this.adapter.shortlist({
        ...(item.productId && !query ? { productIds: [item.productId] } : { query: query ?? item.query }),
        requiredClaims: requirementClaims(item.requirements),
        freeFromAllergens: item.freeFromAllergen,
        limit: 12,
      });
      return {
        products: products.map(({ product, source }) => ({
          id: product.id,
          name: product.displayName,
          salesUnit: product.salesUnit,
          source,
        })),
        ...(itemId ? { itemId } : {}),
        requirements: item.requirements,
        freeFromAllergen: item.freeFromAllergen,
      };
    }
    if (tool === "compare_products") {
      const { revision } = toolSchemas.compare_products.parse(raw);
      if (revision !== undefined && revision !== run.revision)
        throw new TradeError(409, "stale_revision", "Request changed; refresh its state");
      const at = new Date();
      const requestFor = (item: ItemNeed): SupplierRequest => ({
        ...item,
        id: runId,
        deadline: needs.deadline,
        deliveryMode: needs.deliveryMode,
        budgetCents: needs.budgetCents,
        budgetMode: needs.budgetMode,
        createdAt: at.toISOString(),
        quantityLiters: item.unit === "L" ? item.quantity : null,
        diet: item.requirements.includes("lactose-free") ? "lactose-free" : "none",
      });
      const staggeredDelivery = "items" in needs && needs.items.length > 1;
      const requireDeliveryDate = staggeredDelivery || needs.deliveryMode !== undefined || needs.deadline === undefined;
      const compareItem = (item: ItemNeed) => compareSupplierRequest(
        requestFor(item), id("observation"), run.revision + 1, this.adapter, at, account.customer_id,
      );
      let comparison: NonNullable<Run["comparison"]>;
      try {
        if ("items" in needs) {
          const proposals = staggeredDelivery
            ? await compareSupplierRequests(
              needs.items.map(item => ({ request: requestFor(item), proposalId: id("observation") })),
              run.revision + 1, this.adapter, at, account.customer_id,
            )
            : [await compareItem(needs.items[0])];
          const items = needs.items.map((item, index) => ({ ...proposals[index], itemId: item.itemId }));
          comparison = { items, ...(requireDeliveryDate && { basketPlan: basketPlanFor(items, needs) }) };
        } else {
          comparison = await compareItem(needs);
        }
      } catch {
        throw new TradeError(
          502,
          "supplier_lookup_failed",
          "Official price/availability lookup failed. No substitute data was used.",
        );
      }
      const ready = "items" in comparison && comparison.basketPlan
        ? comparison.basketPlan.status === "feasible"
        : ("items" in comparison ? comparison.items : [comparison]).every(item =>
          (item.deliveryOffers ?? item.observations)?.some(product => evidenceBlockers(product, requireDeliveryDate).length === 0));
      const changed = await this.db.one(
        "UPDATE trade_runs SET comparison=$1,requirements=$2,revision=revision+1,approved_revision=NULL,draft=NULL,status=$6,updated_at=now() WHERE id=$3 AND account_id=$4 AND revision=$5 AND status NOT IN ('cancelled','rejected','completed') RETURNING id",
        [
          JSON.stringify(comparison),
          JSON.stringify(needs),
          runId,
          actor.accountId,
          run.revision,
          ready ? "active" : "needs_attention",
        ],
      );
      if (!changed)
        throw new TradeError(
          409,
          "stale_revision",
          "Request changed during lookup; refresh its state",
        );
      return this.visibleRun(actor, runId);
    }
    if (tool === "prepare_order") {
      const { productId, availableDate, selections, revision } = toolSchemas.prepare_order.parse(raw);
      const comparison = run.comparison;
      if (revision !== run.revision || !comparison)
        throw new TradeError(
          409,
          "stale_evidence",
          "Refresh prices and availability before preparing this order",
        );
      if (!isDeepStrictEqual(needs, run.requirements))
        throw new TradeError(
          409,
          "policy_changed",
          "Account requirements changed; compare again",
        );
      let draft: Draft;
      if ("items" in comparison) {
        const selectedByItem = new Map(selections?.map(selected => [selected.itemId, selected]));
        if (selections?.length !== comparison.items.length || selectedByItem.size !== comparison.items.length ||
          comparison.items.some(item => !selectedByItem.has(item.itemId)))
          throw new TradeError(400, "invalid_selections", "Select exactly one product for every current item. If the buyer confirms an omission, remove that line and compare again before drafting.");
        const inferredPlan = selections.some(selection => !selection.availableDate) && comparison.basketPlan
          ? basketPlanFor(comparison.items, needs, selectedByItem) : undefined;
        const inferredDates = inferredPlan?.status === "feasible"
          ? new Map(inferredPlan.selections.map(selection => [selection.itemId, selection.availableDate])) : undefined;
        const stockByProductAndDate = new Map<string, StockUse>();
        const items = comparison.items.map(item => {
          const selected = selectedByItem.get(item.itemId)!;
          const date = selected.availableDate ?? inferredDates?.get(item.itemId);
          const { line, availableSellUnits } = selectDraftLine(
            item, selected.productId, comparison.items.length > 1 || item.deliveryOffers !== undefined, date,
          );
          const stockKey = deliveryStockKey(selected.productId, line.availableDate);
          // Repeated selections for the same SKU and day share the observed stock.
          const stock = combinedStock(stockByProductAndDate.get(stockKey), line.salesUnits, availableSellUnits ?? 0);
          if (!stock)
            throw new TradeError(409, "insufficient_combined_stock", `Reported stock cannot cover all selected quantities for ${line.name}.`);
          stockByProductAndDate.set(stockKey, stock);
          return { itemId: item.itemId, ...line };
        });
        const totalCents = items.reduce((total, item) => total + item.totalCents, 0);
        if (!Number.isSafeInteger(totalCents))
          throw new TradeError(409, "invalid_order_total", "The selected products exceed the maximum supported order total.");
        draft = {
          items,
          totalCents,
          observedAt: items[0].observedAt,
          caveats: [...new Set(items.flatMap(item => item.caveats))],
          policy,
        };
      } else {
        if (!productId)
          throw new TradeError(400, "invalid_selections", "Provide productId for this single-item request.");
        draft = { ...selectDraftLine(comparison, productId, comparison.deliveryOffers !== undefined, availableDate).line, policy };
      }
      const cap = hardBudgetFor(needs);
      if (cap !== undefined && draft.totalCents > cap)
        throw new TradeError(409, "over_budget", `Selected products total ${draft.totalCents} cents, above the ${cap} cent order budget.`);
      if (needs.budgetMode === "preferred" && needs.budgetCents !== undefined && draft.totalCents > needs.budgetCents &&
        !draft.caveats.includes(overBudgetPreference))
        draft.caveats = [...draft.caveats, overBudgetPreference];
      const needsApproval = draftRequiresApproval(run, draft, policy);
      const changed = await this.db.transaction(async tx => {
        const current = requireValue(await this.db.one(
          "SELECT policy FROM trade_accounts WHERE id=$1 FOR SHARE", [actor.accountId], tx,
        ));
        if (!isDeepStrictEqual(policy, policySchema.parse(current.policy)))
          throw new TradeError(409, "policy_changed", "Account requirements changed; compare again");
        return this.db.one(
          "UPDATE trade_runs SET draft=$1,revision=revision+1,approved_revision=NULL,status=$2,updated_at=now() WHERE id=$3 AND account_id=$4 AND revision=$5 AND status NOT IN ('cancelled','rejected','completed') RETURNING id",
          [JSON.stringify(draft), needsApproval ? "awaiting_approval" : "ready", runId, actor.accountId, revision],
          tx,
        );
      });
      if (!changed)
        throw new TradeError(
          409,
          "stale_revision",
          "Request changed; refresh its state",
        );
      return this.visibleRun(actor, runId);
    }
    throw new TradeError(400, "unknown_tool", "Unknown purchasing tool");
  }
  private requireOrderAuthorization(run: Run, revision: number, policy: z.infer<typeof policySchema>) {
    if (["cancelled", "rejected", "completed"].includes(run.status))
      throw new TradeError(409, "request_closed", "This request is closed");
    if (pastHardDeadline(run.requirements))
      throw new TradeError(409, "past_deadline", "The delivery deadline has passed.");
    if (!run.draft || revision !== run.revision)
      throw new TradeError(
        409,
        "stale_revision",
        "Prepare a current purchase draft first",
      );
    if (!["approved", "ready"].includes(run.status))
      throw new TradeError(
        409,
        "approval_required",
        "Human approval is required for this exact draft",
      );
    if (!isDeepStrictEqual(run.draft.policy, policy))
      throw new TradeError(
        409,
        "policy_changed",
        "Account policy changed; prepare a new draft",
      );
    const needsApproval = draftRequiresApproval(run, run.draft, policy);
    if ((needsApproval || run.status === "approved") && run.approved_revision !== run.revision)
      throw new TradeError(
        409,
        "approval_required",
        "Approval does not match the current version",
      );
    return run.draft;
  }
  private async rehearseOrder(actor: Actor, { runId, revision, idempotencyKey }: z.infer<typeof toolSchemas.place_order>) {
    if (!this.orderRehearsalAvailable)
      throw new TradeError(501, "order_rehearsal_unavailable", "Order rehearsal is disabled for this workspace.");
    const keyHash = hash(idempotencyKey);
    try {
      return await this.db.transaction(async tx => {
        // Match the lock order used by policy updates and human approvals.
        const current = requireValue(await this.db.one(
          "SELECT policy FROM trade_accounts WHERE id=$1 FOR SHARE", [actor.accountId], tx,
        ));
        const run = requireValue(await this.db.one<Run>(
          "SELECT * FROM trade_runs WHERE id=$1 AND account_id=$2 FOR UPDATE", [runId, actor.accountId], tx,
        ));
        if (run.receipt) {
          if (run.rehearsal_key_hash === keyHash && run.receipt.revision === revision)
            return { runId, status: "completed", receipt: run.receipt };
          if (run.rehearsal_key_hash === keyHash)
            throw new TradeError(409, "idempotency_conflict", "Use the same revision when retrying a rehearsal.");
          throw new TradeError(409, "request_closed", "This request already has a rehearsal receipt.");
        }
        const policy = policySchema.parse(current.policy);
        const draft = this.requireOrderAuthorization(run, revision, policy);
        const problem = draftProblem(run, draft, policy);
        if (problem) throw new TradeError(409, problem.code, problem.message);
        const receipt: OrderRehearsalReceipt = {
          receiptId: id("rehearsal"),
          kind: "order_rehearsal",
          submittedToSupplier: false,
          revision,
          totalCents: draft.totalCents,
          currency: "EUR",
          moneyBasis: "VAT_EXCLUSIVE",
          createdAt: new Date().toISOString(),
          authorization: run.status === "approved" ? "buyer_approval" : "account_policy",
        };
        await this.db.rows(
          "UPDATE trade_runs SET receipt=$1,rehearsal_key_hash=$2,status='completed',updated_at=now() WHERE id=$3",
          [JSON.stringify(receipt), keyHash, runId], tx,
        );
        await this.db.event(actor, runId, "order_rehearsal", "completed", receipt, tx);
        return { runId, status: "completed", receipt };
      });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "23505" &&
        "constraint" in error && error.constraint === "trade_runs_rehearsal_key")
        throw new TradeError(409, "idempotency_conflict", "That rehearsal key was already used for another request.");
      throw error;
    }
  }
  private async reviseRequest(actor: Actor, runId: string, revision: number, updated: Need, change?: RequestChangeDetails) {
    const changes: RequestChange[] = actor.source !== "web" && change
      ? [{ ...change, revision: revision + 1, actorSource: actor.source, actorId: actor.actorId }]
      : [];
    const changed = await this.db.one(
      "UPDATE trade_runs SET requirements=$1,title=$2,request_changes=request_changes || $6::jsonb,revision=revision+1,comparison=NULL,draft=NULL,approved_revision=NULL,status='active',updated_at=now() WHERE id=$3 AND account_id=$4 AND revision=$5 AND status NOT IN ('cancelled','rejected','completed') RETURNING id",
      [JSON.stringify(updated), this.requestTitle(updated), runId, actor.accountId, revision, JSON.stringify(changes)],
    );
    if (!changed)
      throw new TradeError(409, "stale_revision", "Request changed before the edit. Refresh it and try again.");
    return this.visibleRun(actor, runId);
  }
  private enforceItem<T extends ItemNeed>(
    item: T, policy: z.infer<typeof policySchema>, suppliedQuery = item.productId ? undefined : item.query,
  ) {
    return {
      ...item,
      requirements: requestedProductRequirements(
        "none",
        [...item.requirements, ...policy.requiredClaims],
        suppliedQuery,
      ),
      freeFromAllergen: [
        ...new Set([...item.freeFromAllergen, ...policy.freeFromAllergens]),
      ].sort(),
    };
  }
  private enforcePolicy(input: Need, policy: z.infer<typeof policySchema>): Need {
    return "items" in input
      ? { ...input, items: input.items.map(item => this.enforceItem(item, policy)) }
      : this.enforceItem(input, policy);
  }
  private async requestedItem(input: ItemInput, policy: z.infer<typeof policySchema>): Promise<ItemNeed> {
    const { productId, quantity, unit } = input;
    if ((unit === "case" || unit === "each" || unit === "sales_unit") && !Number.isInteger(quantity))
      throw new TradeError(400, "invalid_quantity", "Cases, items and supplier sales units require whole quantities.");
    const product = productId ? (await this.adapter.loadCatalog()).products.get(productId) : undefined;
    if (productId && !product)
      throw new TradeError(400, "product_not_found", "The selected product was not found in the catalog.");
    const item = this.enforceItem(storedItemSchema.parse({
      ...input,
      query: input.query ?? (product?.displayName.trim().slice(0, 120) || productId),
    }), policy, input.query);
    if (product && (claimGate(product, requirementClaims(item.requirements)) !== undefined
      || item.freeFromAllergen.some(allergen => !hasExplicitAllergenAbsence(product, allergen))))
      throw new TradeError(400, "product_requirements_mismatch", "The catalog does not verify the selected product against this request's requirements.");
    if (unit === "sales_unit" && product && requiredSalesUnits(quantity, unit, product) === null)
      throw new TradeError(400, "invalid_sales_lot", "The quantity must match the supplier's sales lot for this product.");
    return item;
  }
  private requestTitle(needs: Need) {
    const items = "items" in needs ? needs.items : [needs];
    return items.map(({ quantity, unit, query }) => unit === "sales_unit"
      ? `${quantity} ${quantity === 1 ? "sales unit" : "sales units"} of ${query}`
      : `${quantity} ${unit} ${query}`,
    ).join(", ");
  }
  async decide(
    actor: Actor,
    runId: string,
    revision: number,
    approve: boolean,
  ) {
    if (actor.source !== "web")
      throw new TradeError(
        403,
        "human_required",
        "Only the signed-in buyer can approve",
      );
    await this.db.transaction(async (tx) => {
      // Use the same account-before-request lock order as policy changes.
      const currentPolicy = approve ? policySchema.parse(requireValue(await this.db.one(
        "SELECT policy FROM trade_accounts WHERE id=$1 FOR SHARE", [actor.accountId], tx,
      )).policy) : undefined;
      const run = requireValue(
        await this.db.one<Run>(
          "SELECT * FROM trade_runs WHERE id=$1 AND account_id=$2 FOR UPDATE",
          [runId, actor.accountId],
          tx,
        ),
      );
      if (
        run.revision !== revision ||
        !run.draft ||
        run.status !== "awaiting_approval"
      )
        throw new TradeError(
          409,
          "stale_revision",
          "This approval request changed",
        );
      if (currentPolicy) {
        const problem = draftProblem(run, run.draft, currentPolicy);
        if (problem) throw new TradeError(409, problem.code, problem.message);
      }
      const status = approve ? "approved" : "rejected";
      await this.db.rows(
        "UPDATE trade_runs SET status=$1,approved_revision=$2,updated_at=now() WHERE id=$3",
        [status, approve ? revision : null, runId],
        tx,
      );
      await this.db.event(
        actor,
        runId,
        approve ? "human_approval" : "human_rejection",
        "completed",
        { revision, totalCents: run.draft.totalCents },
        tx,
      );
    });
    return this.visibleRun(actor, runId);
  }
}
