import { buildApp } from "./app.js";
import { PrismaPurchaseRepository } from "./prisma-repository.js";
import { databaseUrl, loadRootEnv } from "./environment.js";
import { simulatorAccess } from "./routes/simulator-access.js";

loadRootEnv();

if (process.env.COSIGN_RUNTIME !== "legacy") {
  const { buildTradeApp } = await import("./trade/app.js");
  const { openTradeTunnel } = await import("./trade/tunnel.js");
  const token = process.env.NGROK_TOKEN?.trim();
  const tunnel = token ? { token, domain: process.env.NGROK_DOMAIN?.trim().toLowerCase() ?? "" } : undefined;
  if (tunnel && !/^(?:[a-z0-9-]+\.)+[a-z0-9-]+$/.test(tunnel.domain)) {
    throw new Error("Set NGROK_DOMAIN to the tunnel hostname when NGROK_TOKEN is set");
  }
  const origin = tunnel ? `https://${tunnel.domain}` : process.env.PUBLIC_ORIGIN;
  const connection = databaseUrl();
  if (!connection || !origin || !process.env.VALIO_API_KEY || !process.env.OAUTH_ENCRYPTION_KEY) {
    throw new Error("Set DATABASE_URL or POSTGRES_PASSWORD, OAUTH_ENCRYPTION_KEY, VALIO_API_KEY, and either PUBLIC_ORIGIN or both ngrok settings");
  }
  const runtime = await buildTradeApp({ connection, origin,
    apiKey: process.env.VALIO_API_KEY, encryptionKey: process.env.OAUTH_ENCRYPTION_KEY, nvidiaKey: process.env.NVIDIA_API_KEY, model: process.env.NEMOTRON_MODEL,
    enableOrderRehearsal: process.env.COSIGN_ENABLE_ORDER_REHEARSAL === "true",
    valioStubMode: process.env.COSIGN_VALIO_STUB_MODE === "true" });
  const upstream = process.env.NGROK_UPSTREAM ?? `http://127.0.0.1:${process.env.COSIGN_WEB_PORT || 8080}`;
  const tunnelListener = tunnel ? await openTradeTunnel(tunnel.token, tunnel.domain, upstream).catch(async error => {
    await runtime.close();
    throw error;
  }) : undefined;
  const listener = runtime.app.listen(Number(process.env.PORT ?? 3001), process.env.HOST ?? "127.0.0.1");
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => {
    listener.close();
    void Promise.allSettled([runtime.close(), tunnelListener?.close()]).then(() => process.exit(0));
  });
  console.log("Cosign production service started");
  if (tunnelListener) console.log("Cosign ngrok tunnel active");
} else {
const simulator = process.env.COSIGN_ENABLE_SIMULATOR === "true";
const connection = databaseUrl(simulator);
if (!connection) {
  throw new Error(`Set ${simulator ? "SIMULATOR_DATABASE_URL" : "DATABASE_URL"} or POSTGRES_PASSWORD before starting Cosign`);
}
if (simulator && databaseUrl() === connection) {
  throw new Error("Use a separate database for simulated purchasing");
}
const rehearsal = !simulator && process.env.COSIGN_ENABLE_CONNECTED_REHEARSAL === "true";
const access = simulator || rehearsal ? simulatorAccess(process.env.COSIGN_BUYER_TOKEN, process.env.COSIGN_AGENT_TOKEN) : undefined;

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "127.0.0.1";
const store = new PrismaPurchaseRepository(connection);
try {
  await store.checkConnection();
  const app = await buildApp(store, {
    enableSimulator: simulator,
    actor: simulator ? access : undefined,
    rehearsalActor: rehearsal ? access : undefined,
    nvidiaApiKey: process.env.NVIDIA_API_KEY || undefined,
    readiness: () => store.checkConnection(),
  });
  app.addHook("onClose", () => store.close());
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => void app.close());
  await app.listen({ port, host });
  console.log(`Cosign ${simulator ? "simulator" : "connected API"} listening on ${host}:${port}`);
} catch (error) {
  await store.close();
  throw error;
}

}
