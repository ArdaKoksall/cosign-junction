import { randomUUID } from "node:crypto";
import { httpError } from "../http-error.js";
import type { PurchaseRepository } from "./repository.js";
import { compareRequest } from "./simulator.js";
import type { BuyerMandate, DecisionEvent, OrderRecord, RequestRecord } from "./types.js";

const mandateId = "routine-milk";
const quantityLiters = 100;
const weekLength = 7 * 24 * 60 * 60 * 1000;

function helsinkiWeek(now: Date) {
  const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Helsinki" }).format(now);
  const weekStart = new Date(`${localDate}T00:00:00Z`);
  weekStart.setUTCDate(weekStart.getUTCDate() - (weekStart.getUTCDay() + 6) % 7);
  return weekStart.toISOString().slice(0, 10);
}

export class RoutineMilk {
  constructor(private readonly store: PurchaseRepository, private readonly now: () => Date) {}

  async status() {
    const period = helsinkiWeek(this.now());
    const [mandate, placed] = await Promise.all([
      this.store.findMandate(mandateId), this.store.findMandateOrder(mandateId, period),
    ]);
    return { mandate, period, placedOrderId: placed?.orderId ?? null, quantityLiters };
  }

  async setMandate(active: boolean, maxTotalCents: number) {
    return this.store.transaction(async (tx) => {
      const previous = await tx.findMandate(mandateId);
      const mandate: BuyerMandate = {
        id: mandateId, active, maxTotalCents, revision: (previous?.revision ?? 0) + 1,
        updatedAt: this.now().toISOString(),
      };
      await tx.saveMandate(mandate);
      return mandate;
    });
  }

  async run(period: string, actorId: string) {
    return this.store.transaction(async (tx) => {
      const now = this.now();
      if (period !== helsinkiWeek(now)) throw httpError(409, "The requested weekly occurrence is no longer current");
      await tx.lockMandate(mandateId);
      const existing = await tx.findMandateOrder(mandateId, period);
      if (existing) return existing;
      const mandate = await tx.findMandate(mandateId);
      if (!mandate?.active) throw httpError(409, "An active buyer mandate is required for this repeat order");

      const request: RequestRecord = {
        id: `req_${randomUUID()}`, createdAt: now.toISOString(), createdBy: actorId,
        deadline: new Date(now.getTime() + weekLength).toISOString(),
        quantityLiters, quantity: quantityLiters, unit: "L", budgetCents: mandate.maxTotalCents, diet: "lactose-free", query: "routine milk",
      };
      const proposal = compareRequest(request, `prop_${randomUUID()}`, 1);
      const original = proposal.offers.find((offer) => offer.id === "offer_original");
      if (proposal.status !== "proposed" || original?.quantityLiters !== quantityLiters
          || proposal.totalCents > mandate.maxTotalCents) {
        throw httpError(409, "Routine purchase exceeds the mandate or would require a substitution");
      }

      const events: DecisionEvent[] = [
        { at: request.createdAt, action: "request", outcome: "PASSED", detail: "100 L routine milk, one occurrence per Helsinki week", actorId, revision: 1 },
        { at: request.createdAt, action: "mandate", outcome: "PASSED", detail: `Buyer mandate v${mandate.revision}, week of ${period}, up to ${mandate.maxTotalCents} EUR cents`, actorId, revision: 1 },
        { at: request.createdAt, action: "commit", outcome: "PASSED", detail: "simulated receipt under buyer mandate", actorId, revision: 1 },
      ];
      const order: OrderRecord = {
        orderId: `ord_${randomUUID()}`, requestId: request.id, proposalId: proposal.id,
        version: 1, idempotencyKey: `mandate:${mandateId}:${period}`,
        mandateId, mandatePeriod: period, status: "placed", totalCents: proposal.totalCents,
        uncoveredLiters: 0, events,
      };
      await tx.createRequest(request);
      await tx.saveProposal({ ...proposal, status: "placed" });
      await tx.appendEvents(proposal.id, events);
      await tx.createOrder(order);
      return order;
    });
  }
}
