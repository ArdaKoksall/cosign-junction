import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";

const base = new URL(process.env.COSIGN_REHEARSAL_URL ?? "http://localhost:8182");
const loopback = base.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname);
assert(loopback || base.protocol === "https:", "Use a loopback or HTTPS account rehearsal workspace");
const origin = base.origin;
const email = process.env.COSIGN_REHEARSAL_EMAIL;
const password = process.env.COSIGN_REHEARSAL_PASSWORD;
assert(email?.endsWith(".invalid") && password, "Set COSIGN_REHEARSAL_EMAIL and COSIGN_REHEARSAL_PASSWORD for a synthetic buyer");

// Exercise the same SDK version pinned by the server without a second lockfile.
const requireServer = createRequire(new URL("../server/package.json", import.meta.url));
const { Client } = requireServer("@modelcontextprotocol/sdk/client/index.js");
const { StreamableHTTPClientTransport } = requireServer("@modelcontextprotocol/sdk/client/streamableHttp.js");

const scopes = ["catalog:read", "requests:write", "orders:write"];
const mcpUrl = `${origin}/mcp`;
const redirectUri = "http://127.0.0.1:19283/callback";
const productId = "900001";
const unavailableProductId = "900002";
const totalCents = 165_000;
const helsinki = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Helsinki" });
const tomorrow = new Date(`${helsinki.format(new Date())}T00:00:00Z`);
tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
const availableDate = tomorrow.toISOString().slice(0, 10);
const tunnelHeaders = base.hostname.endsWith(".ngrok-free.dev") ? { "ngrok-skip-browser-warning": "1" } : {};

function request(path, { headers, ...options } = {}) {
  return fetch(new URL(path, origin), {
    redirect: "manual", signal: AbortSignal.timeout(15_000), ...options, headers: { ...tunnelHeaders, ...headers },
  });
}

async function json(response, status = 200) {
  const result = await response;
  assert.equal(result.status, status, `${new URL(result.url).pathname} returned HTTP ${result.status}`);
  return result.json();
}

function post(path, data, headers = {}) {
  return request(path, {
    method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(data),
  });
}

const capabilities = await json(request("/api/capabilities"));
assert.partialDeepStrictEqual(capabilities, {
  mode: "production", mcp: true, orderRehearsalAvailable: true, supplierCheckout: false,
});
if (!loopback) assert.equal(capabilities.valioStubMode, true, "A public rehearsal workspace must use the Valio stub");
const unauthorized = await request("/mcp");
assert.equal(unauthorized.status, 401, "Unauthenticated MCP requires OAuth");
const metadataPath = "/.well-known/oauth-protected-resource/mcp";
assert(unauthorized.headers.get("www-authenticate")?.includes(`${origin}${metadataPath}`));
await unauthorized.body?.cancel();
const resource = await json(request(metadataPath));
assert.equal(resource.resource, mcpUrl);
const oauth = await json(request("/.well-known/oauth-authorization-server"));
assert(resource.authorization_servers.includes(oauth.issuer));
assert(oauth.code_challenge_methods_supported.includes("S256"));
for (const endpoint of [oauth.registration_endpoint, oauth.authorization_endpoint, oauth.token_endpoint]) {
  assert.equal(new URL(endpoint).origin, origin, "OAuth endpoints must stay on the same workspace origin");
}

const sessionHeaders = { Origin: origin, "X-Requested-With": "Cosign" };
const login = await post("/api/login", { email, password }, sessionHeaders);
assert.equal((await json(login)).ok, true);
const sessionCookie = login.headers.get("set-cookie");
assert(sessionCookie, "Buyer sign-in must set a session cookie");
if (!loopback) assert.match(sessionCookie, /;\s*Secure(?:;|$)/i);
const cookie = sessionCookie.split(";")[0];
const buyerHeaders = { ...sessionHeaders, Cookie: cookie };
const { account: { policy } } = await json(request("/api/session", { headers: buyerHeaders }));
assert.equal(policy.automaticLimitCents, 0, "Start with a newly provisioned buyer with zero automatic authority");

