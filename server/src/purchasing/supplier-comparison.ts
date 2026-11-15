import {
  calendarDateInHelsinki, claimGate, hasExplicitAllergenAbsence, requirementClaims, UNKNOWN_STOCK_SENTINEL,
  type AvailabilityObservation, type CatalogAdapter, type CatalogProduct, type LookupResult, type ProductSignals, type ShortlistItem,
} from "@cosign/adapters";
import type { DecisionEvent, ProposalRecord, SupplierObservation, SupplierRequest } from "./types.js";
import { packAmountInUnit, packQuantity, requiredSalesUnits, salesUnitIncrement, stockLimitedSalesUnits, supplierCostIssues, supplierUnitPriceCents } from "./quantity.js";
import { requestedProductRequirements } from "./requirements.js";
import { supplierDecision } from "./supplier-decision.js";

// Reviewed lactose-free SKUs for the connected Monday milk preset.
const mondayMilkIds = ["463038", "464179", "465039", "464398"];
const comparisonLimit = 12;
const deliveryDateLimit = 10;
const parallelDeliveryDates = 3;

function prioritizeEstimable(matches: ShortlistItem[], request: SupplierRequest): ShortlistItem[] {
  const estimable: ShortlistItem[] = [];
  const unmapped: ShortlistItem[] = [];
  for (const item of matches) {
    const target = requiredSalesUnits(request.quantity, request.unit, item.product) === null ? unmapped : estimable;
    target.push(item);
  }
  return [...estimable, ...unmapped].slice(0, comparisonLimit);
}

function estimateRequirement(
  request: SupplierRequest,
  amountPerSalesUnit: number,
  salesUnits: number,
  priceCents: number | null,
  stock: number | null,
  costIssues: ReturnType<typeof supplierCostIssues>,
): NonNullable<SupplierObservation["estimate"]> {
  const amount = Number((salesUnits * amountPerSalesUnit).toPrecision(15));
  const total = priceCents === null ? null : Math.round(salesUnits * priceCents);
  const totalCents = Number.isSafeInteger(total) ? total : null;
  const variableWeight = costIssues.includes("VARIABLE_WEIGHT");
  return {
    salesUnits,
    quantity: packAmountInUnit(amount, request.unit),
    unit: request.unit,
    ...(request.unit === "L" || request.unit === "ml" ? { liters: amount / 1000 } : {}),
    totalCents,
    budgetFit: totalCents === null || variableWeight ? "unknown"
      : request.budgetCents !== undefined && totalCents > request.budgetCents
        ? request.budgetMode === "preferred" ? "above_budget_preference" : "over_budget"
        : costIssues.length ? "unknown" : request.budgetCents === undefined ? "no_budget_limit" : "within_budget",
    stockFit: stock === null || variableWeight ? "unverified" : stock >= salesUnits ? "reported_sufficient" : "reported_insufficient",
  };
}

function observedCoverage(
  request: SupplierRequest,
  requestedDate: string,
  product: CatalogProduct,
  stock: AvailabilityObservation | undefined,
  pack: ReturnType<typeof packQuantity>,
  requiredUnits: number | null,
  priceCents: number | null,
): SupplierObservation["observedCoverage"] {
  if (!stock || stock.stockUnknown || stock.salesBlock || stock.scheduleSalesBlock || stock.cutoffPassed
    || stock.availableSellUnits == null || stock.availableSellUnits >= UNKNOWN_STOCK_SENTINEL
    || stock.availableDate !== requestedDate || stock.salesUnit !== product.salesUnit
    || !pack || requiredUnits === null || product.details?.variableWeight) return;
  const zeroStock = stock.availableSellUnits === 0 && stock.errors.length === 1 && stock.errors[0].code === "STOCK_SHORT";
  if (!stock.usable && !zeroStock) return;

  const increment = salesUnitIncrement(product);
  const availableUnits = stockLimitedSalesUnits(stock.availableSellUnits, product);
  if (increment === null || availableUnits === null) return;
  const salesUnits = Math.min(requiredUnits, availableUnits);
  const quantity = Number(packAmountInUnit(salesUnits * pack.amount, request.unit).toPrecision(15));
  if (!Number.isFinite(quantity)) return;
  // If the full rounded-up order is available, its coverage is the request amount.
  const coveredQuantity = salesUnits === requiredUnits ? request.quantity : Math.min(quantity, request.quantity);
  const difference = request.quantity - coveredQuantity;
  // Remove floating point noise in the residual while preserving a positive shortfall.
  const uncoveredQuantity = Number(difference.toFixed(9)) || difference;
  const subtotal = priceCents === null || product.details?.deposits.length ? null : Math.round(salesUnits * priceCents);
  return {
    salesUnits,
    salesUnitIncrement: increment,
    quantity,
    coveredQuantity,
    uncoveredQuantity,
    unit: request.unit,
    productSubtotalCents: Number.isSafeInteger(subtotal) ? subtotal : null,
    guaranteed: false,
  };
}

