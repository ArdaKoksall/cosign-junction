#!/usr/bin/env node
/**
 * Standalone workflow API smoke test.
 * Waits for localhost:3001, then: reset → request → compare → approve →
 * price-change (old version cannot commit) → compare/approve/commit →
 * idempotent commit returns the same receipt.
 */

const BASE = process.env.JUNCTION_API_BASE ?? "http://127.0.0.1:3001";
const WAIT_MS = Number(process.env.JUNCTION_WAIT_MS ?? 60_000);
const BUYER_TOKEN = process.env.COSIGN_BUYER_TOKEN;
const AGENT_TOKEN = process.env.COSIGN_AGENT_TOKEN;

function tomorrowUtcIso() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(12, 0, 0, 0);
  return d.toISOString();
}

const REQUEST_BODY = {
  quantityLiters: 1000,
  deadline: process.env.JUNCTION_DEADLINE ?? tomorrowUtcIso(),
  diet: "lactose-free",
  budgetCents: 200000,
};

const failures = [];
const steps = [];

function log(msg) {
  const line = `[smoke] ${msg}`;
  steps.push(line);
  console.log(line);
}

function fail(msg) {
  failures.push(msg);
  log(`FAIL: ${msg}`);
}

function assert(cond, msg) {
  if (!cond) fail(msg);
}

function pick(obj, ...keys) {
  if (!obj || typeof obj !== "object") return undefined;
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  return undefined;
}

function receiptIdOf(body) {
  if (!body || typeof body !== "object") return undefined;
  const nested = pick(body, "receipt");
  if (nested && typeof nested === "object") {
    return pick(nested, "receiptId", "id", "orderId");
  }
  return pick(body, "receiptId", "orderId", "id");
}

async function waitForServer() {
  const origin = new URL(BASE);
  const host = origin.hostname;
  const port = Number(origin.port || (origin.protocol === "https:" ? 443 : 80));
  const deadline = Date.now() + WAIT_MS;
  log(`waiting for ${host}:${port} (up to ${WAIT_MS}ms)`);

  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/capabilities`, {
        signal: AbortSignal.timeout(2000),
      });
      log(`GET /api/capabilities → ${res.status}`);
      return res;
    } catch (err) {
      const code = err?.cause?.code ?? err?.code ?? err?.name;
      if (code !== "ECONNREFUSED" && code !== "TimeoutError" && err?.name !== "TimeoutError") {
        log(`wait probe: ${err.message}`);
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`timed out waiting for ${BASE} after ${WAIT_MS}ms`);
}

async function jsonRequest(method, path, body, token = BUYER_TOKEN) {
  const url = `${BASE}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      accept: "application/json",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { _raw: text };
  }
  log(`${method} ${path} → ${res.status}`);
  return { res, json, text };
}

