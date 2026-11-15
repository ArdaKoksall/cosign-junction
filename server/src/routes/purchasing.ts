import { closestCatalogMatches, productRequirements, type CatalogIndex } from "@cosign/adapters";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { httpError } from "../http-error.js";
import type { PurchaseRepository } from "../purchasing/repository.js";
import type { PurchasingService } from "../purchasing/service.js";
import type { CompareResponse, OrderRecord, ProposalRecord, RequestRecord } from "../purchasing/types.js";
import { supplierDecision } from "../purchasing/supplier-decision.js";
import { rehearsalCandidates } from "../purchasing/connected-rehearsal.js";
import type { RoutineMilk } from "../purchasing/routine-milk.js";
import { requestUnits } from "../purchasing/quantity.js";
import { allergenCode, requestedProductRequirements } from "../purchasing/requirements.js";
import { rankingObjectiveSchema } from "../purchasing/ranking-objective.js";

const catalogProductId = z.string().trim().min(1).max(32);
const sharedRequestBody = z.object({
  deadline: z.iso.datetime({ offset: true }),
  diet: z.enum(["none", "lactose-free"]).default("none"),
  requirements: z.array(z.enum(productRequirements)).max(productRequirements.length).optional(),
  freeFromAllergen: z.array(allergenCode).max(30).optional(),
  rankingObjective: rankingObjectiveSchema.optional().describe("Buyer-confirmed preference for ranking connected supplier observations."),
  budgetCents: z.number().int().nonnegative(),
  productId: catalogProductId.optional(),
  preset: z.literal("monday_milk").optional(),
}).strict();
const queryText = z.string().trim().min(1).max(120);
const measuredRequest = sharedRequestBody.extend({ quantity: z.number().min(0.001).max(1_000_000).multipleOf(0.001), unit: z.enum(requestUnits) });
export const requestBody = z.union([
  sharedRequestBody.extend({ quantityLiters: z.number().int().min(1).max(1_000_000), query: queryText.default("milk") }),
  measuredRequest.extend({ productId: catalogProductId, query: queryText.optional() }),
  measuredRequest.extend({ query: queryText }),
]);

export const versionBody = z.object({ version: z.number().int().positive() });
export const commitBody = versionBody.extend({ idempotencyKey: z.string().min(1).max(200) });
export const rehearsalBody = versionBody.extend({ productId: catalogProductId }).strict();
const priceChangeBody = z.object({ proposalId: z.string().min(1) });
const requestListQuery = z.object({
  query: z.string().trim().max(120).regex(/^[^\0]*$/u).optional(),
  limit: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(50)).default(50),
  cursor: z.base64url().min(1).max(1024).optional(),
});
const requestCursor = z.object({ createdAt: z.iso.datetime({ offset: true }), id: z.string().min(1).regex(/^[^\0]*$/u) }).strict();

function decodeRequestCursor(cursor: string) {
  try {
    return requestCursor.parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")));
  } catch {
    throw httpError(400, "Invalid saved request cursor");
  }
}

type Params = { Params: { id: string } };

function comparison(proposal: ProposalRecord, request?: RequestRecord, rehearsalAt?: Date): CompareResponse {
  const { id, approvedVersion, events, observationSequence, connectedRehearsal, ...response } = proposal;
  return {
    ...response,
    proposalId: id,
    ...(proposal.observations && { decision: supplierDecision(proposal.observations, request?.rankingObjective) }),
    ...(rehearsalAt && request && { rehearsalCandidates: rehearsalCandidates(proposal, request, rehearsalAt) }),
  };
}

function receipt(order: OrderRecord) {
  const { requestId, proposalId, version, idempotencyKey, ...response } = order;
  return { ...response, ...(order.rehearsal && { simulated: true as const }) };
}

export type PurchasingActor = (request: FastifyRequest, access: "read" | "buyer") => string;

