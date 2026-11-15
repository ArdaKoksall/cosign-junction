import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { TradeError, type Actor } from "./db.js";
import {
  policySchema,
  readTools,
  requestChangeSchema,
  toolDescriptions,
  toolSchemas,
  toolScope,
  type ToolName,
  type TradeService,
} from "./service.js";

const receipt = z.looseObject({
  receiptId: z.string(),
  kind: z.literal("order_rehearsal"),
  submittedToSupplier: z.literal(false),
  revision: z.number().int().positive(),
  totalCents: z.number().int().nonnegative(),
  currency: z.literal("EUR"),
  moneyBasis: z.literal("VAT_EXCLUSIVE"),
  createdAt: z.iso.datetime(),
  authorization: z.enum(["buyer_approval", "account_policy"]),
});

const supplierOffer = z.looseObject({
  productId: z.string(),
  name: z.string(),
  salesUnit: z.string(),
  salesUnitPriceCents: z.number().int().nullable()
    .describe("Observed price in EUR cents per supplier sales unit, excluding VAT."),
  availableSellUnits: z.number().nullable(),
  availableDate: z.string().nullable(),
  closingTime: z.string().nullable(),
  stockUnknown: z.boolean(),
  issues: z.array(z.string()),
  reliability: z.number().nullable(),
  carbon: z.number().nullable(),
  eligible: z.boolean().optional(),
  reasons: z.array(z.string()).optional(),
});
const supplierComparison = z.looseObject({
  id: z.string(),
  status: z.string(),
  observedAt: z.string().optional(),
  observations: z.array(supplierOffer).optional(),
  deliveryOffers: z.array(supplierOffer).optional(),
});
const comparison = z.union([
  supplierComparison,
  z.looseObject({
    items: z.array(supplierComparison.extend({ itemId: z.string() })),
    basketPlan: z.looseObject({
      status: z.string(),
      selections: z.array(z.looseObject({
        itemId: z.string(), productId: z.string(), availableDate: z.string(),
      })).optional(),
      explanation: z.object({
        basis: z.literal("earliest_completion_then_lowest_total"),
        completionDate: z.iso.date(),
        priceOptimal: z.boolean().describe("True if this is the lowest total among the checked offers that satisfy the active constraints on this completion date."),
      }).optional(),
    }).optional(),
  }),
]).nullable();
const draft = z.looseObject({ totalCents: z.number().int().nonnegative(), caveats: z.array(z.string()) }).nullable();

const runResult = z.looseObject({
  id: z.string().describe("Pass this ID as runId in later calls."),
  revision: z.number().int().nonnegative().describe("Use this revision for the next edit, draft or order."),
  status: z.string(),
  reviewUrl: z.url().describe("Buyer review in the Cosign workspace."),
  supplierCheckoutAvailable: z.boolean(),
  orderRehearsalAvailable: z.boolean(),
  requestChanges: z.array(requestChangeSchema).optional().describe("Agent-proposed material changes the buyer reviews with this draft."),
  approvalEligibility: z.looseObject({ eligible: z.boolean(), reasons: z.array(z.string()) }).optional(),
  receipt: receipt.nullable().optional(),
});

const resultSchemas: Record<ToolName, z.ZodObject> = {
  get_account_context: z.looseObject({
    name: z.string(),
    policy: policySchema,
    supplierCheckoutAvailable: z.boolean(),
    orderRehearsalAvailable: z.boolean(),
    valioStubMode: z.literal(true).optional().describe("Supplier prices and stock in this workspace come from the demo stub."),
    currency: z.literal("EUR"),
    moneyBasis: z.literal("VAT_EXCLUSIVE"),
    timeZone: z.literal("Europe/Helsinki"),
  }),
  list_requests: z.looseObject({ requests: z.array(z.looseObject({
    id: z.string(), title: z.string(), status: z.string(), reviewUrl: z.url(),
  })) }),
  get_activity: z.looseObject({ runId: z.string(), events: z.array(z.looseObject({
    action: z.string(), status: z.string(), data: z.unknown(),
  })) }),
  browse_catalog: z.looseObject({
    products: z.array(z.looseObject({ id: z.string(), name: z.string(), salesUnit: z.string() })),
    offset: z.number().int(), limit: z.number().int(), hasMore: z.boolean(), pricesIncluded: z.literal(false),
  }),
  get_product_details: z.looseObject({ product: z.looseObject({ id: z.string() }), pricesIncluded: z.literal(false) }),
  create_request: runResult.extend({ runId: z.string() }),
  update_request_preferences: runResult,
  amend_request: runResult,
  remove_request_items: runResult,
  search_products: z.looseObject({
    products: z.array(z.looseObject({ id: z.string(), name: z.string(), salesUnit: z.string() })),
    itemId: z.string().optional(),
  }),
  compare_products: runResult.extend({
    comparison,
    itemAvailability: z.record(z.string(), z.looseObject({ status: z.string(), reasons: z.array(z.string()) })),
  }),
  prepare_order: runResult.extend({ draft }),
  get_request_status: runResult.extend({ draft: draft.optional(), comparison: comparison.optional() }),
  place_order: z.looseObject({
    runId: z.string(),
    status: z.literal("completed"),
    receipt,
  }),
};
const errorSchema = z.strictObject({ error: z.string(), message: z.string() });
const advertisedInputs = {
  ...toolSchemas,
  place_order: toolSchemas.place_order.required({ mode: true }),
};

