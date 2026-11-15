import assert from "node:assert/strict";

const base = new URL(process.env.JUNCTION_API_BASE ?? "http://127.0.0.1:8081");
const buyer = process.env.COSIGN_BUYER_TOKEN;
const agent = process.env.COSIGN_AGENT_TOKEN;
if (!buyer || !agent) throw new Error("Provide simulator buyer and agent tokens");

const route = "/api/simulator/routine-milk";
async function call(path, token, body) {
  const response = await fetch(new URL(path, base), {
    method: body ? "POST" : "GET",
    headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body && JSON.stringify(body), signal: AbortSignal.timeout(10_000),
  });
  return { code: response.status, body: await response.json() };
}

const start = await call(route, buyer);
assert.equal(start.code, 200);
assert.equal(start.body.placedOrderId, null, "Use an isolated simulator with no weekly order");
const input = { period: start.body.period };
const enable = { active: true, maxTotalCents: 12000 };
assert.equal((await call(`${route}/mandate`, agent, enable)).code, 403);
assert.equal((await call(`${route}/mandate`, buyer, { ...enable, maxTotalCents: 11999 })).code, 200);
assert.equal((await call(`${route}/run`, agent, input)).code, 409);
assert.equal((await call(`${route}/mandate`, buyer, { ...enable, active: false })).code, 200);
assert.equal((await call(`${route}/run`, agent, input)).code, 409);
assert.equal((await call(`${route}/mandate`, buyer, enable)).code, 200);
const [first, second] = await Promise.all([
  call(`${route}/run`, agent, input),
  call(`${route}/run`, agent, input),
]);
assert.equal(first.code, 201, JSON.stringify(first.body));
assert.equal(second.code, 201, JSON.stringify(second.body));
assert.equal(first.body.totalCents, 12000);
assert.deepEqual(first.body, second.body);
assert.equal(first.body.events.filter((event) => event.action === "commit").length, 1);
assert.equal((await call(route, buyer)).body.placedOrderId, first.body.orderId);
console.log("Weekly mandate: agent grant denied, budget and revocation enforced, two concurrent runs returned one €120 receipt");
