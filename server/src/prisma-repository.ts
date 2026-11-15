import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "./generated/prisma/client.js";
import type { RequestUnit } from "./purchasing/quantity.js";
import { rankingObjectiveSchema } from "./purchasing/ranking-objective.js";
import type { PurchaseRepository, PurchaseTransaction, RequestListOptions } from "./purchasing/repository.js";
import type { BuyerMandate, DecisionEvent, Offer, OrderRecord, ProposalRecord, RequestRecord, SupplierObservation } from "./purchasing/types.js";

const proposalEvents = { events: { orderBy: { id: "asc" } } } as const;
const orderEvents = { proposal: { include: proposalEvents } } as const;

function isConcurrencyConflict(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === "P2034" || error.code === "P2002";
  }
  // PostgreSQL can detect a serializable conflict at COMMIT, when Prisma can
  // propagate the PostgreSQL driver's original transaction error.
  return error instanceof Error && error.name === "DriverAdapterError"
    && typeof error.cause === "object" && error.cause !== null
    && "kind" in error.cause && error.cause.kind === "TransactionWriteConflict";
}

function readRequest(row: Prisma.PurchaseRequestGetPayload<{}>): RequestRecord {
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy ?? undefined,
    deadline: row.deadline.toISOString(),
    quantity: row.quantity,
    unit: row.unit as RequestUnit,
    quantityLiters: row.quantityLiters,
    budgetCents: Number(row.budgetCents),
    diet: row.diet,
    ...(row.requirements.length > 0 && { requirements: row.requirements as RequestRecord["requirements"] }),
    ...(row.freeFromAllergen.length > 0 && { freeFromAllergen: row.freeFromAllergen }),
    ...(row.rankingObjective && { rankingObjective: rankingObjectiveSchema.parse(row.rankingObjective) }),
    query: row.query ?? undefined,
    productId: row.productId ?? undefined,
    preset: row.preset === "monday_milk" ? row.preset : undefined,
  };
}

function readEvent(row: Prisma.DecisionEventGetPayload<{}>): DecisionEvent {
  return {
    at: row.at.toISOString(), action: row.action, outcome: row.outcome, detail: row.detail,
    ...(row.revision == null ? {} : { revision: row.revision }),
    ...(row.actorId == null ? {} : { actorId: row.actorId }),
  };
}

function readProposal(row: Prisma.ProposalGetPayload<{ include: typeof proposalEvents }>): ProposalRecord {
  return {
    id: row.id, requestId: row.requestId, version: row.version, approvedVersion: row.approvedVersion,
    status: row.status, totalCents: Number(row.totalCents), uncoveredLiters: row.uncoveredLiters,
    uncoveredQuantity: row.uncoveredQuantity ?? undefined,
    uncoveredUnit: (row.uncoveredUnit as RequestUnit | null) ?? undefined,
    offers: row.offers as Offer[],
    comparisonMode: row.comparisonMode === "supplier_observations" ? row.comparisonMode : undefined,
    source: row.source ?? undefined,
    checkoutSupported: row.checkoutSupported ?? undefined,
    observedAt: row.observedAt?.toISOString(),
    observationSequence: row.observationSequence === null ? undefined : Number(row.observationSequence),
    observations: (row.observations as SupplierObservation[] | null) ?? undefined,
    ...(row.connectedRehearsal && { connectedRehearsal: true, rehearsal: row.rehearsal as ProposalRecord["rehearsal"] }),
    events: row.events.map(readEvent),
  };
}

function readOrder(row: Prisma.SimulatedOrderGetPayload<{ include: typeof orderEvents }>): OrderRecord {
  return {
    orderId: row.id, requestId: row.requestId, proposalId: row.proposalId, version: row.version,
    idempotencyKey: row.idempotencyKey, status: row.status, totalCents: Number(row.totalCents),
    uncoveredLiters: row.uncoveredLiters, events: row.proposal.events.map(readEvent),
    mandateId: row.mandateId ?? undefined, mandatePeriod: row.mandatePeriod ?? undefined,
    ...(row.proposal.connectedRehearsal && { rehearsal: row.proposal.rehearsal as OrderRecord["rehearsal"] }),
  };
}

