import { calendarDateInHelsinki } from "@cosign/adapters";
import { supplierBlockers } from "./supplier-decision.js";
import type { ConnectedRehearsal, ProposalRecord, RequestRecord, SupplierObservation } from "./types.js";

const unusableEvidence = new Set(["UNIT_MISMATCH", "CUTOFF_UNVERIFIED", "EMPTY_SCHEDULE"]);

function eligibleObservation(product: SupplierObservation, request: RequestRecord, now: Date) {
  const { closingTime, availableDate, estimate, salesUnitPriceCents, issues } = product;
  const cutoff = closingTime ? Date.parse(closingTime) : NaN;
  return Number.isFinite(cutoff) && cutoff > now.getTime()
    && availableDate === calendarDateInHelsinki(new Date(request.deadline))
    && supplierBlockers(product).length === 0
    && !issues.some((issue) => unusableEvidence.has(issue))
    && estimate?.budgetFit === "within_budget"
    && salesUnitPriceCents !== null && Number.isSafeInteger(salesUnitPriceCents) && salesUnitPriceCents >= 0
    && estimate.totalCents !== null && Number.isSafeInteger(estimate.totalCents)
    && estimate.totalCents >= 0 && estimate.totalCents <= request.budgetCents
    && estimate.unit === request.unit && estimate.quantity !== undefined && Number.isFinite(estimate.quantity)
    && estimate.quantity >= request.quantity && Number.isFinite(estimate.salesUnits) && estimate.salesUnits > 0;
}

export function rehearsalCandidates(comparison: ProposalRecord, request: RequestRecord, now: Date) {
  if (comparison.comparisonMode !== "supplier_observations" || !comparison.observedAt || Date.parse(request.deadline) <= now.getTime()) return [];
  return (comparison.observations ?? []).filter((product) => eligibleObservation(product, request, now)).map(({ productId }) => productId);
}

export function buildRehearsalEvidence(
  comparison: ProposalRecord,
  request: RequestRecord,
  productId: string,
  now: Date,
): { evidence: ConnectedRehearsal; totalCents: number } | undefined {
  if (!rehearsalCandidates(comparison, request, now).includes(productId)) return;
  const product = comparison.observations?.find((item) => item.productId === productId);
  if (!product?.closingTime || !comparison.observedAt || product.salesUnitPriceCents == null
    || !product.estimate || product.estimate.quantity === undefined || product.estimate.totalCents === null) return;
  const caveats = new Set(product.issues);
  if (product.estimate.stockFit === "unverified") caveats.add("STOCK_UNKNOWN");
  return {
    evidence: {
      productId, name: product.name, quantity: product.estimate.quantity, requestedQuantity: request.quantity,
      requestedDeadline: request.deadline,
      unit: request.unit, salesUnits: product.estimate.salesUnits, salesUnit: product.salesUnit,
      salesUnitPriceCents: product.salesUnitPriceCents, supplierComparisonId: comparison.id,
      supplierComparisonVersion: comparison.version, observedAt: comparison.observedAt, closingTime: product.closingTime,
      caveats: [...caveats],
    },
    totalCents: product.estimate.totalCents,
  };
}
