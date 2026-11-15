import type { Offer, ProposalRecord, RequestRecord } from "./types.js";
import { httpError } from "../http-error.js";

const ORIGINAL_CAP_L = 200;
const REPLACEMENT_CAP_L = 800;
const ORIGINAL_CENTS_PER_LITER = 120;
const REPLACEMENT_CENTS_PER_LITER = 128;

export function buildOffers(
  quantityLiters: number,
  diet: string,
  replacementCentsPerLiter = REPLACEMENT_CENTS_PER_LITER,
): Offer[] {
  const originalQty = Math.min(ORIGINAL_CAP_L, quantityLiters);
  const remainingAfterOriginal = Math.max(0, quantityLiters - originalQty);
  const replacementQty = Math.min(REPLACEMENT_CAP_L, remainingAfterOriginal);
  const lactoseFree = diet.toLowerCase().includes("lactose");

  const original: Offer = {
    id: "offer_original",
    name: "Synthetic original lactose-free milk (fixture)",
    quantityLiters: originalQty,
    priceCents: originalQty * ORIGINAL_CENTS_PER_LITER,
    eligible: originalQty > 0,
    reason: originalQty < quantityLiters ? "STOCK_SHORT" : null,
    reliability: 0.92,
    carbon: 1.1,
    source: "fixture",
  };

  const replacement: Offer = {
    id: "offer_replacement",
    name: "Synthetic replacement lactose-free milk (fixture)",
    quantityLiters: replacementQty,
    priceCents: replacementQty * replacementCentsPerLiter,
    eligible: replacementQty > 0 && lactoseFree,
    reason: lactoseFree ? "SUBSTITUTION_WITH_APPROVAL" : "CLAIM_NOT_MET",
    reliability: 0.88,
    carbon: 1.2,
    source: "fixture",
  };

  const rejected: Offer = {
    id: "offer_rejected",
    name: "Synthetic cheaper milk without lactose-free evidence",
    quantityLiters: quantityLiters,
    priceCents: quantityLiters * 100,
    eligible: false,
    reason: "CLAIM_NOT_MET",
    reliability: 0.7,
    carbon: 1.4,
    source: "fixture",
  };

  return [original, replacement, rejected];
}

export function evaluateBasket(offers: Offer[], quantityLiters: number, budgetCents: number) {
  const selected = offers.filter((o) => o.eligible && o.id !== "offer_rejected");
  const covered = selected.reduce((sum, o) => sum + o.quantityLiters, 0);
  const totalCents = selected.reduce((sum, o) => sum + o.priceCents, 0);
  const uncoveredLiters = Math.max(0, quantityLiters - covered);
  const overBudget = totalCents > budgetCents;
  const status = overBudget
    ? "blocked"
    : uncoveredLiters > 0
      ? "partial"
      : "proposed";
  return { totalCents, uncoveredLiters, status };
}

export function compareRequest(request: RequestRecord, proposalId: string, version: number, replacementCentsPerLiter?: number): ProposalRecord {
  if (request.unit !== "L" || request.quantityLiters === null || request.diet !== "lactose-free") {
    throw httpError(409, "Create a new simulator request for whole litres of lactose-free milk");
  }
  const offers = buildOffers(request.quantityLiters, request.diet, replacementCentsPerLiter);
  const { totalCents, uncoveredLiters, status } = evaluateBasket(
    offers,
    request.quantityLiters,
    request.budgetCents,
  );
  return {
    id: proposalId,
    requestId: request.id,
    version,
    offers,
    totalCents,
    uncoveredLiters,
    status,
    approvedVersion: null,
  };
}

export function replacementUnitPrice(proposal: ProposalRecord): number {
  const replacement = proposal.offers.find((o) => o.id === "offer_replacement");
  if (!replacement || replacement.quantityLiters === 0) return REPLACEMENT_CENTS_PER_LITER;
  return Math.round(replacement.priceCents / replacement.quantityLiters);
}

export function applyPriceChange(proposal: ProposalRecord, request: RequestRecord): ProposalRecord {
  const nextPrice = replacementUnitPrice(proposal) + 8;
  const next = compareRequest(request, proposal.id, proposal.version + 1, nextPrice);
  next.approvedVersion = null;
  return next;
}