const titles: Record<ToolName, string> = {
  get_account_context: "Read purchasing authority",
  list_requests: "List purchase requests",
  get_activity: "Read request activity",
  browse_catalog: "Browse the Aimo catalog",
  get_product_details: "Read product details",
  create_request: "Create a purchase request",
  update_request_preferences: "Edit budget or delivery preferences",
  amend_request: "Edit a request item",
  remove_request_items: "Remove request items",
  search_products: "Find alternatives",
  compare_products: "Check prices and availability",
  prepare_order: "Prepare a draft for review",
  get_request_status: "Check request and approval status",
  place_order: "Record a rehearsal order",
};

const workflow = [
  "Use supplier evidence and account-owned purchase requests. Start with get_account_context to read authority and capabilities. When valioStubMode is true, label supplier prices and stock as simulated in the demo workspace.",
  "Use browse_catalog to find products before creating a request. Pass a productId when the buyer specifies an exact catalog product, or keep their description as a query. If a price and availability lookup fails, use search_products on each affected request line to identify catalog matches and report their prices and stock as unverified.",
  "Group products for one purchase in create_request.items. Ask about ambiguous quantities or units. Budget and delivery date are optional. Use hard limits for strict buyer requirements and preferred modes for targets.",
  "Call compare_products for targeted prices and stock. Use basketPlan.explanation to explain the recommendation when present. Discuss delivery reliability and carbon evidence separately where available. Explain deviations from buyer targets and treat missing supplier results as unverified.",
  "If a line is blocked, read itemAvailability. Offer a fresh check, a suitable replacement, a smaller quantity supported by observedCoverage, or a partial basket when available. Wait for the buyer to choose before editing. Compare again after an edit.",
  "Use the latest comparison revision to prepare_order. Include any requestChanges when explaining the draft. When the draft needs approval, give the buyer its reviewUrl and wait for a decision. Use get_request_status to check the exact revision before proceeding.",
];

function toolResult(result: Record<string, unknown>, isError = false) {
  return {
    ...(isError && { isError: true }),
    content: [{ type: "text" as const, text: JSON.stringify(result) }],
    structuredContent: result,
  };
}

export function createTradeMcpServer(
  service: Pick<TradeService, "execute">,
  actor: Actor,
  orderRehearsalAvailable: boolean,
) {
  const checkout = orderRehearsalAvailable
    ? "When the buyer requests an order rehearsal, place_order with mode rehearsal records the authorized fixed draft as a local rehearsal receipt. Reuse the same idempotencyKey on retries. Report the receipt as a local simulation."
    : "Supplier checkout is unavailable. Report the latest draft or approval state.";
  const server = new Server(
    { name: "cosign", title: "VALIO:Cosign", version: "1.0.0" },
    { capabilities: { tools: {} }, instructions: [...workflow, checkout].join("\n") },
  );
  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: (Object.keys(toolSchemas) as ToolName[])
      .filter(name => name !== "place_order" || orderRehearsalAvailable)
      .map(name => ({
        name,
        title: titles[name],
        description: toolDescriptions[name],
        inputSchema: { ...z.toJSONSchema(advertisedInputs[name], { io: "input" }), type: "object" as const },
        outputSchema: {
          ...z.toJSONSchema(z.union([resultSchemas[name], errorSchema])),
          type: "object" as const,
        },
        annotations: {
          readOnlyHint: readTools.includes(name),
          destructiveHint: name === "remove_request_items" || name === "place_order",
          idempotentHint: readTools.includes(name) || name === "place_order",
          openWorldHint: name === "compare_products",
        },
        _meta: { securitySchemes: [{ type: "oauth2", scopes: [toolScope(name)] }] },
      })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async ({ params: { name, arguments: args } }) => {
    if (!Object.hasOwn(toolSchemas, name)) {
      return toolResult({ error: "unknown_tool", message: "Unknown purchasing tool. Refresh the available tools." }, true);
    }
    try {
      const result = await service.execute(actor, name as ToolName, args ?? {});
      const validated = resultSchemas[name as ToolName].safeParse(result);
      if (!validated.success) {
        return toolResult({ error: "invalid_result", message: "The workspace returned an unexpected response. Check the request status." }, true);
      }
      return toolResult(validated.data);
    } catch (error) {
      if (error instanceof TradeError) {
        return toolResult({ error: error.code, message: error.message }, true);
      }
      if (error instanceof z.ZodError) {
        return toolResult({ error: "invalid_input", message: z.prettifyError(error) }, true);
      }
      console.error("MCP tool failed", name, error instanceof Error ? error.name : "Error");
      return toolResult({ error: "operation_failed", message: "Check the request status before retrying." }, true);
    }
  });
  return server;
}
