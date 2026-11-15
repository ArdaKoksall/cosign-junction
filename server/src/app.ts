import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { z } from "zod";
import { createLiveAdapter, type CatalogAdapter } from "@cosign/adapters";
import type { PurchaseRepository } from "./purchasing/repository.js";
import { PurchasingService } from "./purchasing/service.js";
import { RoutineMilk } from "./purchasing/routine-milk.js";
import { registerPurchasingRoutes, type PurchasingActor } from "./routes/purchasing.js";
import { registerValioRoutes } from "./routes/valio.js";
import { registerValioCatalogProductRoute } from "./routes/valio-catalog.js";
import { registerOpenApi } from "./routes/openapi.js";
import { registerIntakeRoute } from "./routes/intake.js";

const materials = new URL("../../aimo_resources/challenge_portal/", import.meta.url);

export async function buildApp(
  store: PurchaseRepository,
  options: {
    now?: () => Date;
    enableSimulator?: boolean;
    adapter?: CatalogAdapter;
    readiness?: () => Promise<void>;
    nvidiaApiKey?: string;
    actor?: PurchasingActor;
    rehearsalActor?: PurchasingActor;
  } = {},
) {
  const app = Fastify({ logger: false });
  const now = options.now ?? (() => new Date());
  const simulator = options.enableSimulator === true;
  const rehearsalActor = simulator ? undefined : options.rehearsalActor;
  const valio = options.adapter ?? createLiveAdapter({
    catalogPath: fileURLToPath(new URL("valio_aimo_junction26_product_data.json", materials)),
    reliabilityPath: fileURLToPath(new URL("valio_aimo_junction26_delivery_reliability.csv", materials)),
    carbonPath: fileURLToPath(new URL("valio_aimo_junction26_carbon_footprint.csv", materials)),
  });

  await app.register(cors, {
    origin: [/^http:\/\/localhost(?::\d+)?$/, /^http:\/\/127\.0\.0\.1(?::\d+)?$/],
  });

  app.get("/healthz", async (_req, reply) => {
    try {
      await options.readiness?.();
      return { ready: true };
    } catch {
      return reply.code(503).send({ ready: false });
    }
  });

  app.get("/api/capabilities", async () => ({
    mode: simulator ? "simulator" : "valio_challenge",
    supplierLookup: true,
    supplierCheckout: false,
    simulatorEnabled: simulator,
    ...(rehearsalActor && { connectedRehearsalEnabled: true }),
    intakeEnabled: !simulator,
    intakePhotoEnabled: !simulator && Boolean(options.nvidiaApiKey),
    ...(options.actor ? { purchasingAuthRequired: true } : {}),
  }));
  const actor = options.actor;
  if (actor) {
    app.get("/api/session", async (req) => ({ actorId: actor(req, "read") }));
  } else if (rehearsalActor) {
    app.get("/api/session", async (req) => ({ actorId: rehearsalActor(req, "buyer") }));
  }

  registerOpenApi(app);
  registerValioRoutes(app, valio, Boolean(rehearsalActor));
  registerValioCatalogProductRoute(app, valio);
  if (!simulator) registerIntakeRoute(app, {
    apiKey: options.nvidiaApiKey, now, adapter: valio,
    supplierPricing: valio.kind === "VALIO_LIVE" && Boolean(options.adapter || process.env.VALIO_API_KEY),
  });
  registerPurchasingRoutes(app, new PurchasingService(store, valio, now, simulator), store, {
    simulator, actor, rehearsalActor, now, routine: simulator && actor ? new RoutineMilk(store, now) : undefined,
    catalog: simulator ? undefined : () => valio.loadCatalog(),
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof z.ZodError) return reply.code(400).send({ error: "invalid_body", issues: err.issues });
    const status = err instanceof Error && "statusCode" in err && typeof err.statusCode === "number" ? err.statusCode : 500;
    if (status === 500) console.error("Request failed", err instanceof Error ? err.name : "Unknown error");
    return reply.code(status).send({ error: status >= 500 && status !== 501 && status !== 502
      ? "Internal error"
      : err instanceof Error ? err.message : "Request failed" });
  });

  return app;
}