export function registerPurchasingRoutes(
  app: FastifyInstance,
  service: PurchasingService,
  store: PurchaseRepository,
  options: {
    simulator: boolean;
    actor?: PurchasingActor;
    rehearsalActor?: PurchasingActor;
    now: () => Date;
    routine?: RoutineMilk;
    catalog?: () => Promise<CatalogIndex>;
  },
) {
  const { simulator, actor, rehearsalActor, now } = options;

  /** Adds the nearest catalog products when no product had every required declaration. */
  async function withClosest(response: CompareResponse, request?: RequestRecord): Promise<CompareResponse> {
    if (response.decision?.outcome !== "no_match" || !request || !options.catalog) return response;
    const matches = closestCatalogMatches(await options.catalog(), {
      query: request.query,
      requirements: requestedProductRequirements(request.diet, request.requirements),
      freeFromAllergens: request.freeFromAllergen,
      limit: 3,
    });
    return {
      ...response,
      closestProducts: matches.map(({ product, mismatches, healthRisk }) => ({ productId: product.id, name: product.displayName, healthRisk, mismatches })),
    };
  }
  function requireSimulator() {
    if (!simulator) throw httpError(501, "Supplier ordering is not configured; the documented Valio API supports lookup only");
  }

  function requireRehearsal(req: FastifyRequest) {
    if (!rehearsalActor) throw httpError(501, "Connected checkout rehearsal is not enabled");
    return rehearsalActor(req, "buyer");
  }

  function checkoutBuyer(req: FastifyRequest) {
    if (simulator) return actor?.(req, "buyer");
    if (!rehearsalActor) requireSimulator();
    return requireRehearsal(req);
  }

  app.post("/api/requests", async (req, reply) => {
    const actorId = actor?.(req, "read");
    const input = requestBody.parse(req.body);
    const requirements = requestedProductRequirements(input.diet, input.requirements, simulator ? undefined : input.query);
    const freeFromAllergen = [...new Set(input.freeFromAllergen)].sort();
    if (simulator && (requirements.some((requirement) => requirement !== "lactose-free") || freeFromAllergen.length > 0)) {
      throw httpError(400, "Additional product requirements are available in connected requests");
    }
    const diet = requirements.includes("lactose-free") ? "lactose-free" : "none";
    const { quantity, unit } = "quantityLiters" in input ? { quantity: input.quantityLiters, unit: "L" as const } : input;
    if ((unit === "each" || unit === "case") && !Number.isInteger(quantity)) {
      throw httpError(400, "Items and cases must be requested in whole numbers");
    }
    if (input.preset && (unit !== "L" || diet !== "lactose-free")) {
      throw httpError(400, "The Monday milk preset requires lactose-free milk measured in litres");
    }
    const volume = unit === "L" ? quantity : unit === "ml" ? quantity / 1000 : null;
    const savedRequirements = requirements.length > 0 && (!simulator || input.requirements !== undefined) ? requirements : undefined;
    const request = await service.create({
      ...input, diet, requirements: savedRequirements, freeFromAllergen: freeFromAllergen.length ? freeFromAllergen : undefined, quantity, unit,
      quantityLiters: Number.isInteger(volume) ? volume : null,
    }, actorId);
    return reply.code(201).send({
      requestId: request.id,
      ...(diet !== input.diet && { diet }),
      ...(savedRequirements && { requirements: savedRequirements }),
    });
  });

  app.get("/api/requests", async (req) => {
    actor?.(req, "read");
    const { query, limit, cursor } = requestListQuery.parse(req.query);
    const rows = await store.listRequests({ limit: limit + 1, query, before: cursor ? decodeRequestCursor(cursor) : undefined });
    const requests = rows.slice(0, limit);
    const last = requests.at(-1);
    const nextCursor = last && rows.length > limit
      ? Buffer.from(JSON.stringify({ createdAt: last.createdAt, id: last.id })).toString("base64url")
      : null;
    return { requests, nextCursor };
  });

  app.get<Params>("/api/requests/:id", async (req) => {
    actor?.(req, "read");
    const detail = await store.readRequestDetail(req.params.id);
    if (!detail) throw httpError(404, "request not found");
    const { request, proposal, placedOrderId } = detail;
    return {
      request,
      comparison: proposal ? await withClosest(comparison(proposal, request, rehearsalActor ? now() : undefined), request) : null,
      approvedVersion: simulator ? proposal?.approvedVersion ?? null : null,
      placedOrderId: simulator ? placedOrderId : null,
      events: proposal?.events ?? [],
    };
  });

  app.post<Params>("/api/requests/:id/compare", async (req) => {
    const actorId = actor?.(req, "read");
    const { proposal, request } = await service.compare(req.params.id, actorId);
    return withClosest(comparison(proposal, request, rehearsalActor ? now() : undefined), request);
  });

  app.post<Params>("/api/requests/:id/rehearsal", async (req, reply) => {
    const actorId = requireRehearsal(req);
    const { version, productId } = rehearsalBody.parse(req.body);
    return reply.code(201).send(comparison(await service.rehearse(req.params.id, version, productId, actorId)));
  });

  app.get<Params>("/api/requests/:id/rehearsal", async (req) => {
    requireRehearsal(req);
    const detail = await store.readRequestRehearsal(req.params.id);
    if (!detail) throw httpError(404, "request not found");
    const { proposal, placedOrderId } = detail;
    return {
      quote: proposal ? comparison(proposal) : null,
      approvedVersion: proposal?.approvedVersion ?? null,
      placedOrderId,
      events: proposal?.events ?? [],
    };
  });

  app.post<Params>("/api/proposals/:id/approve", async (req) => {
    const actorId = checkoutBuyer(req);
    return service.approve(req.params.id, versionBody.parse(req.body).version, actorId);
  });

  app.post<Params>("/api/proposals/:id/commit", async (req, reply) => {
    const actorId = checkoutBuyer(req);
    const { version, idempotencyKey } = commitBody.parse(req.body);
    if (idempotencyKey.startsWith("mandate:")) throw httpError(400, "Reserved idempotency key prefix");
    return reply.code(201).send(receipt(await service.commit(req.params.id, version, idempotencyKey, actorId)));
  });

  app.get("/api/orders", async (req) => {
    actor?.(req, "read");
    if (!simulator && !rehearsalActor) return { orders: [] };
    if (!simulator) requireRehearsal(req);
    return {
      orders: (await store.listOrders(50, !simulator)).map(({ orderId, status, totalCents, events }) => ({
        orderId, status, totalCents, savedAt: events.find((event) => event.action === "commit")?.at ?? "",
      })),
    };
  });

  app.get<Params>("/api/orders/:id", async (req) => {
    actor?.(req, "read");
    if (!simulator && !rehearsalActor) throw httpError(404, "No supplier order is available; supplier ordering is not configured");
    if (!simulator) requireRehearsal(req);
    const order = await store.findOrder(req.params.id);
    if (!order || Boolean(order.rehearsal) === simulator) throw httpError(404, "order not found");
    return receipt(order);
  });

  app.post("/api/demo/price-change", async (req) => {
    requireSimulator();
    const actorId = actor?.(req, "buyer");
    return comparison(await service.reprice(priceChangeBody.parse(req.body).proposalId, actorId));
  });

  app.post("/api/demo/reset", async (req) => {
    requireSimulator();
    actor?.(req, "buyer");
    await store.transaction((tx) => tx.clear());
    return { reset: true };
  });

  const routine = options.routine;
  if (simulator && actor && routine) {
    app.get("/api/simulator/routine-milk", async (req) => {
      actor(req, "read");
      return routine.status();
    });
    app.post("/api/simulator/routine-milk/mandate", async (req) => {
      actor(req, "buyer");
      const input = z.object({ active: z.boolean(), maxTotalCents: z.number().int().nonnegative() }).strict().parse(req.body);
      return routine.setMandate(input.active, input.maxTotalCents);
    });
    app.post("/api/simulator/routine-milk/run", async (req, reply) => {
      const actorId = actor(req, "read");
      const input = z.object({ period: z.iso.date() }).strict().parse(req.body);
      return reply.code(201).send(receipt(await routine.run(input.period, actorId)));
    });
  }
}
