import { randomUUID } from "node:crypto";
import type { CatalogAdapter } from "@cosign/adapters";
import { httpError } from "../http-error.js";
import { buildRehearsalEvidence } from "./connected-rehearsal.js";
import type { PurchaseRepository } from "./repository.js";
import { applyPriceChange, compareRequest as simulateComparison } from "./simulator.js";
import { compareSupplierRequest } from "./supplier-comparison.js";
import type { OrderRecord, ProposalRecord, RequestRecord } from "./types.js";

function requireCompleteBasket(proposal: ProposalRecord) {
  if (proposal.status === "blocked" || proposal.uncoveredLiters !== 0) {
    throw httpError(409, "Proposal cannot be approved or placed without a complete basket within budget");
  }
  return proposal.uncoveredLiters;
}

export class PurchasingService {
  constructor(
    private readonly store: PurchaseRepository,
    private readonly valio: CatalogAdapter,
    private readonly now: () => Date,
    private readonly simulator: boolean,
  ) {}

  private requireFutureDeadline(deadline: string, statusCode = 409) {
    const instant = Date.parse(deadline);
    if (!Number.isFinite(instant) || instant <= this.now().getTime()) {
      throw httpError(statusCode, "delivery deadline must be a valid future instant");
    }
  }

  private requireSimulatedProposal(proposal: ProposalRecord) {
    if (proposal.comparisonMode === "supplier_observations") {
      throw httpError(409, "Supplier observations are read-only. Create a simulated quote before checkout");
    }
    if (this.simulator ? proposal.connectedRehearsal : !proposal.connectedRehearsal || !proposal.rehearsal) {
      throw httpError(409, "This quote belongs to a different purchasing mode");
    }
  }

  private requireOpenRehearsal(proposal: ProposalRecord) {
    if (proposal.rehearsal && !(Date.parse(proposal.rehearsal.closingTime) > this.now().getTime())) {
      throw httpError(409, "The observed supplier cutoff passed. Refresh the comparison to rehearse another option");
    }
  }

  async create(input: Omit<RequestRecord, "id" | "createdAt" | "createdBy">, createdBy?: string) {
    this.requireFutureDeadline(input.deadline, 400);
    if (input.productId) {
      if (this.simulator || input.preset) throw httpError(400, "An exact catalog product requires a connected request without a preset");
      const product = (await this.valio.loadCatalog()).products.get(input.productId);
      if (!product) throw httpError(400, "Unknown catalog product ID");
      input = { ...input, query: product.displayName.slice(0, 120) };
    }
    if (this.simulator && (input.unit !== "L" || input.quantityLiters === null || input.diet !== "lactose-free")) {
      throw httpError(400, "The simulator supports whole litres of lactose-free milk");
    }
    if (this.simulator && input.rankingObjective) throw httpError(400, "A comparison priority requires a connected request");
    const request = { ...input, id: `req_${randomUUID()}`, createdAt: this.now().toISOString(), createdBy };
    await this.store.transaction((tx) => tx.createRequest(request));
    return request;
  }

  async compare(requestId: string, actorId?: string): Promise<{ proposal: ProposalRecord; request: RequestRecord }> {
    if (this.simulator) {
      return this.store.transaction(async (tx) => {
        const request = await tx.findRequest(requestId);
        if (!request) throw httpError(404, "request not found");
        const existing = await tx.findProposalByRequest(requestId);
        if (existing?.status === "placed") return { proposal: existing, request };
        this.requireFutureDeadline(request.deadline);
        if (existing) return { proposal: existing, request };
        if (request.productId) throw httpError(409, "An exact catalog request requires connected mode");

        const proposal = simulateComparison(request, `prop_${randomUUID()}`, 1);
        await tx.saveProposal(proposal);
        await tx.appendEvents(proposal.id, [
          { at: request.createdAt, action: "request", outcome: "PASSED", detail: `fixture request ${request.id}`, revision: 1, actorId: request.createdBy },
          { at: this.now().toISOString(), action: "compare", outcome: proposal.status === "proposed" ? "PASSED" : "BLOCKED", detail: `fixture revision 1; total ${proposal.totalCents} EUR cents`, revision: 1, actorId },
        ]);
        return { proposal, request };
      });
    }

    const request = await this.store.findRequest(requestId);
    if (!request) throw httpError(404, "request not found");
    this.requireFutureDeadline(request.deadline);
    const order = await this.store.findOrderByRequest(requestId);
    if (order && !order.rehearsal) {
      throw httpError(409, "Historical simulated request; create a new supplier request");
    }
    const observationSequence = await this.store.nextSupplierObservationSequence();
    const startedAt = this.now();
    const observed = await compareSupplierRequest(request, `prop_${randomUUID()}`, 1, this.valio, startedAt);

    const proposal = await this.store.transaction(async (tx) => {
      if (!await tx.findRequest(requestId)) throw httpError(404, "request not found");
      this.requireFutureDeadline(request.deadline);
      const order = await tx.findOrderByRequest(requestId);
      if (order && !order.rehearsal) {
        throw httpError(409, "Historical simulated request; create a new supplier request");
      }
      const existing = await tx.findProposalByRequest(requestId);
      if (existing?.observationSequence !== undefined && existing.observationSequence >= observationSequence) {
        return existing;
      }
      const revision = (existing?.version ?? 0) + 1;
      const proposal = { ...observed, id: existing?.id ?? observed.id, version: revision, observationSequence };
      await tx.saveProposal(proposal);
      await tx.appendEvents(proposal.id, (observed.events ?? []).map((event) => ({ ...event, revision, actorId })));
      return proposal;
    });
    return { proposal, request };
  }