async function supplierShortlist(request: SupplierRequest, adapter: CatalogAdapter) {
  const requiredClaims = requirementClaims(requestedProductRequirements(request.diet, request.requirements,
    request.productId || request.preset ? undefined : request.query));
  const freeFromAllergens = request.freeFromAllergen ?? [];
  const found = await adapter.shortlist({
    ...(request.productId ? { productIds: [request.productId] }
      : request.preset === "monday_milk"
      ? { productIds: mondayMilkIds, category: "10400" }
      : { query: request.query ?? "milk" }),
    requiredClaims,
    freeFromAllergens,
    limit: request.productId ? 1 : request.preset === "monday_milk" ? comparisonLimit : 48,
  });
  const matches = found.filter(({ product }) => (!request.productId || product.id === request.productId)
    && claimGate(product, requiredClaims) === undefined
    && freeFromAllergens.every((allergen) => hasExplicitAllergenAbsence(product, allergen)));
  return !request.productId && !request.preset ? prioritizeEstimable(matches, request) : matches.slice(0, comparisonLimit);
}

function requireLookupEvidence(lookups: LookupResult[]) {
  if (lookups.some(lookup => !lookup.errors.length || lookup.prices.length || lookup.availability.length)) return;
  const accessError = lookups.some(({ errors }) => errors.some(({ code }) => code === "AUTH_ERROR" || code === "MISSING_API_KEY"));
  const message = accessError
    ? "Valio lookup requires a current challenge API key. Check the server configuration and refresh the comparison."
    : "Valio lookup could not load prices and availability. Refresh the comparison to retry.";
  throw Object.assign(new Error(message), { statusCode: 502 });
}

function sufficientSchedule(stock: AvailabilityObservation | undefined, units: number | null, observedAt: string) {
  return stock && units !== null && !stock.stockUnknown && !stock.salesBlock && !stock.scheduleSalesBlock
    && !stock.cutoffPassed && Date.parse(stock.closingTime ?? "") > Date.parse(observedAt)
    && stock.availableSellUnits != null && stock.availableSellUnits < UNKNOWN_STOCK_SENTINEL
    && stock.availableSellUnits >= units;
}

type DeliveryWindow = { firstDate: string; targetDate?: string; mode: NonNullable<SupplierRequest["deliveryMode"]> };
export const outsideDeliveryPreference = "OUTSIDE_PREFERRED_DELIVERY_DATE";
export const overBudgetPreference = "OVER_PREFERRED_BUDGET";

