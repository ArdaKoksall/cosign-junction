import type { BuyerMandate, DecisionEvent, OrderRecord, ProposalRecord, RequestRecord } from "./types.js";

export type RequestListCursor = Pick<RequestRecord, "createdAt" | "id">;

export interface RequestListOptions {
  limit: number;
  query?: string;
  before?: RequestListCursor;
}

export interface PurchaseReader {
  findRequest(id: string): Promise<RequestRecord | null>;
  listRequests(options: RequestListOptions): Promise<RequestRecord[]>;
  findProposal(id: string): Promise<ProposalRecord | null>;
  findProposalByRequest(requestId: string): Promise<ProposalRecord | null>;
  findRehearsalByRequest(requestId: string): Promise<ProposalRecord | null>;
  findOrder(id: string): Promise<OrderRecord | null>;
  findOrderByRequest(requestId: string): Promise<OrderRecord | null>;
  findOrderByKey(key: string): Promise<OrderRecord | null>;
  listOrders(limit: number, connectedRehearsal?: boolean): Promise<OrderRecord[]>;
  findMandate(id: string): Promise<BuyerMandate | null>;
  findMandateOrder(id: string, period: string): Promise<OrderRecord | null>;
}

export interface PurchaseTransaction extends PurchaseReader {
  createRequest(request: RequestRecord): Promise<void>;
  saveProposal(proposal: ProposalRecord): Promise<void>;
  appendEvents(proposalId: string, events: DecisionEvent[]): Promise<void>;
  createOrder(order: OrderRecord): Promise<void>;
  saveMandate(mandate: BuyerMandate): Promise<void>;
  lockMandate(id: string): Promise<void>;
  clear(): Promise<void>;
}

export interface PurchaseRepository extends PurchaseReader {
  readRequestDetail(id: string): Promise<{
    request: RequestRecord;
    proposal: ProposalRecord | null;
    placedOrderId: string | null;
  } | null>;
  readRequestRehearsal(id: string): Promise<{
    proposal: ProposalRecord | null;
    placedOrderId: string | null;
  } | null>;
  nextSupplierObservationSequence(): Promise<number>;
  transaction<T>(operation: (tx: PurchaseTransaction) => Promise<T>): Promise<T>;
}
