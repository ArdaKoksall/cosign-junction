import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const base = new URL(process.env.JUNCTION_API_BASE ?? "http://127.0.0.1:8180");
const buyer = process.env.COSIGN_BUYER_TOKEN;
const agent = process.env.COSIGN_AGENT_TOKEN;
assert.ok(buyer && agent && buyer !== agent, "Set the isolated workspace's buyer and agent tokens");

async function call(path, { method = "GET", body, token, status = 200 } = {}) {
  const response = await fetch(new URL(path, base), {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(25_000),
  });
  const data = await response.json();
  assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(data)}`);
  return data;
}

const capabilities = await call("/api/capabilities");
assert.equal(capabilities.mode, "valio_challenge");
assert.equal(capabilities.supplierCheckout, false);
assert.equal(capabilities.connectedRehearsalEnabled, true);

const deadline = new Date(process.env.JUNCTION_DEADLINE ?? "2026-11-16T09:00:00.000Z").toISOString();
const { requestId } = await call("/api/requests", {
  method: "POST", status: 201,
  body: {
    quantity: 1000, unit: "L", diet: "lactose-free", budgetCents: 300_000,
    deadline,
    query: "milk", productId: process.env.JUNCTION_PRODUCT_ID ?? "464398",
  },
});
const requestPath = `/api/requests/${requestId}`;
const comparison = await call(`${requestPath}/compare`, { method: "POST" });
assert.equal(comparison.comparisonMode, "supplier_observations");
assert.equal(comparison.checkoutSupported, false);
const [productId] = comparison.rehearsalCandidates ?? [];
assert.ok(productId, "Use a delivery date and SKU with open cutoff and a usable within-budget price in the Valio mock");
const estimate = comparison.observations.find((item) => item.productId === productId)?.estimate;
assert.ok(estimate);

const quotePath = `${requestPath}/rehearsal`;
const selection = { version: comparison.version, productId };
await call(quotePath, { method: "POST", body: selection, status: 401 });
await call(quotePath, { method: "POST", body: selection, token: agent, status: 403 });
await call(`/api/proposals/${comparison.proposalId}/approve`, {
  method: "POST", body: { version: comparison.version }, token: buyer, status: 409,
});
const quote = await call(quotePath, { method: "POST", body: selection, token: buyer, status: 201 });
assert.equal(quote.requestId, requestId);
assert.notEqual(quote.proposalId, comparison.proposalId);
assert.equal(quote.totalCents, estimate.totalCents);
assert.equal(quote.rehearsal.requestedDeadline, deadline);
const replayQuote = await call(quotePath, { method: "POST", body: selection, token: buyer, status: 201 });
assert.equal(replayQuote.proposalId, quote.proposalId);
assert.equal(replayQuote.version, quote.version);
const detail = await call(requestPath);
assert.equal(detail.request.id, requestId);
assert.deepEqual(detail.comparison, comparison);

const proposalPath = `/api/proposals/${quote.proposalId}`;
const version = { version: quote.version };
const commit = { ...version, idempotencyKey: randomUUID() };
await call(`${proposalPath}/commit`, { method: "POST", body: commit, token: buyer, status: 409 });
await call(`${proposalPath}/approve`, { method: "POST", body: version, token: agent, status: 403 });
await call(`${proposalPath}/approve`, { method: "POST", body: version, token: buyer });

const approved = await call(quotePath, { token: buyer });
assert.equal(approved.approvedVersion, quote.version);
const [receipt, retry] = await Promise.all([1, 2].map(() => call(`${proposalPath}/commit`, {
  method: "POST", body: commit, token: buyer, status: 201,
})));
assert.equal(receipt.orderId, retry.orderId);
assert.equal(receipt.simulated, true);
assert.equal(receipt.totalCents, quote.totalCents);
assert.equal(receipt.rehearsal.requestedDeadline, deadline);
const receiptPath = `/api/orders/${receipt.orderId}`;
await call(receiptPath, { status: 401 });
await call(receiptPath, { token: agent, status: 403 });
assert.deepEqual(await call(receiptPath, { token: buyer }), receipt);
const placed = await call(quotePath, { token: buyer });
assert.equal(placed.placedOrderId, receipt.orderId);
assert.equal(receipt.events.filter(({ action }) => action === "commit").length, 1);
console.log(`Connected rehearsal used Valio SKU ${productId} on the same request and returned one simulated receipt`);