function supplierObservation(
  request: SupplierRequest, product: CatalogProduct, lookup: LookupResult, signals: ProductSignals[],
  observedAt: string, window?: DeliveryWindow,
): SupplierObservation {
  const { requestedDate } = lookup;
  const stock = lookup.availability.find(({ productId }) => productId === product.id);
  const sameDate = stock?.availableDate === requestedDate;
  const price = window && stock?.availableDate && !sameDate ? undefined
    : lookup.prices.find(({ productId }) => productId === product.id);
  const signal = signals.find(({ productId }) => productId === product.id);
  const pack = packQuantity(product, request.unit);
  const isVolume = request.unit === "L" || request.unit === "ml";
  const units = requiredSalesUnits(request.quantity, request.unit, product);
  const priceCents = supplierUnitPriceCents(price);
  const costIssues = supplierCostIssues(product);
  const stockUnits = stock?.usable || (stock?.errors.length === 1 && stock.errors[0].code === "STOCK_SHORT")
    ? stock.availableSellUnits ?? null : null;
  const estimate = pack && units !== null ? estimateRequirement(request, pack.amount, units, priceCents, stockUnits, costIssues) : null;
  let deliveryStatus: SupplierObservation["deliveryStatus"];
  let outsidePreference = false;
  if (window) {
    const dateVerified = sameDate && stock?.usable && requestedDate >= window.firstDate
      && !product.details?.variableWeight && sufficientSchedule(stock, units, observedAt);
    const { targetDate, mode } = window;
    outsidePreference = Boolean(dateVerified && targetDate && (
      (mode === "preferred_by" && requestedDate > targetDate) ||
      (mode === "preferred_on" && requestedDate !== targetDate)
    ));
    deliveryStatus = !dateVerified ? "unverified"
      : mode === "by" && targetDate && requestedDate > targetDate ? "after_deadline"
      : requestedDate === targetDate ? "time_unverified"
      : "estimated";
  }
  return {
    productId: product.id,
    name: product.displayName,
    salesUnit: product.salesUnit,
    litersPerSellUnit: isVolume && pack ? pack.amount / 1000 : null,
    packVolumeSource: isVolume ? pack?.source : undefined,
    amountPerSellUnit: pack?.amount ?? null,
    amountUnit: pack?.unit ?? null,
    packAmountSource: pack?.source,
    salesUnitPriceCents: priceCents,
    availableSellUnits: stockUnits,
    stockUnknown: stock?.stockUnknown ?? true,
    closingTime: stock?.closingTime ?? null,
    availableDate: stock?.availableDate ?? null,
    ...(deliveryStatus && { deliveryStatus }),
    reliability: signal?.reliability.present ? signal.reliability.value ?? null : null,
    carbon: signal?.carbonKgCo2ePerKg.present ? signal.carbonKgCo2ePerKg.value ?? null : null,
    observedCoverage: observedCoverage(request, requestedDate, product, stock, pack, units, priceCents),
    estimate,
    issues: [...new Set([
      ...(price?.errors.map(({ code }) => code) ?? []),
      ...(!price && lookup.errors.some(({ endpoint }) => endpoint === "price") ? ["PRICE_LOOKUP_UNAVAILABLE"] : []),
      ...(priceCents === null ? ["PRICE_UNUSABLE"] : []),
      ...(stock?.errors.map(({ code }) => code) ?? ["STOCK_UNKNOWN"]),
      ...(!stock && lookup.errors.some(({ endpoint }) => endpoint === "availability") ? ["AVAILABILITY_LOOKUP_UNAVAILABLE"] : []),
      ...costIssues,
      ...(pack && units === null ? ["PACK_UNMAPPED"] : []),
      ...(!pack ? [isVolume ? "VOLUME_UNMAPPED" : "PACK_UNMAPPED"] : []),
      ...(deliveryStatus === "after_deadline" ? ["DELIVERY_CONFLICT"] : []),
      ...(outsidePreference ? [outsideDeliveryPreference] : []),
      ...(estimate?.budgetFit === "above_budget_preference" ? [overBudgetPreference] : []),
      "DELIVERY_TIME_UNVERIFIED",
    ])],
  };
}

function supplierProposal(
  request: SupplierRequest, proposalId: string, version: number, observedAt: string, observations: SupplierObservation[],
): ProposalRecord {
  const events: DecisionEvent[] = [
    { at: observedAt, action: "supplier_lookup", outcome: "OBSERVED", detail: `${observations.length} catalog-shortlisted products; no supplier commitment` },
  ];
  const ranking = request.rankingObjective && supplierDecision(observations, request.rankingObjective).ranking;
  if (ranking) {
    const { preferred, objective, measuredCount, candidateCount } = ranking;
    events.push({
      at: observedAt, action: "supplier_ranking", outcome: preferred ? "RANKED" : "UNAVAILABLE",
      detail: `${objective} priority: ${measuredCount} of ${candidateCount} comparable candidates had a recorded value`
        + (preferred ? `; first SKU ${preferred.productId}` : ""),
    });
  }
  return {
    id: proposalId,
    requestId: request.id,
    version,
    offers: [],
    // No observed quantity is represented as purchased or guaranteed coverage.
    totalCents: 0,
    uncoveredLiters: request.unit === "L" ? request.quantity : request.unit === "ml" ? request.quantity / 1000 : null,
    uncoveredQuantity: request.quantity,
    uncoveredUnit: request.unit,
    status: observations.length ? "observed" : "no_catalog_match",
    approvedVersion: null,
    comparisonMode: "supplier_observations",
    source: "VALIO_CHALLENGE_API",
    observedAt,
    checkoutSupported: false,
    observations,
    events,
  };
}

