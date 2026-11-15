import assert from "node:assert/strict";

const base = new URL(process.env.JUNCTION_API_BASE ?? "http://127.0.0.1:8080");

async function call(path, method = "GET", body) {
  const response = await fetch(new URL(path, base), {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  return { status: response.status, body: await response.json() };
}

const capabilities = await call("/api/capabilities");
assert.equal(capabilities.status, 200);
assert.equal(capabilities.body.mode, "valio_challenge", "Point this smoke test at an isolated connected workspace");
assert.equal(capabilities.body.supplierCheckout, false);

const requirements = ["gluten-free", "vegan"];
const freeFromAllergen = ["AM"];
const query = new URLSearchParams({ limit: "5" });
for (const requirement of requirements) query.append("requirements", requirement);
for (const allergen of freeFromAllergen) query.append("freeFromAllergen", allergen);
const searched = await call(`/api/valio/catalog?${query}`);
assert.equal(searched.status, 200, JSON.stringify(searched.body));
assert.deepEqual(searched.body.requirements, requirements);
assert.ok(searched.body.products.length > 1);
assert.ok(searched.body.products.every((product) => requirements.every((requirement) => product.requirements.includes(requirement))));

// A query with no match verifies persistence and the read-only comparison path without using a supplier credential.
const requestBody = {
  query: "junctionciunmatchedproduct99",
  quantity: 4,
  unit: "each",
  deadline: new Date(Date.now() + 86_400_000).toISOString(),
  budgetCents: 2500,
  freeFromAllergen,
  requirements,
  rankingObjective: "carbon",
};
const created = await call("/api/requests", "POST", requestBody);
assert.equal(created.status, 201, JSON.stringify(created.body));
const requestPath = `/api/requests/${encodeURIComponent(created.body.requestId)}`;
const compared = await call(`${requestPath}/compare`, "POST");
assert.equal(compared.status, 200, JSON.stringify(compared.body));
assert.equal(compared.body.status, "no_catalog_match");
assert.equal(compared.body.version, 1);
assert.equal(compared.body.checkoutSupported, false);
assert.deepEqual(compared.body.decision.ranking, {
  objective: "carbon", status: "unavailable", candidateCount: 0, measuredCount: 0,
});

const reread = await call(requestPath);
assert.equal(reread.status, 200);
for (const field of ["query", "quantity", "unit", "requirements", "freeFromAllergen", "rankingObjective"]) {
  assert.deepEqual(reread.body.request[field], requestBody[field]);
}
assert.deepEqual(reread.body.comparison, compared.body);
assert.deepEqual(reread.body.events.map(({ action, revision }) => [action, revision]), [["supplier_lookup", 1], ["supplier_ranking", 1]]);
for (const action of ["approve", "commit"]) {
  const unavailable = await call(`/api/proposals/${compared.body.proposalId}/${action}`, "POST", { version: 1, idempotencyKey: "audit" });
  assert.equal(unavailable.status, capabilities.body.connectedRehearsalEnabled ? 401 : 501);
}

const search = `History ${crypto.randomUUID()}`;
const historyIds = [];
for (const suffix of ["literalAX", "literal_%", "recent"]) {
  const saved = await call("/api/requests", "POST", { ...requestBody, query: `${search} ${suffix}` });
  assert.equal(saved.status, 201, JSON.stringify(saved.body));
  historyIds.push(saved.body.requestId);
}
const pageQuery = new URLSearchParams({ query: search.toUpperCase(), limit: "2" });
const firstPage = await call(`/api/requests?${pageQuery}`);
assert.equal(firstPage.status, 200);
assert.equal(firstPage.body.requests.length, 2);
assert.ok(firstPage.body.nextCursor);
pageQuery.set("cursor", firstPage.body.nextCursor);
const secondPage = await call(`/api/requests?${pageQuery}`);
assert.equal(secondPage.status, 200);
assert.equal(secondPage.body.requests.length, 1);
assert.equal(secondPage.body.nextCursor, null);
const requests = [...firstPage.body.requests, ...secondPage.body.requests];
assert.deepEqual(requests.map(({ id }) => id).sort(), historyIds.toSorted());
const sortKeys = requests.map(({ createdAt, id }) => `${createdAt}/${id}`);
assert.deepEqual(sortKeys, sortKeys.toSorted().reverse());
const escapedSearch = await call(`/api/requests?${new URLSearchParams({ query: `${search} literal_%` })}`);
assert.equal(escapedSearch.status, 200);
assert.deepEqual(escapedSearch.body.requests.map(({ id }) => id), [historyIds[1]]);

console.log("Connected workspace: filtered catalog, saved comparison and decision history, request search and pagination, checkout boundary");
