import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TradeError, type Actor } from "../src/trade/db.js";
import { createTradeMcpServer } from "../src/trade/mcp.js";
import { toolSchemas, toolScope, type TradeService } from "../src/trade/service.js";

const actor: Actor = {
  accountId: "buyer",
  actorId: "connector",
  source: "mcp",
  scopes: ["catalog:read", "requests:write"],
};
const run = {
  id: "example",
  revision: 4,
  status: "awaiting_approval",
  reviewUrl: "https://cosign.invalid/?run=example",
  supplierCheckoutAvailable: false,
  orderRehearsalAvailable: true,
  draft: { totalCents: 1200, caveats: [] },
};

async function connect(orderRehearsalAvailable = false, caller = actor) {
  const execute = vi.fn<TradeService["execute"]>().mockImplementation(async (actor, name, args) => {
    if (!actor.scopes.includes(toolScope(name))) {
      throw new TradeError(403, "insufficient_scope", `Required permission: ${toolScope(name)}`);
    }
    toolSchemas[name].parse(args);
    return run;
  });
  const server = createTradeMcpServer({ execute }, caller, orderRehearsalAvailable);
  const client = new Client({ name: "cosign-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, execute };
}

describe("Cosign MCP contracts", () => {
  let client: Client | undefined;
  afterEach(async () => { await client?.close(); });

  it("publishes typed, scoped tool definitions and omits checkout when disabled", async () => {
    ({ client } = await connect());
    const { tools } = await client.listTools();
    expect(tools.map(tool => tool.name)).not.toContain("place_order");
    expect(tools.find(tool => tool.name === "compare_products")).toMatchObject({
      title: "Check prices and availability",
      inputSchema: { type: "object", required: ["runId"] },
      outputSchema: {
        type: "object",
        anyOf: expect.arrayContaining([
          expect.objectContaining({ properties: expect.objectContaining({ itemAvailability: { type: "object", propertyNames: { type: "string" }, additionalProperties: expect.any(Object) } }) }),
        ]),
      },
      annotations: { readOnlyHint: false, openWorldHint: true },
      _meta: { securitySchemes: [{ type: "oauth2", scopes: ["requests:write"] }] },
    });
  });

  it("returns the same data through the structured and text representations", async () => {
    ({ client } = await connect(true));
    await client.listTools();
    const result = await client.callTool({
      name: "prepare_order",
      arguments: { runId: run.id, revision: run.revision, productId: "M1" },
    });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual(run);
    expect(JSON.parse((result.content as { text: string }[])[0].text)).toEqual(run);
  });

  it("returns machine-readable input, authorization and discovery errors", async () => {
    ({ client } = await connect(true));
    const { tools } = await client.listTools();
    expect(tools.find(tool => tool.name === "place_order")).toMatchObject({
      inputSchema: {
        properties: { mode: { const: "rehearsal" } },
        required: expect.arrayContaining(["mode"]),
      },
      _meta: { securitySchemes: [{ type: "oauth2", scopes: ["orders:write"] }] },
    });
    const invalid = await client.callTool({ name: "create_request", arguments: {} });
    expect(invalid).toMatchObject({ isError: true, structuredContent: { error: "invalid_input" } });
    const forbidden = await client.callTool({
      name: "place_order",
      arguments: { runId: run.id, revision: run.revision, mode: "rehearsal", idempotencyKey: "an-example-key-123" },
    });
    expect(forbidden).toMatchObject({ isError: true, structuredContent: { error: "insufficient_scope" } });
    const unknown = await client.callTool({ name: "approve_order", arguments: {} });
    expect(unknown).toMatchObject({ isError: true, structuredContent: { error: "unknown_tool" } });
  });

  it("advertises and validates the rehearsal receipt through the SDK", async () => {
    const caller = { ...actor, scopes: [...actor.scopes, "orders:write"] };
    const connection = await connect(true, caller);
    client = connection.client;
    const receipt = {
      receiptId: "rehearsal_example",
      kind: "order_rehearsal",
      submittedToSupplier: false,
      revision: run.revision,
      totalCents: run.draft.totalCents,
      currency: "EUR",
      moneyBasis: "VAT_EXCLUSIVE",
      createdAt: "2030-11-15T12:00:00.000Z",
      authorization: "buyer_approval",
    };
    connection.execute.mockResolvedValueOnce({ runId: run.id, status: "completed", receipt });
    await client.listTools();
    const args = { runId: run.id, revision: run.revision, mode: "rehearsal", idempotencyKey: "an-example-key-123" };
    const result = await client.callTool({ name: "place_order", arguments: args });
    expect(connection.execute).toHaveBeenCalledWith(caller, "place_order", args);
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({ runId: run.id, status: "completed", receipt });
  });
});