/** Keep legacy single-day lookups alongside dated supplier offers. */
export async function compareSupplierRequest(
  request: SupplierRequest, proposalId: string, version: number, adapter: CatalogAdapter, at: Date, customer = "123",
): Promise<ProposalRecord> {
  if (request.deliveryMode || !request.deadline) {
    const [proposal] = await compareSupplierRequests([{ request, proposalId }], version, adapter, at, customer);
    return proposal;
  }
  const shortlist = await supplierShortlist(request, adapter);
  const observedAt = at.toISOString();
  const ids = shortlist.map(({ product }) => product.id);
  const requestedDate = calendarDateInHelsinki(new Date(request.deadline));
  if (!ids.length) return supplierProposal(request, proposalId, version, observedAt, []);

  const [lookup, signals] = await Promise.all([
    adapter.lookup({ customer, requestedDate, productIds: ids, latestDeliveryAt: request.deadline, now: observedAt }),
    adapter.signals(ids),
  ]);
  requireLookupEvidence([lookup]);
  const observations = shortlist.map(({ product }) => supplierObservation(request, product, lookup, signals, observedAt));
  return supplierProposal(request, proposalId, version, observedAt, observations);
}

type ComparisonEntry = { request: SupplierRequest; proposalId: string };
type DateLookup = { productIds: Set<string>; result: LookupResult };

function hasEstimatedDelivery(offer: SupplierObservation) {
  return offer.deliveryStatus === "estimated" || offer.deliveryStatus === "time_unverified";
}

async function searchDeliveryDates(
  ids: string[], eligibleIds: Set<string>, adapter: CatalogAdapter, customer: string,
  observedAt: string, { firstDate, targetDate, mode }: DeliveryWindow,
) {
  const signal = AbortSignal.timeout(15_000);
  const lookups: DateLookup[] = [];
  const checkedByDate = new Map<string, Set<string>>();
  const lookupDate = async (requestedDate: string, productIds: string[]): Promise<DateLookup> => ({
    productIds: new Set(productIds),
    result: await adapter.lookup({ customer, requestedDate, productIds, now: observedAt, signal }),
  });
  const checkDate = (date: string, productIds: string[]) => {
    const checkedIds = checkedByDate.get(date) ?? new Set<string>();
    for (const productId of productIds) checkedIds.add(productId);
    checkedByDate.set(date, checkedIds);
    return lookupDate(date, productIds);
  };
  const canLookup = () => !signal.aborted && !lookups.some(({ result }) => result.errors.some(({ code, httpStatus }) =>
    code === "AUTH_ERROR" || code === "MISSING_API_KEY" || httpStatus === 429));

  lookups.push(await checkDate(mode === "on" && targetDate ? targetDate : firstDate, ids));
  if (mode === "on") {
    requireLookupEvidence(lookups.map(({ result }) => result));
    return lookups;
  }
  // Later prices or capacity may make a valid basket even when every early line fits on its own.
  const nextDate = new Date(firstDate);
  nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  const followupDate = targetDate && firstDate < targetDate ? targetDate
    : targetDate && mode === "by" ? undefined : nextDate.toISOString().slice(0, 10);
  if (followupDate && eligibleIds.size && canLookup()) {
    lookups.push(await checkDate(followupDate, [...eligibleIds]));
  }

  const suggestions = new Map<string, Set<string>>();
  const collectSuggestions = ({ result }: DateLookup) => {
    for (const { productId, availableDate } of result.availability) {
      // A mismatched date can suggest a day to check, but carries no usable stock or cutoff for that day.
      if (!availableDate || availableDate < firstDate || !eligibleIds.has(productId)
        || checkedByDate.get(availableDate)?.has(productId)) continue;
      const productIds = suggestions.get(availableDate) ?? new Set<string>();
      productIds.add(productId);
      suggestions.set(availableDate, productIds);
    }
  };
  lookups.forEach(collectSuggestions);

  let checkedSuggestions = 0;
  while (suggestions.size && checkedSuggestions < deliveryDateLimit && canLookup()) {
    const batch = [...suggestions].sort(([left], [right]) => left.localeCompare(right))
      .slice(0, Math.min(parallelDeliveryDates, deliveryDateLimit - checkedSuggestions));
    const results = await Promise.all(batch.map(([date, productIds]) => {
      suggestions.delete(date);
      return checkDate(date, [...productIds]);
    }));
    checkedSuggestions += batch.length;
    lookups.push(...results);
    results.forEach(collectSuggestions);
  }
  requireLookupEvidence(lookups.map(({ result }) => result));
  return lookups.sort((left, right) => left.result.requestedDate.localeCompare(right.result.requestedDate));
}

