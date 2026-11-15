import { mkdir, rename, writeFile, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { emptyState, type State } from "./purchasing/types.js";
import type { PurchaseRepository, PurchaseTransaction, RequestListOptions } from "./purchasing/repository.js";

function stateTransaction(state: State): PurchaseTransaction {
  function proposalFor(requestId: string, rehearsal: boolean) {
    return Object.values(state.proposals).find((proposal) =>
      proposal.requestId === requestId && Boolean(proposal.connectedRehearsal) === rehearsal) ?? null;
  }

  return {
    async findRequest(id) { return state.requests[id] ?? null; },
    async listRequests({ limit, query, before }) {
      const search = query?.toLowerCase();
      const boundary = before && { id: before.id, createdAt: Date.parse(before.createdAt) };
      return Object.values(state.requests)
        .filter((request) => !search || [request.query ?? "milk", request.productId, request.id]
          .some((value) => value?.toLowerCase().includes(search)))
        .map((request) => ({ request, createdAt: Date.parse(request.createdAt) }))
        .filter(({ request, createdAt }) => !boundary || createdAt < boundary.createdAt
          || (createdAt === boundary.createdAt && request.id < boundary.id))
        .sort((first, second) => second.createdAt - first.createdAt || (first.request.id < second.request.id ? 1 : -1))
        .slice(0, limit)
        .map(({ request }) => request);
    },
    async findProposal(id) { return state.proposals[id] ?? null; },
    async findProposalByRequest(id) { return proposalFor(id, false); },
    async findRehearsalByRequest(id) { return proposalFor(id, true); },
    async findOrder(id) { return state.orders[id] ?? null; },
    async findOrderByRequest(id) { return state.orders[state.requestOrderId[id]] ?? null; },
    async findOrderByKey(key) { return state.orders[state.idempotency[key]] ?? null; },
    async listOrders(limit, connectedRehearsal) {
      return Object.values(state.orders)
        .filter((order) => connectedRehearsal === undefined
          || Boolean(state.proposals[order.proposalId]?.connectedRehearsal) === connectedRehearsal)
        .reverse()
        .slice(0, limit);
    },
    async findMandate(id) { return state.mandates?.[id] ?? null; },
    async findMandateOrder(id, period) {
      return Object.values(state.orders).find((order) => order.mandateId === id && order.mandatePeriod === period) ?? null;
    },
    async createRequest(request) { state.requests[request.id] = request; },
    async saveProposal(proposal) {
      const events = state.proposals[proposal.id]?.events;
      state.proposals[proposal.id] = { ...proposal, events };
    },
    async appendEvents(id, events) { (state.proposals[id].events ??= []).push(...events); },
    async createOrder(order) {
      state.orders[order.orderId] = order;
      state.requestOrderId[order.requestId] = order.orderId;
      state.idempotency[order.idempotencyKey] = order.orderId;
    },
    async saveMandate(mandate) { (state.mandates ??= {})[mandate.id] = mandate; },
    async lockMandate() { /* The JSON store serializes all writes. */ },
    async clear() { Object.assign(state, emptyState(), { mandates: {} }); },
  };
}

export async function readStateFile(path: string): Promise<State> {
  const state = JSON.parse(await readFile(path, "utf8")) as State;
  for (const request of Object.values(state.requests)) {
    if (request.quantityLiters != null) {
      request.quantity ??= request.quantityLiters;
      request.unit ??= "L";
    }
  }
  for (const proposal of Object.values(state.proposals)) {
    if (proposal.uncoveredLiters != null) {
      proposal.uncoveredQuantity ??= proposal.uncoveredLiters;
      proposal.uncoveredUnit ??= "L";
    }
    if (proposal.rehearsal) proposal.rehearsal.requestedDeadline ??= state.requests[proposal.requestId].deadline;
  }
  for (const order of Object.values(state.orders)) {
    if (order.rehearsal) order.rehearsal.requestedDeadline ??= state.requests[order.requestId].deadline;
  }
  return state;
}

export class JsonStore implements PurchaseRepository {
  private state: State = emptyState();
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async load(): Promise<void> {
    try {
      this.state = await readStateFile(this.filePath);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw err;
      this.state = emptyState();
      await this.persist();
    }
  }

  get(): State {
    return this.state;
  }

  private reader() {
    return stateTransaction(structuredClone(this.state));
  }

  findRequest(id: string) { return this.reader().findRequest(id); }
  listRequests(options: RequestListOptions) { return this.reader().listRequests(options); }
  findProposal(id: string) { return this.reader().findProposal(id); }
  findProposalByRequest(id: string) { return this.reader().findProposalByRequest(id); }
  findRehearsalByRequest(id: string) { return this.reader().findRehearsalByRequest(id); }
  findOrder(id: string) { return this.reader().findOrder(id); }
  findOrderByRequest(id: string) { return this.reader().findOrderByRequest(id); }
  findOrderByKey(key: string) { return this.reader().findOrderByKey(key); }
  listOrders(limit: number, connectedRehearsal?: boolean) { return this.reader().listOrders(limit, connectedRehearsal); }
  findMandate(id: string) { return this.reader().findMandate(id); }
  findMandateOrder(id: string, period: string) { return this.reader().findMandateOrder(id, period); }

  async readRequestDetail(id: string) {
    return this.readRequestSnapshot(id, false);
  }

  async readRequestRehearsal(id: string) {
    const detail = await this.readRequestSnapshot(id, true);
    return detail && { proposal: detail.proposal, placedOrderId: detail.placedOrderId };
  }

  private async readRequestSnapshot(id: string, rehearsal: boolean) {
    const reader = this.reader();
    const request = await reader.findRequest(id);
    if (!request) return null;
    const [proposal, order] = await Promise.all([
      rehearsal ? reader.findRehearsalByRequest(id) : reader.findProposalByRequest(id),
      reader.findOrderByRequest(id),
    ]);
    return { request, proposal, placedOrderId: order && order.proposalId === proposal?.id ? order.orderId : null };
  }

  nextSupplierObservationSequence() {
    return this.mutate((state) => ++state.seq);
  }

  transaction<T>(operation: (tx: PurchaseTransaction) => Promise<T>) {
    return this.mutate((state) => operation(stateTransaction(state)));
  }

  async mutate<T>(fn: (state: State) => T | Promise<T>): Promise<T> {
    const run = this.writeQueue.then(async () => {
      const next = structuredClone(this.state);
      const result = await fn(next);
      await this.persist(next);
      this.state = next;
      return result;
    });
    this.writeQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async persist(state = this.state): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    await writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await rename(tmp, this.filePath);
  }
}