class PrismaPurchaseTransaction implements PurchaseTransaction {
  constructor(protected readonly db: Prisma.TransactionClient) {}

  async findRequest(id: string) {
    const row = await this.db.purchaseRequest.findUnique({ where: { id } });
    return row && readRequest(row);
  }

  async listRequests({ limit, query, before }: RequestListOptions) {
    const where: Prisma.PurchaseRequestWhereInput[] = [];
    if (query) {
      const match = { contains: query.replace(/[\\%_]/g, "\\$&"), mode: "insensitive" } as const;
      where.push({ OR: [
        { query: match }, { productId: match }, { id: match },
        ...("milk".includes(query.toLowerCase()) ? [{ query: null }] : []),
      ] });
    }
    if (before) {
      const createdAt = new Date(before.createdAt);
      where.push({ OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: before.id } }] });
    }
    return (await this.db.purchaseRequest.findMany({
      where: { AND: where }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit,
    })).map(readRequest);
  }

  async findProposal(id: string) {
    const row = await this.db.proposal.findUnique({ where: { id }, include: proposalEvents });
    return row && readProposal(row);
  }

  private async proposalFor(requestId: string, connectedRehearsal: boolean) {
    const row = await this.db.proposal.findUnique({
      where: { requestId_connectedRehearsal: { requestId, connectedRehearsal } },
      include: proposalEvents,
    });
    return row && readProposal(row);
  }

  findProposalByRequest(requestId: string) { return this.proposalFor(requestId, false); }
  findRehearsalByRequest(requestId: string) { return this.proposalFor(requestId, true); }

  async findOrder(id: string) {
    const row = await this.db.simulatedOrder.findUnique({ where: { id }, include: orderEvents });
    return row && readOrder(row);
  }

  async findOrderByRequest(requestId: string) {
    const row = await this.db.simulatedOrder.findUnique({ where: { requestId }, include: orderEvents });
    return row && readOrder(row);
  }

  async findOrderByKey(idempotencyKey: string) {
    const row = await this.db.simulatedOrder.findUnique({ where: { idempotencyKey }, include: orderEvents });
    return row && readOrder(row);
  }

  async listOrders(take: number, connectedRehearsal?: boolean) {
    return (await this.db.simulatedOrder.findMany({
      where: connectedRehearsal === undefined ? undefined : { proposal: { connectedRehearsal } },
      orderBy: [{ placedAt: { sort: "desc", nulls: "last" } }, { id: "desc" }],
      take, include: orderEvents,
    })).map(readOrder);
  }

  async findMandate(id: string): Promise<BuyerMandate | null> {
    const row = await this.db.buyerMandate.findUnique({ where: { id } });
    return row && { ...row, updatedAt: row.updatedAt.toISOString(), maxTotalCents: Number(row.maxTotalCents) };
  }

  async findMandateOrder(mandateId: string, mandatePeriod: string) {
    const row = await this.db.simulatedOrder.findUnique({
      where: { mandateId_mandatePeriod: { mandateId, mandatePeriod } }, include: orderEvents,
    });
    return row && readOrder(row);
  }

  async createRequest(request: RequestRecord) {
    await this.db.purchaseRequest.create({
      data: { ...request, deadline: new Date(request.deadline), createdAt: new Date(request.createdAt) },
    });
  }

  async saveProposal(proposal: ProposalRecord) {
    const data = {
      version: proposal.version, approvedVersion: proposal.approvedVersion, status: proposal.status,
      totalCents: proposal.totalCents, uncoveredLiters: proposal.uncoveredLiters,
      uncoveredQuantity: proposal.uncoveredQuantity ?? null, uncoveredUnit: proposal.uncoveredUnit ?? null,
      offers: proposal.offers, comparisonMode: proposal.comparisonMode ?? null, source: proposal.source ?? null,
      checkoutSupported: proposal.checkoutSupported ?? null,
      observedAt: proposal.observedAt ? new Date(proposal.observedAt) : null,
      observationSequence: proposal.observationSequence ?? null,
      observations: proposal.observations ?? Prisma.DbNull,
      connectedRehearsal: proposal.connectedRehearsal ?? false,
      rehearsal: proposal.rehearsal ?? Prisma.DbNull,
    };
    await this.db.proposal.upsert({
      where: { id: proposal.id },
      create: { ...data, id: proposal.id, requestId: proposal.requestId },
      update: data,
    });
  }

  async appendEvents(proposalId: string, events: DecisionEvent[]) {
    // Each event receives a ledger sequence in the same order as the decision.
    for (const event of events) {
      await this.db.decisionEvent.create({ data: { ...event, at: new Date(event.at), proposalId } });
    }
  }

  async createOrder(order: OrderRecord) {
    const { orderId: id, events, rehearsal, ...data } = order;
    const committed = events.find((event) => event.action === "commit");
    await this.db.simulatedOrder.create({ data: { ...data, id, placedAt: committed ? new Date(committed.at) : null } });
  }

  async saveMandate({ id, updatedAt, ...mandate }: BuyerMandate) {
    const data = { ...mandate, updatedAt: new Date(updatedAt) };
    await this.db.buyerMandate.upsert({ where: { id }, create: { id, ...data }, update: data });
  }

  async lockMandate(id: string) {
    await this.db.$queryRaw`SELECT id FROM "BuyerMandate" WHERE id = ${id} FOR UPDATE`;
  }

  async clear() {
    await this.db.purchaseRequest.deleteMany();
    await this.db.buyerMandate.deleteMany();
  }
}