/** Compare one batch with shared buyer preferences and independent delivery dates per line. */
export async function compareSupplierRequests(
  entries: ComparisonEntry[], version: number, adapter: CatalogAdapter, at: Date, customer = "123",
): Promise<ProposalRecord[]> {
  if (!entries.length) return [];
  const observedAt = at.toISOString();
  const { deadline, deliveryMode } = entries[0].request;
  const window: DeliveryWindow = {
    firstDate: calendarDateInHelsinki(at),
    targetDate: deadline && calendarDateInHelsinki(new Date(deadline)),
    mode: deliveryMode ?? "by",
  };
  const shortlists = await Promise.all(entries.map(async ({ request, proposalId }) => ({
    request, proposalId, shortlist: await supplierShortlist(request, adapter),
  })));
  const ids = [...new Set(shortlists.flatMap(({ shortlist }) => shortlist.map(({ product }) => product.id)))];
  if (!ids.length) return entries.map(({ request, proposalId }) => ({
    ...supplierProposal(request, proposalId, version, observedAt, []),
    deliveryOffers: [],
  }));

  const eligibleIds = new Set(shortlists.flatMap(({ request, shortlist }) => shortlist.flatMap(({ product }) =>
    requiredSalesUnits(request.quantity, request.unit, product) === null || product.details?.variableWeight ? [] : [product.id])));
  const [lookups, signals] = await Promise.all([
    searchDeliveryDates(ids, eligibleIds, adapter, customer, observedAt, window),
    adapter.signals(ids),
  ]);
  return shortlists.map(({ request, proposalId, shortlist }) => {
    const deliveryOffers: SupplierObservation[] = [];
    const observations = shortlist.map(({ product }) => {
      const options = lookups.filter(({ productIds }) => productIds.has(product.id))
        .map(({ result }) => {
          const evidence = supplierObservation(request, product, result, signals, observedAt, window);
          if (evidence.availableDate === result.requestedDate) deliveryOffers.push(evidence);
          return evidence;
        });
      const datedPrices = options.filter(item => hasEstimatedDelivery(item) && item.estimate?.totalCents != null);
      const withinBudget = (item: SupplierObservation) => item.estimate?.budgetFit !== "over_budget" && item.estimate?.budgetFit !== "above_budget_preference";
      const withinDate = (item: SupplierObservation) => !item.issues.includes(outsideDeliveryPreference);
      return datedPrices.find(item => withinDate(item) && withinBudget(item))
        ?? datedPrices.find(withinBudget)
        ?? datedPrices.find(withinDate)
        ?? datedPrices[0]
        ?? options.find(hasEstimatedDelivery)
        ?? options.find(item => item.deliveryStatus === "after_deadline")
        ?? options.find(item => item.observedCoverage)
        ?? options.find(item => item.availableDate !== null)
        ?? options[0];
    });
    return { ...supplierProposal(request, proposalId, version, observedAt, observations), deliveryOffers };
  });
}