const registration = await json(post(oauth.registration_endpoint, {
  client_name: "CoSign account rehearsal smoke",
  redirect_uris: [redirectUri],
  grant_types: ["authorization_code", "refresh_token"],
  response_types: ["code"],
  token_endpoint_auth_method: "none",
}), 201);
const verifier = randomBytes(32).toString("base64url");
const state = randomUUID();
const authorization = new URL(oauth.authorization_endpoint);
authorization.search = new URLSearchParams({
  response_type: "code", client_id: registration.client_id, redirect_uri: redirectUri,
  code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256",
  scope: scopes.join(" "), resource: mcpUrl, state,
}).toString();
const authorize = await request(authorization);
assert.equal(authorize.status, 302);
const consentUrl = new URL(authorize.headers.get("location"));
assert.equal(consentUrl.origin, origin);
const consentId = consentUrl.searchParams.get("authorize");
assert(consentId, "OAuth must return a buyer consent link");
await authorize.body?.cancel();
const consent = await json(post("/api/oauth/consent", { id: consentId, allow: true }, buyerHeaders));
const callback = new URL(consent.redirect);
assert.equal(`${callback.origin}${callback.pathname}`, redirectUri);
assert.equal(callback.searchParams.get("iss"), oauth.issuer);
assert.equal(callback.searchParams.get("state"), state);
const code = callback.searchParams.get("code");
assert(code, "OAuth consent must yield an authorization code");
const tokens = await json(request(oauth.token_endpoint, {
  method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "authorization_code", client_id: registration.client_id, redirect_uri: redirectUri,
    code, code_verifier: verifier, resource: mcpUrl,
  }),
}));
assert(tokens.access_token, "PKCE token exchange must issue an access token");

const client = new Client({ name: "cosign-account-rehearsal", version: "1.0.0" });
const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
  requestInit: { headers: { ...tunnelHeaders, Authorization: `Bearer ${tokens.access_token}` } },
});

async function call(name, args = {}, expectedError) {
  const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 20_000 });
  assert.equal(Boolean(result.isError), Boolean(expectedError), `${name}: ${result.structuredContent?.message ?? "unexpected result"}`);
  assert(result.structuredContent, `${name} must return structured content`);
  if (expectedError) assert.equal(result.structuredContent.error, expectedError, name);
  return result.structuredContent;
}

const milk = { productId, quantity: 1_000, unit: "L", requirements: ["lactose-free"] };

function assertMilkOffer(comparison) {
  const offer = comparison.deliveryOffers.find((entry) => entry.availableDate === availableDate);
  assert.partialDeepStrictEqual(offer, {
    productId, eligible: true, salesUnit: "ST", salesUnitPriceCents: 165, availableSellUnits: 1200, stockUnknown: false,
  });
}

async function prepare(deadline) {
  const { runId, revision } = await call("create_request", {
    ...milk, budgetCents: 180_000, ...(deadline ? { deadline } : {}), idempotencyKey: randomUUID(),
  });
  const compared = await call("compare_products", { runId, revision });
  assertMilkOffer(compared.comparison);
  const draft = await call("prepare_order", { runId, revision: compared.revision, productId, availableDate });
  assert.partialDeepStrictEqual(draft.draft, { productId, salesUnits: 1_000, totalCents, availableDate });
  return draft;
}

async function prepareAfterOmission() {
  const { runId, revision } = await call("create_request", {
    items: [milk, { productId: unavailableProductId, quantity: 5, unit: "kg" }],
    budgetCents: 180_000, idempotencyKey: randomUUID(),
  });
  const compared = await call("compare_products", { runId, revision });
  const milkItem = compared.requirements.items.find((line) => line.productId === productId);
  const blockedItem = compared.requirements.items.find((line) => line.productId === unavailableProductId);
  assert(milkItem && blockedItem, "Both products must remain visible in the original basket");
  assert.equal(compared.itemAvailability[blockedItem.itemId].status, "supplier_blocked");
  assert.partialDeepStrictEqual(compared.partialBasketPlan, {
    status: "feasible", totalCents, omittedItemIds: [blockedItem.itemId],
    selections: [{ itemId: milkItem.itemId, productId }],
  });

  const edited = await call("remove_request_items", { runId, revision: compared.revision, itemIds: [blockedItem.itemId] });
  assert.equal(edited.comparison, null, "An omission invalidates the previous comparison");
  assert.partialDeepStrictEqual(edited.requestChanges, [{
    kind: "items_removed", actorSource: "mcp", revision: edited.revision,
    items: [{ itemId: blockedItem.itemId, productId: unavailableProductId, quantity: 5, unit: "kg" }],
  }]);
  const refreshed = await call("compare_products", { runId, revision: edited.revision });
  assert.equal(refreshed.comparison.items.length, 1);
  assert.equal(refreshed.comparison.items[0].itemId, milkItem.itemId);
  assertMilkOffer(refreshed.comparison.items[0]);
  const draft = await call("prepare_order", {
    runId, revision: refreshed.revision, selections: [{ itemId: milkItem.itemId, productId, availableDate }],
  });
  assert.partialDeepStrictEqual(draft.draft, {
    totalCents, items: [{ itemId: milkItem.itemId, productId, salesUnits: 1_000, totalCents, availableDate }],
  });
  assert.deepEqual(draft.requestChanges, edited.requestChanges);
  return draft;
}

