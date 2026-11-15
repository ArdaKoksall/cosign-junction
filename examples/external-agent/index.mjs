const base = new URL(process.env.COSIGN_URL ?? "http://localhost:8081");
const token = process.env.COSIGN_AGENT_TOKEN;
const headers = { accept: "application/json", ...(token && { authorization: `Bearer ${token}` }) };

async function call(path, body) {
  const response = await fetch(new URL(path, base), {
    method: body === undefined ? "GET" : "POST",
    headers: { ...headers, ...(body !== undefined && { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`${response.status} ${result.error}`);
  return result;
}

const capabilities = await call("/api/capabilities");
if (capabilities.purchasingAuthRequired && !token) throw new Error("Set COSIGN_AGENT_TOKEN");
if (process.argv[2] === "--routine-milk") {
  if (!capabilities.simulatorEnabled) throw new Error("Routine purchases are available on the simulator");
  const { period } = await call("/api/simulator/routine-milk");
  const order = await call("/api/simulator/routine-milk/run", { period });
  console.log(JSON.stringify(order, null, 2));
  process.exit(0);
}
const deadline = process.env.COSIGN_DEADLINE ?? new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
const productId = capabilities.mode === "valio_challenge" ? process.env.COSIGN_PRODUCT_ID : undefined;
const { requestId } = await call("/api/requests", {
  query: "milk", diet: "lactose-free", quantityLiters: 1000,
  budgetCents: capabilities.connectedRehearsalEnabled ? 300000 : 145000, deadline,
  ...(productId && { productId }),
});
const comparison = await call(`/api/requests/${encodeURIComponent(requestId)}/compare`, {});
const handoff = new URL("/", base);
handoff.searchParams.set("request", requestId);
console.log(JSON.stringify({
  mode: capabilities.mode,
  requestId,
  revision: comparison.version,
  decision: comparison.decision ?? { status: comparison.status, totalCents: comparison.totalCents },
  handoff: handoff.href,
  nextStep: capabilities.simulatorEnabled ? "Buyer reviews the simulated basket"
    : comparison.rehearsalCandidates?.length ? "Buyer reviews the supplier evidence and can prepare a simulated quote on this request"
      : "Buyer reviews the supplier evidence",
}, null, 2));