  async rehearse(requestId: string, comparisonVersion: number, productId: string, actorId: string) {
    return this.store.transaction(async (tx) => {
      const request = await tx.findRequest(requestId);
      if (!request) throw httpError(404, "request not found");
      const comparison = await tx.findProposalByRequest(requestId);
      if (!comparison || comparison.comparisonMode !== "supplier_observations" || comparison.version !== comparisonVersion) {
        throw httpError(409, "The comparison changed. Refresh it and select a product");
      }
      const existing = await tx.findRehearsalByRequest(requestId);
      if (existing?.rehearsal?.supplierComparisonId === comparison.id
        && existing.rehearsal.supplierComparisonVersion === comparisonVersion && existing.rehearsal.productId === productId) {
        return existing;
      }
      if (await tx.findOrderByRequest(requestId)) throw httpError(409, "This request already has a simulated receipt");
      this.requireFutureDeadline(request.deadline);
      const now = this.now();
      const selected = buildRehearsalEvidence(comparison, request, productId, now);
      if (!selected) throw httpError(409, "This product has no current, within-budget estimate for rehearsing the full request");
      const quote: ProposalRecord = {
        id: existing?.id ?? `prop_${randomUUID()}`,
        requestId, version: (existing?.version ?? 0) + 1,
        offers: [], totalCents: selected.totalCents,
        uncoveredLiters: 0, uncoveredQuantity: 0, uncoveredUnit: request.unit,
        status: "proposed", approvedVersion: null,
        source: "CONNECTED_REHEARSAL", checkoutSupported: false,
        connectedRehearsal: true, rehearsal: selected.evidence,
      };
      await tx.saveProposal(quote);
      await tx.appendEvents(quote.id, [{
        at: now.toISOString(), action: "rehearsal_quote", outcome: "SIMULATED", actorId, revision: quote.version,
        detail: `Simulated quote for SKU ${productId} from supplier comparison version ${comparisonVersion}. Fixed rehearsal total ${quote.totalCents} EUR cents ex VAT.`,
      }]);
      return quote;
    });
  }

  async approve(id: string, version: number, actorId?: string) {
    return this.store.transaction(async (tx) => {
      const proposal = await tx.findProposal(id);
      if (!proposal) throw httpError(404, "proposal not found");
      this.requireSimulatedProposal(proposal);
      if (proposal.version !== version) throw httpError(409, "stale proposal version");
      if (proposal.status === "placed") throw httpError(409, "proposal already placed");
      requireCompleteBasket(proposal);
      const request = await tx.findRequest(proposal.requestId);
      if (!request) throw httpError(404, "request not found");
      this.requireFutureDeadline(request.deadline);
      this.requireOpenRehearsal(proposal);
      if (proposal.approvedVersion !== version) {
        await tx.saveProposal({ ...proposal, approvedVersion: version, status: "approved" });
        await tx.appendEvents(id, [{ at: this.now().toISOString(), action: "approve", outcome: "PASSED", detail: `version ${version}`, revision: version, actorId }]);
      }
      return { approved: true as const, version };
    });
  }

  async commit(id: string, version: number, idempotencyKey: string, actorId?: string) {
    return this.store.transaction(async (tx) => {
      const proposal = await tx.findProposal(id);
      if (!proposal) throw httpError(404, "proposal not found");
      this.requireSimulatedProposal(proposal);
      const replay = await tx.findOrderByKey(idempotencyKey);
      if (replay) {
        if (replay.proposalId !== id || replay.version !== version) {
          throw httpError(409, "idempotency key reused with different input");
        }
        return replay;
      }

      if (proposal.version !== version) throw httpError(409, "stale proposal version");
      if (proposal.approvedVersion !== version) throw httpError(409, "approval required for current version");
      const uncoveredLiters = requireCompleteBasket(proposal);
      if (await tx.findOrderByRequest(proposal.requestId)) throw httpError(409, "request already has an order");
      const request = await tx.findRequest(proposal.requestId);
      if (!request) throw httpError(404, "request not found");
      this.requireFutureDeadline(request.deadline);
      this.requireOpenRehearsal(proposal);

      const event = { at: this.now().toISOString(), action: "commit", outcome: "PASSED", detail: "simulated receipt", revision: version, actorId };
      const order: OrderRecord = {
        orderId: `ord_${randomUUID()}`, requestId: proposal.requestId, proposalId: id, version, idempotencyKey,
        status: "placed", totalCents: proposal.totalCents, uncoveredLiters,
        ...(proposal.rehearsal && { rehearsal: proposal.rehearsal }),
        events: [...(proposal.events ?? []), event],
      };
      await tx.saveProposal({ ...proposal, status: "placed" });
      await tx.appendEvents(id, [event]);
      await tx.createOrder(order);
      return order;
    });
  }

  async reprice(id: string, actorId?: string) {
    return this.store.transaction(async (tx) => {
      const proposal = await tx.findProposal(id);
      if (!proposal) throw httpError(404, "proposal not found");
      this.requireSimulatedProposal(proposal);
      if (proposal.status === "placed" || await tx.findOrderByRequest(proposal.requestId)) {
        throw httpError(409, "placed orders cannot be repriced");
      }
      const request = await tx.findRequest(proposal.requestId);
      if (!request) throw httpError(404, "request not found");
      this.requireFutureDeadline(request.deadline);
      const next = applyPriceChange(proposal, request);
      await tx.saveProposal({ ...next, events: proposal.events });
      await tx.appendEvents(id, [{
        at: this.now().toISOString(), action: "price_change", outcome: "APPROVAL_INVALIDATED",
        detail: `version ${proposal.version} to ${next.version}; ${proposal.totalCents} to ${next.totalCents} EUR cents`,
        revision: next.version, actorId,
      }]);
      return next;
    });
  }
}