async function rehearse(draft, authorization, label) {
  const runId = draft.id;
  const approval = authorization === "buyer_approval";
  const review = new URL(draft.reviewUrl);
  assert.equal(review.origin, origin);
  assert.equal(review.searchParams.get("run"), runId);
  const reviewPage = await request(review, { headers: buyerHeaders });
  assert.equal(reviewPage.status, 200, "The buyer review link must open in the web workspace");
  assert.match(reviewPage.headers.get("content-type") ?? "", /^text\/html\b/);
  await reviewPage.body?.cancel();
  const runPath = `/api/runs/${encodeURIComponent(runId)}`;
  const checkout = { runId, revision: draft.revision, idempotencyKey: randomUUID(), mode: "rehearsal" };
  assert.equal(draft.status, approval ? "awaiting_approval" : "ready");
  if (approval) {
    await call("place_order", checkout, "approval_required");
    const decision = await json(post(`${runPath}/decision`, { revision: draft.revision, approve: true }, buyerHeaders));
    assert.equal(decision.status, "approved");
    const approved = await call("get_request_status", { runId });
    assert.equal(approved.approved_revision, draft.revision);
  }
  const order = await call("place_order", checkout);
  assert.equal(order.status, "completed");
  assert.partialDeepStrictEqual(order.receipt, {
    kind: "order_rehearsal", submittedToSupplier: false, totalCents, revision: draft.revision,
    currency: "EUR", moneyBasis: "VAT_EXCLUSIVE", authorization,
  });
  assert.deepEqual(await call("place_order", checkout), order);
  const reopened = await json(request(runPath, { headers: buyerHeaders }));
  assert.deepEqual(reopened.receipt, order.receipt);
  assert.deepEqual(reopened.requestChanges, draft.requestChanges);
  const { events } = await call("get_activity", { runId });
  assert.equal(events.filter(({ action, status }) => action === "order_rehearsal" && status === "completed").length, 1);
  assert.equal(events.some(({ action, status }) => action === "human_approval" && status === "completed"), approval);
  console.log(`${label}: €1,650 ex VAT, receipt ${order.receipt.receiptId}`);
}

try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  for (const name of ["create_request", "compare_products", "remove_request_items", "prepare_order", "place_order", "get_request_status"]) {
    assert(tools.some((tool) => tool.name === name), `MCP must advertise ${name}`);
  }
  assert.partialDeepStrictEqual(await call("get_account_context"), {
    policy, supplierCheckoutAvailable: false, orderRehearsalAvailable: true, valioStubMode: true,
  });
  await rehearse(await prepare(`${availableDate}T18:00:00Z`), "buyer_approval", "Buyer approval");

  const delegated = { ...policy, automaticLimitCents: 200_000 };
  try {
    await json(post("/api/policy", delegated, buyerHeaders));
    assert.deepEqual((await call("get_account_context")).policy, delegated);
    await rehearse(await prepare(), "account_policy", "Account policy");
    await rehearse(await prepareAfterOmission(), "buyer_approval", "Blocked rice omitted with buyer approval");
  } finally {
    await json(post("/api/policy", policy, buyerHeaders));
  }
  console.log("Account and MCP rehearsal passed using synthetic supplier stock and prices.");
} finally {
  await client.close();
}