async function main() {
  const capabilitiesResponse = await waitForServer();
  const capabilities = await capabilitiesResponse.json();
  if (!capabilitiesResponse.ok || !capabilities.simulatorEnabled) throw new Error("Point the smoke test at a simulator API");
  if (capabilities.purchasingAuthRequired && (!BUYER_TOKEN || !AGENT_TOKEN)) throw new Error("Provide both simulator tokens");
  const scenario = crypto.randomUUID();

  const created = await jsonRequest("POST", "/api/requests", REQUEST_BODY, AGENT_TOKEN);
  assert(created.res.ok, `create request failed: ${created.res.status} ${created.text}`);
  const requestId = pick(created.json, "requestId", "id");
  assert(typeof requestId === "string" && requestId.length > 0, "create request must return requestId");

  const compared = await jsonRequest("POST", `/api/requests/${requestId}/compare`, {}, AGENT_TOKEN);
  assert(compared.res.ok, `compare failed: ${compared.res.status} ${compared.text}`);
  const proposalId = pick(compared.json, "proposalId", "id");
  const version = pick(compared.json, "version", "revision");
  const offers = pick(compared.json, "offers", "candidates") ?? [];
  assert(typeof proposalId === "string" && proposalId.length > 0, "compare must return proposalId");
  assert(version !== undefined && version !== null, "compare must return version");
  assert(Array.isArray(offers) && offers.length > 0, "compare must return offers[]");
  assert(compared.json.totalCents === 126400, "initial revision must total €1,264");

  if (AGENT_TOKEN) {
    const attemptedApproval = await jsonRequest("POST", `/api/proposals/${proposalId}/approve`, { version, role: "buyer" }, AGENT_TOKEN);
    assert(attemptedApproval.res.status === 403, "agent credential must not approve");
  }

  const approved = await jsonRequest("POST", `/api/proposals/${proposalId}/approve`, { version });
  assert(approved.res.ok, `approve failed: ${approved.res.status} ${approved.text}`);

  const priceChange = await jsonRequest("POST", "/api/demo/price-change", { proposalId });
  assert(priceChange.res.ok, `price-change failed: ${priceChange.res.status} ${priceChange.text}`);

  const staleCommit = await jsonRequest("POST", `/api/proposals/${proposalId}/commit`, {
    version,
    idempotencyKey: `${scenario}-stale`,
  });
  assert(
    staleCommit.res.status === 409 || staleCommit.res.status === 400 || staleCommit.res.status === 412,
    `commit after price-change must reject old version, got ${staleCommit.res.status}`,
  );
  assert(!staleCommit.res.ok, "stale commit must not succeed");

  const compared2 = await jsonRequest("POST", `/api/requests/${requestId}/compare`, {});
  assert(compared2.res.ok, `re-compare failed: ${compared2.res.status} ${compared2.text}`);
  const proposalId2 = pick(compared2.json, "proposalId", "id");
  const version2 = pick(compared2.json, "version", "revision");
  assert(typeof proposalId2 === "string" && proposalId2.length > 0, "re-compare must return proposalId");
  assert(version2 !== undefined && version2 !== null, "re-compare must return version");
  assert(String(version2) !== String(version), `price-change must invalidate version (still ${version})`);
  assert(compared2.json.totalCents === 132800, "updated revision must total €1,328");

  const approved2 = await jsonRequest("POST", `/api/proposals/${proposalId2}/approve`, { version: version2 });
  assert(approved2.res.ok, `approve new version failed: ${approved2.res.status} ${approved2.text}`);

  const idempotencyKey = `${scenario}-commit`;
  const commitPath = `/api/proposals/${proposalId2}/commit`;
  const input = { version: version2, idempotencyKey };
  if (AGENT_TOKEN) {
    const denied = await jsonRequest("POST", commitPath, input, AGENT_TOKEN);
    assert(denied.res.status === 403, "agent credential must not commit");
  }
  const [commit1, commit2] = await Promise.all([
    jsonRequest("POST", commitPath, input),
    jsonRequest("POST", commitPath, input),
  ]);
  assert(
    commit1.res.status === 200 || commit1.res.status === 201,
    `commit must succeed, got ${commit1.res.status} ${commit1.text}`,
  );
  const receiptA = receiptIdOf(commit1.json);
  assert(typeof receiptA === "string" && receiptA.length > 0, "commit must return a receipt id");

  assert(
    commit2.res.status === 200 || commit2.res.status === 201,
    `idempotent commit must succeed, got ${commit2.res.status} ${commit2.text}`,
  );
  const receiptB = receiptIdOf(commit2.json);
  assert(receiptB === receiptA, `idempotent commit must return same receipt (${receiptA} vs ${receiptB})`);
  const differentKey = await jsonRequest("POST", commitPath, { ...input, idempotencyKey: `${scenario}-new-key` });
  assert(differentKey.res.status === 409, "new key must not place another order for the same request");
  const fetched = await jsonRequest("GET", `/api/orders/${receiptA}`);
  assert(fetched.res.ok && JSON.stringify(fetched.json) === JSON.stringify(commit1.json), "stored receipt must match the commit response");
  assert(fetched.json.events.filter((event) => event.action === "commit").length === 1, "receipt must have exactly one commit event");
  if (AGENT_TOKEN) {
    assert(fetched.json.events.find((event) => event.action === "request").actorId === "demo-agent", "receipt must identify the submitting agent");
    assert(fetched.json.events.find((event) => event.action === "commit").actorId === "demo-buyer", "receipt must identify the committing buyer");
  }

  const summary = {
    ok: failures.length === 0,
    base: BASE,
    requestId,
    firstVersion: version,
    secondVersion: version2,
    receiptId: receiptA,
    failures,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (failures.length) process.exit(1);
}

main().catch((err) => {
  console.error(`[smoke] fatal: ${err.message}`);
  process.exit(1);
});