export class PrismaPurchaseRepository extends PrismaPurchaseTransaction implements PurchaseRepository {
  private readonly client: PrismaClient;

  constructor(connectionString: string) {
    const client = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
    super(client);
    this.client = client;
  }

  async readRequestDetail(id: string) {
    return this.readRequestSnapshot(id, false);
  }

  async readRequestRehearsal(id: string) {
    const detail = await this.readRequestSnapshot(id, true);
    return detail && { proposal: detail.proposal, placedOrderId: detail.placedOrderId };
  }

  private async readRequestSnapshot(id: string, connectedRehearsal: boolean) {
    // Prisma may load included relations separately, so keep the whole detail on one snapshot.
    const [row] = await this.client.$transaction([
      this.client.purchaseRequest.findUnique({
        where: { id },
        include: {
          proposals: { where: { connectedRehearsal }, include: proposalEvents },
          order: { select: { id: true, proposalId: true } },
        },
      }),
    ], { isolationLevel: "RepeatableRead" });
    if (!row) return null;
    const [proposal] = row.proposals;
    return {
      request: readRequest(row),
      proposal: proposal ? readProposal(proposal) : null,
      placedOrderId: row.order && row.order.proposalId === proposal?.id ? row.order.id : null,
    };
  }

  async nextSupplierObservationSequence() {
    const [row] = await this.client.$queryRaw<{ value: bigint }[]>`SELECT nextval('supplier_observation_sequence') AS value`;
    return Number(row.value);
  }

  async transaction<T>(operation: (tx: PurchaseTransaction) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.client.$transaction(
          (tx) => operation(new PrismaPurchaseTransaction(tx)),
          { isolationLevel: "Serializable" },
        );
      } catch (error) {
        if (!isConcurrencyConflict(error) || attempt >= 4) throw error;
      }
    }
  }

  async checkConnection() {
    await this.client.$queryRaw`SELECT 1`;
  }

  async close() {
    await this.client.$disconnect();
  }
}
