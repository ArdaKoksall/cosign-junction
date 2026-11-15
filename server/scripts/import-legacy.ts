import { databaseUrl, loadRootEnv } from "../src/environment.js";
import { PrismaPurchaseRepository } from "../src/prisma-repository.js";
import { readStateFile } from "../src/store.js";

loadRootEnv();

const [mode, path] = process.argv.slice(2);
if (!path || (mode !== "connected" && mode !== "simulator")) {
  throw new Error("Usage: npm run db:import -- <connected|simulator> <state.json>");
}
const connection = databaseUrl(mode === "simulator");
if (!connection) throw new Error("Set the database URL for the chosen import mode");
if (mode === "simulator" && connection === databaseUrl()) {
  throw new Error("Choose a separate simulator database");
}

const state = await readStateFile(path);
const requests = Object.values(state.requests);
const proposals = Object.values(state.proposals);
const orders = Object.values(state.orders);
const connectedIds = new Set(proposals
  .filter((proposal) => proposal.comparisonMode === "supplier_observations" || proposal.connectedRehearsal)
  .map((proposal) => proposal.requestId));
// An unclassified draft goes to the connected workspace. Fixture proposals and receipts identify simulator records.
const simulatedIds = new Set([
  ...orders.filter((order) => !state.proposals[order.proposalId]?.connectedRehearsal).map((order) => order.requestId),
  ...proposals.filter((proposal) => !connectedIds.has(proposal.requestId)).map((proposal) => proposal.requestId),
]);
const selectedRequests = requests.filter(({ id }) => simulatedIds.has(id) === (mode === "simulator"));
const selectedIds = new Set(selectedRequests.map(({ id }) => id));
const selectedProposals = proposals.filter(({ requestId }) => selectedIds.has(requestId));
const selectedOrders = orders.filter(({ requestId }) => selectedIds.has(requestId));
const selectedMandates = mode === "simulator" ? Object.values(state.mandates ?? {}) : [];
const ordersByProposal = new Map(selectedOrders.map((order) => [order.proposalId, order]));

const store = new PrismaPurchaseRepository(connection);
try {
  await store.transaction(async (tx) => {
    const existingRequests = await tx.listRequests({ limit: 1 });
    const existingMandates = await Promise.all(selectedMandates.map(({ id }) => tx.findMandate(id)));
    if (existingRequests.length || existingMandates.some(Boolean)) throw new Error("Import requires an empty destination database");
    for (const mandate of selectedMandates) await tx.saveMandate(mandate);
    for (const request of selectedRequests) await tx.createRequest(request);
    for (const proposal of selectedProposals) {
      await tx.saveProposal(proposal);
      const events = ordersByProposal.get(proposal.id)?.events ?? proposal.events ?? [];
      await tx.appendEvents(proposal.id, events);
    }
    for (const order of selectedOrders) await tx.createOrder(order);
  });
  console.log(`Imported ${selectedRequests.length} requests, ${selectedProposals.length} proposals, ${selectedOrders.length} orders and ${selectedMandates.length} mandates to the ${mode} database`);
} finally {
  await store.close();
}
