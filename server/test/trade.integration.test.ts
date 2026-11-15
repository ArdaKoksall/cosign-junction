import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, createHash } from "node:crypto";
import { Pool } from "pg";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  calendarDateInHelsinki,
  shortlistCatalog,
  type CatalogAdapter,
  type CatalogIndex,
  type CatalogProduct,
  type LookupResult,
  type SourceProvenance,
} from "@cosign/adapters";
import { buildTradeApp } from "../src/trade/app.js";
import { passwordHash } from "../src/trade/password.js";
import { TradeError, type Actor } from "../src/trade/db.js";
import { SCOPES } from "../src/trade/oauth.js";
import { TradeService, type ToolName } from "../src/trade/service.js";

const catalogSource: SourceProvenance = {
  kind: "FIXTURE",
  label: "Integration test catalog",
  observedAt: new Date().toISOString(),
  revision: 1,
};
const deliveryAnchor = Date.now();
const deliveryInstant = (days: number) => new Date(deliveryAnchor + days * 86_400_000);
const deliveryDay = (days: number) => calendarDateInHelsinki(deliveryInstant(days));
const testProducts: {
  id: string;
  query: string;
  name: string;
  packGrams: number | null;
  firstDay: string;
  stock?: "empty" | "missing" | "unknown";
  price?: "missing";
}[] = [
  { id: "chicken", query: "chicken breast", name: "Chicken breast", packGrams: 2_000, firstDay: deliveryDay(1) },
  { id: "rice", query: "rice", name: "Rice", packGrams: 1_000, firstDay: deliveryDay(2) },
  { id: "pasta", query: "pasta", name: "Pasta", packGrams: 1_000, firstDay: deliveryDay(7) },
  { id: "bagged", query: "frozen corn", name: "Frozen corn", packGrams: null, firstDay: deliveryDay(1) },
  { id: "oats", query: "rolled oats", name: "Rolled oats", packGrams: 1_000, firstDay: deliveryDay(1), stock: "empty" },
  { id: "beans", query: "green beans", name: "Green beans", packGrams: 1_000, firstDay: deliveryDay(1), stock: "missing" },
  { id: "peas", query: "garden peas", name: "Garden peas", packGrams: 1_000, firstDay: deliveryDay(1), stock: "unknown" },
  { id: "carrots", query: "carrots", name: "Carrots", packGrams: 1_000, firstDay: deliveryDay(1), price: "missing" },
];
const catalog: CatalogIndex = {
  source: catalogSource,
  products: new Map(testProducts.map(({ id, name, packGrams }) => {
    const bagged = id === "bagged";
    const product: CatalogProduct = {
      id,
      names: [{ language: "en", value: name }],
      displayName: name,
      category: "test",
      vendorName: "Test supplier",
      salesUnit: bagged ? "BAG" : "ST",
      baseUnit: bagged ? "BAG" : "ST",
      allowedLotSize: bagged ? 2 : 1,
      sellUnitIncrement: bagged ? 2 : 1,
      minSellUnits: bagged ? 2 : 1,
      amountPerSellUnit: packGrams,
      amountDimension: packGrams === null ? "unmapped" : "g",
      units: [],
      substituteProductIds: [],
      claims: [
        { id: "FREE_FROM_GLUTEN", group: "nutritionalClaim", status: "VERIFIED_ABSENT", unit: "FREE_FROM" },
      ],
      allergens: [{ id: "AP", group: "allergen", status: "VERIFIED_ABSENT" }],
      packNotes: [],
    };
    if (id === "chicken") {
      product.claims.push({ id: "HIGH_PROTEIN", group: "nutritionalClaim", status: "DECLARED_PRESENT", unit: "HIGH" });
    }
    return [id, product];
  })),
};
let lookupUnavailable = false;
const testAdapter: CatalogAdapter = {
  kind: "FIXTURE",
  loadCatalog: async () => catalog,
  shortlist: async (query) => shortlistCatalog(catalog, query),
  signals: async () => [],
  async lookup({ customer, productIds, requestedDate }) {
    const products = testProducts.filter(({ id }) => productIds.includes(id));
    const closingTime = new Date(Date.now() + 60 * 60 * 1_000).toISOString();
    const errors: LookupResult["errors"] = [];
    if (lookupUnavailable) {
      errors.push({ endpoint: "availability", code: "HTTP_ERROR", detail: "availability returned HTTP 503" });
      errors.push({ endpoint: "price", code: "HTTP_ERROR", detail: "price returned HTTP 503" });
      return { customer, requestedDate, source: catalogSource, errors, prices: [], availability: [] };
    }
    if (products.some(({ stock }) => stock === "missing")) {
      errors.push({ endpoint: "availability", code: "INVALID_RESPONSE", detail: "1 availability records did not match the published contract" });
    }
    if (products.some(({ price }) => price === "missing")) {
      errors.push({ endpoint: "price", code: "INVALID_RESPONSE", detail: "1 price records did not match the published contract" });
    }
    return {
      customer,
      requestedDate,
      source: catalogSource,
      errors,
      prices: products.filter(({ price }) => price !== "missing").map(({ id, firstDay }) => ({
        productId: id,
        quantity: 1,
        usable: true,
        errors: [],
        netPriceFound: true,
        salesUnitPriceExVat: {
          basis: "VAT_EXCLUSIVE",
          currency: "EUR",
          cents: requestedDate === firstDay ? 1_000 : id === "rice" && requestedDate === deliveryDay(3) ? 700 : 1_100,
        },
      })),
      availability: products.filter(({ stock }) => stock !== "missing").map(({ id, firstDay, stock }) => {
        const sameDay = requestedDate >= firstDay;
        const errors: LookupResult["availability"][number]["errors"] = [];
        if (!sameDay) errors.push({ code: "DELIVERY_CONFLICT", detail: "availableDate differs from requestedDate" });
        if (sameDay && stock === "empty") errors.push({ code: "STOCK_SHORT", detail: "No sell units reported" });
        if (stock === "unknown") errors.push({ code: "STOCK_UNKNOWN", detail: "Supplier did not verify stock" });
        return {
          productId: id,
          usable: errors.length === 0,
          errors,
          salesBlock: false,
          stockUnknown: stock === "unknown",
          cutoffPassed: false,
          closingTime,
          availableDate: sameDay ? requestedDate : firstDay,
          availableSellUnits: stock === "unknown" ? undefined : stock === "empty" ? 0 : 20,
          salesUnit: id === "bagged" ? "BAG" : "ST",
        };
      }),
    };
  },
};

const connection = process.env.TEST_TRADE_DATABASE_URL;
describe.skipIf(!connection)("production trade integration", () => {
  const schema = `trade_test_${process.pid}_${randomBytes(4).toString("hex")}`;
  let admin: Pool;
  let runtime: Awaited<ReturnType<typeof buildTradeApp>>;
  const http = createServer();
  let origin: string;
  let cookie: string;
  let token: string;
  let refresh: string;
  let granted: string;
  let runId: string;
  const actor: Actor = {
    accountId: "account-a",
    actorId: "buyer:account-a",
    source: "web",
    scopes: SCOPES,
  };
  const orderActor = { ...actor, accountId: "account-b", actorId: "buyer:account-b" };
  const consentBuyer = { ...actor, accountId: "account-consent", actorId: "buyer:account-consent" };
  const order = (tool: ToolName, args: Record<string, unknown>) =>
    runtime.service.execute(orderActor, tool, args) as Promise<{ runId: string; revision: number }>;
  const line = (productId: string, quantity = 2) => ({ productId, quantity, unit: "kg" });
  const request = {
    query: "milk",
    quantity: 1000,
    unit: "L",
    deadline: "2030-11-18T12:00:00Z",
    budgetCents: 200000,
    requirements: ["lactose-free"],
    freeFromAllergen: [],
  };
  const jsonHeaders = () => ({
    "Content-Type": "application/json",
    Origin: origin,
    "X-Requested-With": "Cosign",
    Cookie: cookie,
  });
  const post = (
    path: string,
    body: unknown,
    headers: Record<string, string> = jsonHeaders(),
  ) =>
    fetch(origin + path, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      redirect: "manual",
    });
  async function authorize(
    method: "none" | "client_secret_post" = "none",
    redirectUri = "http://127.0.0.1:19283/callback",
  ) {
    const registration = await post(
      "/register",
      {
        client_name: "Integration test client",
        redirect_uris: [redirectUri],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: method,
      },
      { "Content-Type": "application/json" },
    );
    expect(registration.status).toBe(201);
    const client = await registration.json();
    const verifier = randomBytes(32).toString("base64url");
    const params = new URLSearchParams({
      response_type: "code",
      client_id: client.client_id,
      redirect_uri: client.redirect_uris[0],
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
      scope: SCOPES.join(" "),
      resource: `${origin}/mcp`,
      state: "test-state",
    });
    const response = await fetch(`${origin}/authorize?${params}`, {
      redirect: "manual",
    });
    expect(response.status).toBe(302);
    const pending = new URL(response.headers.get("location")!).searchParams.get(
      "authorize",
    );
    const consent = await post("/api/oauth/consent", {
      id: pending,
      allow: true,
    });
    expect(consent.status).toBe(200);
    const callback = new URL((await consent.json()).redirect);
    expect(callback.href.split("?")[0]).toBe(redirectUri);
    expect(callback.searchParams.get("iss")).toBe(new URL(origin).href);
    expect(callback.searchParams.get("state")).toBe("test-state");
    return { client, verifier, code: callback.searchParams.get("code")! };
  }
  beforeAll(async () => {
    admin = new Pool({ connectionString: connection });
    await admin.query(`CREATE SCHEMA ${schema}`);
    const scoped = new URL(connection!);
    scoped.searchParams.set("options", `-c search_path=${schema}`);
    const isolated = new Pool({ connectionString: scoped.href });
    for (const migration of [
      "20261114190000_trade_platform",
      "20261115010000_trade_workflow_state",
      "20261115030000_order_rehearsal",
      "20261115050000_trade_request_changes",
    ]) {
      await isolated.query(await readFile(new URL(`../prisma/migrations/${migration}/migration.sql`, import.meta.url), "utf8"));
    }
    await isolated.end();
    await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
    runtime = await buildTradeApp({
      connection: scoped.href,
      origin,
      apiKey: "test-only-unused",
      adapter: testAdapter,
      encryptionKey: randomBytes(32).toString("hex"),
      startWorker: false,
    });
    http.on("request", runtime.app);
    for (const suffix of ["a", "b"])
      await runtime.db.rows(
        "INSERT INTO trade_accounts(id,name,email,password_hash,customer_id) VALUES($1,$2,$3,$4,$5)",
        [
          `account-${suffix}`,
          `Test account ${suffix}`,
          `${suffix}@integration.invalid`,
          await passwordHash("test-password-not-production"),
          `supplier-${suffix}`,
        ],
      );
    await runtime.db.rows(
      "INSERT INTO trade_accounts(id,name,email,password_hash,customer_id,policy) VALUES($1,'Consent buyer','consent@integration.invalid','test-only','supplier-consent',$2)",
      [consentBuyer.accountId, JSON.stringify({ automaticLimitCents: 6_000, requiredClaims: [], freeFromAllergens: [] })],
    );
    const login = await post("/api/login", {
      email: "a@integration.invalid",
      password: "test-password-not-production",
    });
    expect(login.status).toBe(200);
    cookie = login.headers.get("set-cookie")!.split(";")[0];
  }, 30000);
  afterAll(async () => {
    http.closeAllConnections();
    await new Promise<void>((resolve) => http.close(() => resolve()));
    await runtime?.close();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await admin.end();
    }
  });
  it("requires login and rejects cross-origin state changes", async () => {
    expect((await fetch(origin + "/api/runs")).status).toBe(401);
    expect(
      (
        await post(
          "/api/policy",
          {},
          { ...jsonHeaders(), Origin: "https://attacker.invalid" },
        )
      ).status,
    ).toBe(403);
    const capabilities = await (
      await fetch(origin + "/api/capabilities")
    ).json();
    expect(capabilities.mode).toBe("production");
    expect(capabilities.supplierCheckout).toBe(false);
    expect((await post("/api/demo/reset", {})).status).toBe(404);
  });
  it("publishes OAuth discovery and performs PKCE without allowing code replay", async () => {
    const metadata = await (
      await fetch(origin + "/.well-known/oauth-protected-resource/mcp")
    ).json();
    expect(metadata.resource).toBe(origin + "/mcp");
    const flow = await authorize();
    const form = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: flow.client.client_id,
      code: flow.code,
      redirect_uri: flow.client.redirect_uris[0],
      code_verifier: flow.verifier,
      resource: origin + "/mcp",
    });
    const exchange = () =>
      fetch(origin + "/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form,
      });
    const response = await exchange();
    expect(response.status).toBe(200);
    const tokens = await response.json();
    token = tokens.access_token;
    refresh = tokens.refresh_token;
    const info = await runtime.oauth.verifyAccessToken(token);
    granted = String(info.extra!.actorId);
    expect(info.extra!.accountId).toBe("account-a");
    expect((await exchange()).status).toBe(400);
  });
  it.each([
    ["ChatGPT", "https://chatgpt.com/connector_platform_oauth_redirect"],
    ["Claude", "https://claude.ai/api/mcp/auth_callback"],
  ])("supports %s's hosted OAuth callback using dynamic registration", async (_name, redirectUri) => {
    const unauthorized = await fetch(origin + "/mcp");
    expect(unauthorized.status).toBe(401);
    const metadataUrl = origin + "/.well-known/oauth-protected-resource/mcp";
    expect(unauthorized.headers.get("www-authenticate")).toContain(metadataUrl);
    const protectedResource = await (await fetch(metadataUrl)).json();
    const issuer = protectedResource.authorization_servers[0];
    const metadata = await (await fetch(origin + "/.well-known/oauth-authorization-server")).json();
    expect(metadata).toMatchObject({
      issuer,
      authorization_response_iss_parameter_supported: true,
      code_challenge_methods_supported: ["S256"],
      registration_endpoint: origin + "/register",
    });

    const flow = await authorize("none", redirectUri);
    const tokenResponse = await fetch(metadata.token_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: flow.client.client_id,
        code: flow.code,
        redirect_uri: redirectUri,
        code_verifier: flow.verifier,
        resource: protectedResource.resource,
      }),
    });
    expect(tokenResponse.status).toBe(200);

    const failedAuthorization = await fetch(`${metadata.authorization_endpoint}?${new URLSearchParams({
      response_type: "code",
      client_id: flow.client.client_id,
      redirect_uri: redirectUri,
      code_challenge: createHash("sha256").update(flow.verifier).digest("base64url"),
      code_challenge_method: "S256",
      scope: "unsupported",
      state: "test-state",
    })}`, { redirect: "manual" });
    expect(failedAuthorization.status).toBe(302);
    const callback = new URL(failedAuthorization.headers.get("location")!);
    expect(callback.searchParams.get("iss")).toBe(issuer);
    expect(callback.searchParams.get("error")).toBe("invalid_scope");
    expect(callback.searchParams.get("state")).toBe("test-state");
  });
  it("rejects a wrong PKCE verifier and another resource audience", async () => {
    const flow = await authorize();
    const form = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: flow.client.client_id,
      code: flow.code,
      redirect_uri: flow.client.redirect_uris[0],
      code_verifier: "wrong-verifier-0000000000000000000000000000000",
      resource: origin + "/mcp",
    });
    expect(
      (
        await fetch(origin + "/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: form,
        })
      ).status,
    ).toBe(400);
    await expect(
      runtime.oauth.exchangeAuthorizationCode(
        flow.client,
        flow.code,
        flow.verifier,
        flow.client.redirect_uris[0],
        new URL("https://other.invalid/mcp"),
      ),
    ).rejects.toThrow();
  });
  it("connects using the actual MCP SDK and persists visible account-owned calls", async () => {
    const client = new Client({ name: "test-client", version: "1.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(origin + "/mcp"), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    );
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toContain("prepare_order");
    expect(tools.tools.some((tool) => tool.name.includes("approve"))).toBe(
      false,
    );
    const result = await client.callTool({
      name: "create_request",
      arguments: request,
    });
    expect(result.isError).not.toBe(true);
    const data = JSON.parse((result.content as { text: string }[])[0].text);
    runId = data.runId;
    const runs = await (
      await fetch(origin + "/api/runs", { headers: { Cookie: cookie } })
    ).json();
    expect(runs.some((run: { id: string }) => run.id === runId)).toBe(true);
    const events = await (
      await fetch(origin + "/api/events", { headers: { Cookie: cookie } })
    ).json();
    expect(
      events.some(
        (event: { action: string; status: string }) =>
          event.action === "create_request" && event.status === "completed",
      ),
    ).toBe(true);
    await client.close();
  });
  it("keeps multiple MCP items in one budgeted, revision-bound purchase request", async () => {
    const policy = await post("/api/policy", {
      automaticLimitCents: 6_000,
      requiredClaims: ["gluten-free"],
      freeFromAllergens: ["AP"],
    });
    expect(policy.status).toBe(200);
    const flow = await authorize();
    const credentials = await runtime.oauth.exchangeAuthorizationCode(
      flow.client,
      flow.code,
      flow.verifier,
      flow.client.redirect_uris[0],
      new URL(origin + "/mcp"),
    );
    const client = new Client({ name: "multi-item-verification", version: "1.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(origin + "/mcp"), {
        requestInit: { headers: { Authorization: `Bearer ${credentials.access_token}` } },
      }),
    );
    const call = (name: string, args: Record<string, unknown>) =>
      client.callTool({ name, arguments: args });
    async function successfulCall<T>(name: string, args: Record<string, unknown>) {
      const result = await call(name, args);
      expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
      return result.structuredContent as T;
    }
    async function expectToolError(name: string, args: Record<string, unknown>, code: string) {
      const result = await call(name, args);
      expect(result.isError).toBe(true);
      const [content] = result.content as { type: string; text: string }[];
      expect(content.type).toBe("text");
      expect(JSON.parse(content.text)).toMatchObject({ error: code });
    }
    async function createBasket(budgetCents: number, items = [
      { query: "chicken breast", quantity: 10, unit: "kg", requirements: ["high-protein"] },
      { query: "rice", quantity: 2, unit: "kg" },
    ]) {
      const result = await successfulCall<{
        runId: string;
        requirements: { items: { itemId: string; query: string }[] };
      }>("create_request", {
        items,
        deadline: new Date(deliveryAnchor + 3 * 86_400_000).toISOString(),
        budgetCents,
      });
      return {
        ...result,
        selections: result.requirements.items.map(({ itemId, query }) => ({
          itemId,
          productId: testProducts.find((product) => product.query === query)!.id,
        })),
      };
    }
    try {
      const { tools } = await client.listTools();
      for (const [name, property] of [["create_request", "items"], ["prepare_order", "selections"]]) {
        expect(tools.find((tool) => tool.name === name)?.inputSchema.properties?.[property])
          .toMatchObject({ type: "array", items: { type: "object" } });
      }

      const basket = await createBasket(8_000);
      const [chicken, rice] = basket.selections;
      expect(chicken.itemId).not.toBe(rice.itemId);
      expect(basket.requirements).toMatchObject({
        budgetCents: 8_000,
        items: [
          {
            itemId: chicken.itemId,
            query: "chicken breast",
            quantity: 10,
            unit: "kg",
            requirements: expect.arrayContaining(["gluten-free", "high-protein"]),
            freeFromAllergen: ["AP"],
          },
          {
            itemId: rice.itemId,
            query: "rice",
            quantity: 2,
            unit: "kg",
            requirements: ["gluten-free"],
            freeFromAllergen: ["AP"],
          },
        ],
      });
      expect(await successfulCall("search_products", {
        runId: basket.runId,
        itemId: rice.itemId,
      })).toMatchObject({ products: [{ id: "rice" }] });

      const compared = await successfulCall<{ revision: number }>("compare_products", {
        runId: basket.runId,
      });
      expect(compared).toMatchObject({
        comparison: {
          items: [
            { itemId: chicken.itemId, observations: [{ productId: "chicken", availableDate: deliveryDay(1), deliveryStatus: "estimated", salesUnitPriceCents: 1_000 }] },
            { itemId: rice.itemId, observations: [{ productId: "rice", availableDate: deliveryDay(2), deliveryStatus: "estimated", salesUnitPriceCents: 1_000 }] },
          ],
        },
        itemDraftEligibility: {
          [chicken.itemId]: { chicken: { eligible: true } },
          [rice.itemId]: { rice: { eligible: true } },
        },
      });
      const prepare = {
        runId: basket.runId,
        revision: compared.revision,
        selections: basket.selections,
      };
      await expectToolError("prepare_order", { ...prepare, selections: [chicken] }, "invalid_selections");
      await expectToolError("prepare_order", { ...prepare, selections: [chicken, chicken] }, "invalid_selections");
      await expectToolError("prepare_order", {
        ...prepare,
        selections: [{ ...chicken, productId: rice.productId }, rice],
      }, "unsuitable_product");

      const draft = await successfulCall<{ revision: number }>("prepare_order", prepare);
      expect(draft).toMatchObject({
        status: "awaiting_approval",
        draft: {
          totalCents: 7_000,
          items: [
            { ...chicken, salesUnits: 5, totalCents: 5_000, availableDate: deliveryDay(1) },
            { ...rice, salesUnits: 2, totalCents: 2_000, availableDate: deliveryDay(2) },
          ],
        },
      });
      const decisionUrl = `/api/runs/${basket.runId}/decision`;
      expect((await post(decisionUrl, { revision: compared.revision, approve: true })).status).toBe(409);
      expect((await post(decisionUrl, { revision: draft.revision, approve: true })).status).toBe(200);
      expect(await successfulCall("get_request_status", { runId: basket.runId })).toMatchObject({
        status: "approved",
        approved_revision: draft.revision,
        supplierCheckoutAvailable: false,
        draft: { items: [{ availableDate: deliveryDay(1) }, { availableDate: deliveryDay(2) }] },
      });
      await expectToolError("place_order", {
        runId: basket.runId,
        revision: draft.revision,
        idempotencyKey: "basket-checkout-attempt",
      }, "supplier_checkout_unavailable");

      const overBudget = await createBasket(6_000);
      const { revision } = await successfulCall<{ revision: number }>("compare_products", {
        runId: overBudget.runId,
      });
      await expectToolError("prepare_order", {
        runId: overBudget.runId,
        revision,
        selections: overBudget.selections,
      }, "over_budget");
      expect(await successfulCall("get_request_status", { runId: overBudget.runId })).toMatchObject({
        revision,
        draft: null,
      });

      const combined = await createBasket(23_000, [
        { query: "rice", quantity: 12, unit: "kg" },
        { query: "rice", quantity: 10, unit: "kg" },
      ]);
      const combinedComparison = await successfulCall<{ revision: number }>("compare_products", {
        runId: combined.runId,
      });
      await expectToolError("prepare_order", {
        runId: combined.runId,
        revision: combinedComparison.revision,
        selections: combined.selections.map(selection => ({ ...selection, availableDate: deliveryDay(2) })),
      }, "insufficient_combined_stock");
      const splitStockDraft = await successfulCall<{ draft: { items: { availableDate: string }[] } }>("prepare_order", {
        runId: combined.runId,
        revision: combinedComparison.revision,
        selections: combined.selections,
      });
      expect(splitStockDraft.draft.items.map(({ availableDate }) => availableDate).sort())
        .toEqual([deliveryDay(2), deliveryDay(3)]);

      const laterSavings = await createBasket(6_500);
      const laterComparison = await successfulCall<{ revision: number }>("compare_products", { runId: laterSavings.runId });
      expect(laterComparison).toMatchObject({ comparison: { basketPlan: { status: "feasible", totalCents: 6_400 } } });
      const laterDraft = await successfulCall("prepare_order", {
        runId: laterSavings.runId,
        revision: laterComparison.revision,
        selections: laterSavings.selections,
      });
      expect(laterDraft).toMatchObject({
        draft: { totalCents: 6_400, items: [{ availableDate: deliveryDay(1) }, { availableDate: deliveryDay(3) }] },
      });

      const late = await createBasket(8_000, [
        { query: "rice", quantity: 2, unit: "kg" },
        { query: "pasta", quantity: 2, unit: "kg" },
      ]);
      const [, pasta] = late.selections;
      const lateComparison = await successfulCall<{ revision: number }>("compare_products", { runId: late.runId });
      expect(lateComparison).toMatchObject({
        status: "needs_attention",
        comparison: {
          items: [
            { observations: [{ deliveryStatus: "estimated" }] },
            { observations: [{ productId: "pasta", availableDate: deliveryDay(7), deliveryStatus: "after_deadline" }] },
          ],
        },
        itemDraftEligibility: { [pasta.itemId]: { pasta: { eligible: false } } },
      });
      await expectToolError("prepare_order", {
        runId: late.runId,
        revision: lateComparison.revision,
        selections: late.selections,
      }, "unsuitable_product");
    } finally {
      await client.close();
    }
  });
  it("retries MCP creation by key and amends an approved order to an exact supplier pack", async () => {
    const flow = await authorize();
    const credentials = await runtime.oauth.exchangeAuthorizationCode(
      flow.client, flow.code, flow.verifier, flow.client.redirect_uris[0], new URL(origin + "/mcp"),
    );
    const client = new Client({ name: "request-edit-verification", version: "1.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(origin + "/mcp"), {
      requestInit: { headers: { Authorization: `Bearer ${credentials.access_token}` } },
    }));
    const call = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args });
    const success = async (name: string, args: Record<string, unknown>) => {
      const result = await call(name, args);
      expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
      return result.structuredContent as { runId?: string; revision: number };
    };
    const failure = async (name: string, args: Record<string, unknown>, code: string) => {
      const result = await call(name, args);
      expect(result.isError).toBe(true);
      const [content] = result.content as { type: string; text: string }[];
      expect(JSON.parse(content.text)).toMatchObject({ error: code });
    };
    const original = {
      items: [
        { query: "rice", quantity: 2, unit: "kg", requirements: ["gluten-free"] },
        { productId: "chicken", quantity: 10, unit: "kg" },
      ],
      deadline: new Date(deliveryAnchor + 3 * 86_400_000).toISOString(),
      budgetCents: 8_000,
      idempotencyKey: "basket-edit-test-key",
    };
    try {
      const [created, retry] = await Promise.all([
        success("create_request", original),
        success("create_request", original),
      ]);
      const runId = String(created.runId);
      expect(retry.runId).toBe(runId);
      expect(created).toMatchObject({ requirements: { deliveryMode: "by" } });
      expect(created).not.toHaveProperty("creation_fingerprint");
      await failure("create_request", { ...original, budgetCents: 9_000 }, "idempotency_conflict");
      const other = await runtime.service.execute({ ...actor, accountId: "account-b" }, "create_request", original);
      expect(other).not.toMatchObject({ runId });

      const compared = await success("compare_products", { runId });
      const selections = [{ itemId: "item_1", productId: "rice" }, { itemId: "item_2", productId: "chicken" }];
      const draft = await success("prepare_order", { runId, selections, revision: compared.revision });
      const decisionUrl = `/api/runs/${runId}/decision`;
      expect((await post(decisionUrl, { revision: draft.revision, approve: true })).status).toBe(200);
      const alternate = await success("search_products", { runId, itemId: "item_1", query: "frozen corn" });
      expect(alternate).toMatchObject({ products: [{ id: "bagged" }] });
      await failure("amend_request", {
        runId, revision: draft.revision, itemId: "item_1",
        item: { productId: "bagged", quantity: 3, unit: "sales_unit" },
      }, "invalid_sales_lot");
      const amended = await success("amend_request", {
        runId, revision: draft.revision, itemId: "item_1",
        item: { productId: "bagged", quantity: 2, unit: "sales_unit" },
      });
      expect(amended).toMatchObject({
        id: runId, approved_revision: null, draft: null, comparison: null,
        requirements: {
          budgetCents: original.budgetCents, deadline: original.deadline,
          items: [
            { itemId: "item_1", productId: "bagged", unit: "sales_unit", requirements: ["gluten-free"] },
            { itemId: "item_2", productId: "chicken" },
          ],
        },
      });
      expect((await post(decisionUrl, { revision: draft.revision, approve: true })).status).toBe(409);
      const replay = await success("create_request", original);
      expect(replay).toMatchObject({ runId, revision: amended.revision });
      const refreshed = await success("compare_products", { runId });
      const updated = await success("prepare_order", {
        runId, revision: refreshed.revision,
        selections: [{ itemId: "item_1", productId: "bagged" }, selections[1]],
      });
      expect(updated).toMatchObject({ draft: { items: [{ productId: "bagged", salesUnits: 2, salesUnit: "BAG" }, {}] } });

      const flat = { productId: "bagged", quantity: 2, unit: "sales_unit", deadline: original.deadline, budgetCents: 4_000 };
      const flexible = await success("create_request", flat);
      const exact = await success("create_request", { ...flat, deliveryMode: "on" });
      expect(await success("compare_products", { runId: flexible.runId })).toMatchObject({
        comparison: { observations: [{ availableDate: deliveryDay(1), deliveryStatus: "estimated" }] },
      });
      expect(await success("compare_products", { runId: exact.runId })).toMatchObject({
        comparison: { observations: [{ availableDate: deliveryDay(3), deliveryStatus: "time_unverified" }] },
      });
    } finally {
      await client.close();
    }
  });
  it.each(["flat", "basket"])("prepares a %s purchase estimate with no budget or date target", async (layout) => {
    const item = line("rice");
    const created = await order("create_request", layout === "flat" ? item : { items: [item] });
    const { runId } = created;
    expect(created).not.toHaveProperty("requirements.deadline");
    expect(created).not.toHaveProperty("requirements.budgetCents");
    const comparison = await order("compare_products", { runId });
    expect(comparison).toMatchObject({ itemAvailability: { item_1: { status: "eligible" } } });
    const selection = layout === "flat" ? { productId: "rice" } : { selections: [{ itemId: "item_1", productId: "rice" }] };
    const draft = await order("prepare_order", { ...selection, runId, revision: comparison.revision });
    expect(draft).toMatchObject({
      status: "awaiting_approval",
      draft: { totalCents: 2_000 },
      approvalEligibility: { eligible: true },
    });
    await expect(order("place_order", { runId, revision: draft.revision, idempotencyKey: "flex-checkout-only" }))
      .rejects.toMatchObject({ code: "approval_required" });
    await expect(runtime.service.decide(orderActor, runId, draft.revision, true))
      .resolves.toMatchObject({ status: "approved" });
  });

  it("keeps an omitted budget mode hard and permits a preferred budget overage for review", async () => {
    const items = [line("chicken", 10), line("rice")];
    const budgetCents = 6_000;
    const deadline = deliveryInstant(3).toISOString();
    const selections = [{ itemId: "item_1", productId: "chicken" }, { itemId: "item_2", productId: "rice" }];
    const strict = await order("create_request", { items, budgetCents, deadline });
    const strictComparison = await order("compare_products", { runId: strict.runId });
    expect(strictComparison).toMatchObject({ status: "needs_attention", comparison: { basketPlan: { status: "blocked" } } });
    await expect(order("prepare_order", { runId: strict.runId, revision: strictComparison.revision, selections }))
      .rejects.toMatchObject({ code: "over_budget" });

    const preferred = await order("create_request", { items, budgetCents, deadline, budgetMode: "preferred" });
    const compared = await order("compare_products", { runId: preferred.runId });
    expect(compared).toMatchObject({ status: "active", comparison: { basketPlan: { status: "feasible" } } });
    const draft = await order("prepare_order", { runId: preferred.runId, revision: compared.revision, selections });
    expect(draft).toMatchObject({
      status: "awaiting_approval",
      draft: { caveats: expect.arrayContaining(["OVER_PREFERRED_BUDGET"]) },
    });
    expect((draft as { draft?: { totalCents: number } }).draft?.totalCents).toBeGreaterThan(budgetCents);
  });

  it("enforces a zero hard ceiling even without a delivery target", async () => {
    const { runId } = await order("create_request", { ...line("rice"), budgetCents: 0 });
    const compared = await order("compare_products", { runId });
    expect(compared).toMatchObject({ status: "needs_attention", draft: null });
    await expect(order("prepare_order", { runId, revision: compared.revision, productId: "rice" }))
      .rejects.toMatchObject({ code: "unsuitable_product", message: expect.stringContaining("over budget") });
  });

  it("uses later verified prices to meet a preferred basket budget when possible", async () => {
    const { runId } = await order("create_request", {
      items: [line("chicken", 10), line("rice")], deadline: deliveryInstant(3).toISOString(),
      budgetCents: 6_500, budgetMode: "preferred",
    });
    const compared = await order("compare_products", { runId });
    expect(compared).toMatchObject({ comparison: { basketPlan: { status: "feasible", totalCents: 6_400 } } });
    const selections = [{ itemId: "item_1", productId: "chicken" }, { itemId: "item_2", productId: "rice" }];
    const draft = await order("prepare_order", { runId, revision: compared.revision, selections });
    expect(draft).toMatchObject({ draft: { totalCents: 6_400, items: [{ availableDate: deliveryDay(1) }, { availableDate: deliveryDay(3) }] } });
    expect((draft as { draft?: { caveats: string[] } }).draft?.caveats).not.toContain("OVER_PREFERRED_BUDGET");
  });

  it.each([
    { label: "preferred exact day when available", productId: "chicken", mode: "preferred_on", target: 3, actual: 3, outside: false },
    { label: "preferred exact day when only later delivery is available", productId: "pasta", mode: "preferred_on", target: 1, actual: 7, outside: true },
    { label: "preferred latest day when only later delivery is available", productId: "pasta", mode: "preferred_by", target: 1, actual: 7, outside: true },
    { label: "a preferred latest day that has elapsed", productId: "chicken", mode: "preferred_by", target: -1, actual: 1, outside: true },
  ])("handles $label", async ({ productId, mode, target, actual, outside }) => {
    const { runId } = await order("create_request", {
      ...line(productId), deliveryMode: mode, deadline: deliveryInstant(target).toISOString(),
    });
    const comparison = await order("compare_products", { runId });
    expect(comparison).toMatchObject({ itemAvailability: { item_1: { status: "eligible" } } });
    const draft = await order("prepare_order", { runId, productId, revision: comparison.revision });
    expect(draft).toMatchObject({ draft: { availableDate: deliveryDay(actual) } });
    expect((draft as { draft?: { caveats: string[] } }).draft?.caveats.includes("OUTSIDE_PREFERRED_DELIVERY_DATE")).toBe(outside);
  });

  it("edits preferences by revision, clears targets, and invalidates a previous approval", async () => {
    const { runId } = await order("create_request", {
      ...line("rice"), budgetCents: 10_000, deadline: deliveryInstant(3).toISOString(),
    });
    const compared = await order("compare_products", { runId });
    const draft = await order("prepare_order", { runId, revision: compared.revision, productId: "rice" });
    await runtime.service.decide(orderActor, runId, draft.revision, true);
    expect(await order("update_request_preferences", { runId, revision: draft.revision, budgetMode: "hard" }))
      .toMatchObject({ revision: draft.revision, status: "approved", approved_revision: draft.revision });
    const changed = await order("update_request_preferences", {
      runId, revision: draft.revision, budgetCents: null, deadline: null,
    });
    for (const field of ["budgetCents", "budgetMode", "deadline", "deliveryMode"]) {
      expect(changed).not.toHaveProperty(`requirements.${field}`);
    }
    expect(changed).toMatchObject({ revision: draft.revision + 1, comparison: null, draft: null, approved_revision: null });
    await expect(order("update_request_preferences", { runId, budgetCents: 6_000, revision: draft.revision }))
      .rejects.toMatchObject({ code: "stale_revision" });
    await expect(runtime.service.decide(orderActor, runId, draft.revision, true)).rejects.toMatchObject({ status: 409 });
    expect(await order("compare_products", { runId })).toMatchObject({ status: "active" });
  });

  it.each([{ budgetMode: "preferred" }, { deliveryMode: "preferred_on" }])(
    "requires a price or date whenever a mode is supplied (%j)", async mode => {
      await expect(order("create_request", { ...line("rice"), ...mode })).rejects.toMatchObject({ name: "ZodError" });
      const { runId, revision } = await order("create_request", line("rice"));
      await expect(order("update_request_preferences", { runId, revision, ...mode }))
        .rejects.toMatchObject({ code: "invalid_preferences" });
      expect(await order("get_request_status", { runId })).toMatchObject({ revision });
    },
  );

  it("replays a request using an idempotency fingerprint stored before preference modes existed", async () => {
    const idempotencyKey = "legacy-hard-fingerprint";
    const digest = (value: string) => createHash("sha256").update(value).digest("hex");
    const runId = `run_${digest(`${orderActor.accountId}:external:create_request:${idempotencyKey}`).slice(0, 32)}`;
    const item = line("rice");
    const hardLimits = { deadline: deliveryInstant(3).toISOString(), deliveryMode: "by", budgetCents: 6_000 };
    const fingerprint = digest(JSON.stringify({ ...hardLimits, itemLayout: "flat", lines: [item] }));
    await runtime.db.rows(
      "INSERT INTO trade_runs(id,account_id,actor_id,source,title,requirements,creation_fingerprint) VALUES($1,$2,$3,'web','Rice',$4,$5)",
      [runId, orderActor.accountId, orderActor.actorId, JSON.stringify({ ...hardLimits, ...item, query: "Rice" }), fingerprint],
    );
    expect(await order("create_request", { ...item, ...hardLimits, idempotencyKey }))
      .toMatchObject({ runId, requirements: hardLimits });
  });

  it("keeps a past hard deadline blocking and can recover the request by editing it", async () => {
    const overdue = deliveryInstant(-1).toISOString();
    await expect(order("create_request", { ...line("rice"), deadline: overdue })).rejects.toMatchObject({ code: "past_deadline" });
    const created = await order("create_request", { ...line("rice"), deadline: deliveryInstant(3).toISOString() });
    const { runId, revision } = created;
    await runtime.db.rows("UPDATE trade_runs SET requirements=jsonb_set(requirements,'{deadline}',to_jsonb($2::text)) WHERE id=$1", [runId, overdue]);
    await expect(order("compare_products", { runId })).rejects.toMatchObject({ code: "past_deadline" });
    expect(await order("update_request_preferences", { runId, revision, deadline: null })).not.toHaveProperty("requirements.deadline");
    expect(await order("compare_products", { runId })).toMatchObject({ status: "active" });
  });

  it.each([
    { label: "a catalog match with zero stock", unavailable: line("oats"), status: "insufficient_stock" },
    { label: "a missing supplier availability row", unavailable: line("beans"), status: "evidence_unverified" },
    { label: "a missing catalog match", unavailable: { query: "xqvzz", quantity: 2, unit: "kg" }, status: "no_catalog_match" },
    { label: "unknown supplier stock", unavailable: line("peas"), status: "evidence_unverified" },
    { label: "a missing supplier price", unavailable: line("carrots"), status: "evidence_unverified" },
  ])("preserves all requested lines and offers the verified remainder for $label", async ({ unavailable, status }) => {
    const { runId } = await order("create_request", { items: [line("rice"), unavailable] });
    const compared = await order("compare_products", { runId });
    const selections = [{ itemId: "item_1", productId: "rice" }];
    expect(compared).toMatchObject({
      status: "needs_attention", draft: null,
      requirements: { items: [{ itemId: "item_1" }, { itemId: "item_2" }] },
      itemAvailability: { item_1: { status: "eligible" }, item_2: { status, reasons: expect.arrayContaining([expect.any(String)]) } },
      partialBasketPlan: { status: "feasible", omittedItemIds: ["item_2"], selections, totalCents: 2_000 },
    });
    await expect(order("prepare_order", { runId, revision: compared.revision, selections }))
      .rejects.toMatchObject({ code: "invalid_selections" });
    expect(await order("get_request_status", { runId })).toMatchObject({ revision: compared.revision, draft: null });
  });

  it.each([
    { label: "every requested line is blocked", items: [line("oats"), line("peas")], budgetCents: undefined },
    { label: "the remainder would break the hard budget", items: [line("rice"), line("oats")], budgetCents: 1 },
  ])("offers no partial estimate when $label", async ({ items, budgetCents }) => {
    const { runId } = await order("create_request", { items, budgetCents });
    const compared = await order("compare_products", { runId });
    expect(compared).toMatchObject({ status: "needs_attention", draft: null });
    expect(compared).not.toHaveProperty("partialBasketPlan");
  });

  it("does not treat a supplier outage as stock evidence and can retry the same request", async () => {
    const { runId, revision } = await order("create_request", { items: [line("chicken", 2), line("rice")] });
    lookupUnavailable = true;
    try {
      await expect(order("compare_products", { runId })).rejects.toMatchObject({ code: "supplier_lookup_failed" });
    } finally {
      lookupUnavailable = false;
    }
    expect(await order("get_request_status", { runId })).toMatchObject({ revision, comparison: null, draft: null });
    expect(await order("compare_products", { runId })).toMatchObject({
      revision: revision + 1,
      status: "active",
      itemAvailability: { item_1: { status: "eligible" }, item_2: { status: "eligible" } },
    });
  });

  it("changes a stock-limited quantity on the same line after the buyer chooses a smaller amount", async () => {
    const { runId } = await order("create_request", { items: [line("chicken"), line("rice", 22)] });
    const initial = await order("compare_products", { runId });
    expect(initial).toMatchObject({
      status: "needs_attention",
      comparison: {
        items: [expect.any(Object), {
          deliveryOffers: expect.arrayContaining([expect.objectContaining({
            observedCoverage: expect.objectContaining({ coveredQuantity: 20, uncoveredQuantity: 2 }),
          })]),
        }],
      },
    });
    const amended = await order("amend_request", { runId, revision: initial.revision, itemId: "item_2", item: line("rice", 20) });
    expect(amended).toMatchObject({
      requirements: { items: [expect.any(Object), { itemId: "item_2", quantity: 20 }] },
      comparison: null, draft: null,
    });
    const refreshed = await order("compare_products", { runId });
    const selections = [{ itemId: "item_1", productId: "chicken" }, { itemId: "item_2", productId: "rice" }];
    expect(await order("prepare_order", { runId, revision: refreshed.revision, selections })).toMatchObject({
      draft: { items: [expect.any(Object), { itemId: "item_2", salesUnits: 20 }] },
    });
  });

  it("validates line removals and only applies one concurrent edit at a revision", async () => {
    const { runId, revision } = await order("create_request", { items: [line("rice"), line("oats"), line("beans")] });
    for (const itemIds of [["item_404"], ["item_2", "item_2"], ["item_1", "item_2", "item_3"]]) {
      await expect(order("remove_request_items", { runId, revision, itemIds }))
        .rejects.toMatchObject({ code: "invalid_remove_items" });
    }
    await expect(runtime.service.execute({ ...orderActor, scopes: ["catalog:read"] }, "remove_request_items", {
      runId, revision, itemIds: ["item_2"],
    })).rejects.toMatchObject({ code: "insufficient_scope" });
    const edits = await Promise.allSettled(["item_2", "item_3"].map(itemId =>
      order("remove_request_items", { runId, revision, itemIds: [itemId] })));
    expect(edits).toEqual(expect.arrayContaining([
      { status: "fulfilled", value: expect.objectContaining({ revision: revision + 1 }) },
      { status: "rejected", reason: expect.objectContaining({ code: "stale_revision" }) },
    ]));
    const run = await runtime.service.run(orderActor, runId);
    expect(run.requirements).toMatchObject({ items: [{ itemId: "item_1" }, expect.any(Object)], excludedItems: [expect.any(Object)] });
  });

  it("invalidates approval for the full basket when a buyer removes a line", async () => {
    const { runId } = await order("create_request", { items: [line("rice"), line("chicken")] });
    const compared = await order("compare_products", { runId });
    const selections = [{ itemId: "item_1", productId: "rice" }, { itemId: "item_2", productId: "chicken" }];
    const draft = await order("prepare_order", { runId, revision: compared.revision, selections });
    await runtime.service.decide(orderActor, runId, draft.revision, true);

    const amended = await order("remove_request_items", { runId, revision: draft.revision, itemIds: ["item_1"] });
    expect(amended).toMatchObject({
      revision: draft.revision + 1, status: "active", approved_revision: null, draft: null, comparison: null,
      requirements: { items: [{ itemId: "item_2" }], excludedItems: [{ itemId: "item_1" }] },
    });
    expect(amended).not.toHaveProperty("requestChanges");
    await expect(runtime.service.decide(orderActor, runId, draft.revision, true)).rejects.toMatchObject({ status: 409 });
    const refreshed = await order("compare_products", { runId });
    expect(await order("prepare_order", { runId, revision: refreshed.revision, selections: [selections[1]] }))
      .toMatchObject({ status: "awaiting_approval", draft: { items: [selections[1]] } });
  });

  it("uses the MCP SDK to remove a selected line, recheck evidence, and review the remainder", async () => {
    const client = new Client({ name: "partial-basket-verification", version: "1.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(origin + "/mcp"), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }));
    const call = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args });
    async function success(name: string, args: Record<string, unknown>) {
      const result = await call(name, args);
      expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
      return result.structuredContent as { runId: string; revision: number };
    }
    try {
      const { tools } = await client.listTools();
      const create = tools.find(({ name }) => name === "create_request")!;
      expect(create.inputSchema.required ?? []).not.toContain("budgetCents");
      expect(create.inputSchema.required ?? []).not.toContain("deadline");
      expect(create.inputSchema.properties).toHaveProperty("budgetMode");
      expect(tools.find(({ name }) => name === "remove_request_items")?.inputSchema.properties?.itemIds)
        .toMatchObject({ type: "array", items: { type: "string" } });
      expect(tools.find(({ name }) => name === "update_request_preferences")?.inputSchema.properties)
        .toHaveProperty("deliveryMode");

      const original = {
        items: [line("rice"), line("oats")],
        budgetCents: 3_000,
        idempotencyKey: "partial-basket-sdk-retry",
      };
      const { runId } = await success("create_request", original);
      const compared = await success("compare_products", { runId });
      expect(compared).toMatchObject({ partialBasketPlan: { status: "feasible", omittedItemIds: ["item_2"] } });
      const removed = await success("remove_request_items", { runId, revision: compared.revision, itemIds: ["item_2"] });
      expect(removed).toMatchObject({
        id: runId, comparison: null, draft: null, approved_revision: null,
        requestChanges: [{ kind: "items_removed", actorSource: "mcp", items: [{ itemId: "item_2", productId: "oats" }] }],
        requirements: {
          budgetCents: 3_000,
          items: [{ ...line("rice"), itemId: "item_1" }],
          excludedItems: [{ ...line("oats"), itemId: "item_2" }],
        },
      });
      // An interrupted agent may resend the original create call after the buyer has amended it.
      expect(await success("create_request", { ...original, budgetMode: "hard" })).toMatchObject({ runId, revision: removed.revision });
      const conflict = await call("create_request", { ...original, budgetMode: "preferred" });
      expect(conflict.isError).toBe(true);
      expect(JSON.parse((conflict.content as { text: string }[])[0].text)).toMatchObject({ error: "idempotency_conflict" });
      const selections = [{ itemId: "item_1", productId: "rice" }];
      const stale = await call("prepare_order", { runId, revision: removed.revision, selections });
      expect(stale.isError).toBe(true);
      expect(JSON.parse((stale.content as { text: string }[])[0].text)).toMatchObject({ error: "stale_evidence" });
      const staleComparison = await call("compare_products", { runId, revision: compared.revision });
      expect(staleComparison.isError).toBe(true);
      expect(JSON.parse((staleComparison.content as { text: string }[])[0].text)).toMatchObject({ error: "stale_revision" });
      const refreshed = await success("compare_products", { runId, revision: removed.revision });
      expect(refreshed).toMatchObject({ status: "active", itemAvailability: { item_1: { status: "eligible" } } });
      const draft = await success("prepare_order", { runId, revision: refreshed.revision, selections });
      expect(draft).toMatchObject({ status: "awaiting_approval", draft: { items: selections, totalCents: 2_000 } });
      expect(await success("get_request_status", { runId })).toMatchObject({
        status: "awaiting_approval", approved_revision: null, supplierCheckoutAvailable: false,
        requirements: { excludedItems: [{ itemId: "item_2", productId: "oats" }] },
      });
    } finally {
      await client.close();
    }
  });

  it("prevents cross-account reads, mutations and SSE event leaks", async () => {
    const other: Actor = { ...actor, accountId: "account-b" };
    await expect(runtime.service.run(other, runId)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      runtime.service.execute(other, "get_request_status", { runId }),
    ).rejects.toMatchObject({ status: 404 });
    await runtime.db.event(other, null, "private_other_account", "completed", {
      private: true,
    });
    const controller = new AbortController();
    const response = await fetch(origin + "/api/events/stream", {
      headers: { Cookie: cookie },
      signal: controller.signal,
    });
    const reader = response.body!.getReader();
    const first = await reader.read();
    const text = new TextDecoder().decode(first.value);
    controller.abort();
    expect(text).toContain("create_request");
    expect(text).not.toContain("private_other_account");
  });
  it("enforces account requirements even when an agent omits them", async () => {
    await runtime.db.rows("UPDATE trade_accounts SET policy=$1 WHERE id=$2", [
      JSON.stringify({
        automaticLimitCents: 0,
        requiredClaims: ["gluten-free"],
        freeFromAllergens: ["AP"],
      }),
      actor.accountId,
    ]);
    const created = (await runtime.service.execute(
      actor,
      "create_request",
      request,
    )) as { runId: string };
    const run = await runtime.service.run(actor, created.runId);
    expect(run.requirements).toMatchObject({
      requirements: expect.arrayContaining(["gluten-free"]),
      freeFromAllergen: ["AP"],
    });
  });
  it("binds human approval to revision and fails closed without supplier checkout", async () => {
    const account = await runtime.service.account(actor);
    const draft = {
      productId: "sku",
      name: "Test evidence",
      salesUnits: 100,
      salesUnit: "CS",
      totalCents: 10000,
      unitPriceCents: 100,
      observedAt: new Date().toISOString(),
      closingTime: new Date(Date.now() + 60_000).toISOString(),
      caveats: [],
      policy: account.policy,
    };
    await runtime.db.rows(
      "UPDATE trade_runs SET draft=$1,revision=2,status='awaiting_approval' WHERE id=$2",
      [JSON.stringify(draft), runId],
    );
    await expect(
      runtime.service.decide({ ...actor, source: "mcp" }, runId, 2, true),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      runtime.service.decide(actor, runId, 1, true),
    ).rejects.toMatchObject({ status: 409 });
    await runtime.service.decide(actor, runId, 2, true);
    await expect(
      runtime.service.execute(actor, "place_order", {
        runId,
        revision: 2,
        idempotencyKey: "test-unique-attempt",
      }),
    ).rejects.toMatchObject({ code: "supplier_checkout_unavailable" });
    await expect(runtime.service.execute(actor, "place_order", {
      runId, revision: 2, idempotencyKey: "test-unique-attempt", mode: "rehearsal",
    })).rejects.toMatchObject({ code: "order_rehearsal_unavailable" });
    expect((await runtime.service.run(actor, runId)).status).toBe("approved");
  });
  it("rehearses the full account flow at the approved total and returns one receipt on concurrent retries", async () => {
    const service = new TradeService(runtime.db, testAdapter, origin, true);
    const agent: Actor = { ...orderActor, source: "mcp" };
    const place = (args: Record<string, unknown>) => service.execute(agent, "place_order", args);
    const draftRequest = async () => {
      const { runId } = await service.execute(agent, "create_request", line("rice")) as { runId: string };
      const { revision } = await service.execute(agent, "compare_products", { runId }) as { revision: number };
      return await service.execute(agent, "prepare_order", { runId, revision, productId: "rice" }) as {
        id: string; revision: number; status: string; draft: { totalCents: number };
      };
    };
    expect(await service.execute(agent, "get_account_context", {})).toMatchObject({
      orderRehearsalAvailable: true, supplierCheckoutAvailable: false,
    });
    const draft = await draftRequest();
    const checkout = { runId: draft.id, revision: draft.revision, idempotencyKey: "one-rehearsal-receipt", mode: "rehearsal" };
    expect(draft.status).toBe("awaiting_approval");
    await expect(place(checkout)).rejects.toMatchObject({ code: "approval_required" });
    await service.decide(orderActor, draft.id, draft.revision, true);
    await expect(place({ ...checkout, mode: undefined })).rejects.toMatchObject({ code: "supplier_checkout_unavailable" });
    await expect(service.execute({ ...agent, scopes: ["catalog:read"] }, "place_order", checkout))
      .rejects.toMatchObject({ code: "insufficient_scope" });
    const [placed, replay] = await Promise.all([place(checkout), place(checkout)]);
    expect(placed).toEqual(replay);
    expect(placed).toMatchObject({
      runId: draft.id,
      status: "completed",
      receipt: {
        receiptId: expect.stringMatching(/^rehearsal_/), kind: "order_rehearsal", submittedToSupplier: false,
        revision: draft.revision, totalCents: draft.draft.totalCents, authorization: "buyer_approval",
        currency: "EUR", moneyBasis: "VAT_EXCLUSIVE",
      },
    });
    expect(await runtime.service.visibleRun(orderActor, draft.id)).toMatchObject({
      status: "completed", receipt: (placed as { receipt: unknown }).receipt, orderRehearsalAvailable: false,
    });
    expect(await service.visibleRun(orderActor, draft.id)).not.toHaveProperty("rehearsal_key_hash");
    expect(await runtime.db.rows("SELECT status FROM trade_events WHERE run_id=$1 AND action='order_rehearsal'", [draft.id]))
      .toEqual([{ status: "completed" }]);
    await expect(service.execute(agent, "compare_products", { runId: draft.id })).rejects.toMatchObject({ code: "request_closed" });
    await expect(service.execute({ ...agent, scopes: ["catalog:read"] }, "compare_products", { runId: draft.id }))
      .rejects.toMatchObject({ code: "insufficient_scope" });
    await expect(place({ ...checkout, revision: draft.revision + 1 })).rejects.toMatchObject({ code: "idempotency_conflict" });
    await expect(place({ ...checkout, idempotencyKey: "another-order-attempt" })).rejects.toMatchObject({ code: "request_closed" });

    const other = await draftRequest();
    await service.decide(orderActor, other.id, other.revision, true);
    await expect(place({ ...checkout, runId: other.id, revision: other.revision })).rejects.toMatchObject({ code: "idempotency_conflict" });
    expect(await service.run(orderActor, other.id)).toMatchObject({ status: "approved", receipt: null });
    await runtime.db.rows("UPDATE trade_runs SET draft=jsonb_set(draft,'{closingTime}',to_jsonb($1::text)) WHERE id=$2", [
      new Date(Date.now() - 1_000).toISOString(), other.id,
    ]);
    await expect(place({ ...checkout, runId: other.id, revision: other.revision, idempotencyKey: "after-the-supplier-cutoff" }))
      .rejects.toMatchObject({ code: "stale_evidence" });
  });
  it("rehearses automatically within the account's authority and checks policy drift before creating a receipt", async () => {
    const service = new TradeService(runtime.db, testAdapter, origin, true);
    const original = (await service.account(orderActor)).policy;
    const setPolicy = (policy: unknown) => runtime.db.rows(
      "UPDATE trade_accounts SET policy=$1 WHERE id=$2", [JSON.stringify(policy), orderActor.accountId],
    );
    const policy = { ...original, automaticLimitCents: 5_000 };
    const prepareRice = async (preferences: Record<string, unknown> = {}) => {
      const { runId, revision } = await service.execute(orderActor, "create_request", { ...line("rice"), ...preferences }) as {
        runId: string; revision: number;
      };
      const compared = await service.execute(orderActor, "compare_products", { runId, revision }) as { revision: number };
      const draft = await service.execute(orderActor, "prepare_order", { runId, revision: compared.revision, productId: "rice" }) as { revision: number };
      return { runId, draft };
    };
    try {
      await setPolicy(policy);
      const { runId, draft } = await prepareRice();
      expect(draft).toMatchObject({ status: "ready", approved_revision: null });
      const checkout = { runId, revision: draft.revision, idempotencyKey: "rehearsal-under-the-limit", mode: "rehearsal" };
      await setPolicy(original);
      await expect(service.execute(orderActor, "place_order", checkout)).rejects.toMatchObject({ code: "policy_changed" });
      await setPolicy(policy);
      await expect(service.execute(orderActor, "place_order", checkout)).resolves.toMatchObject({
        status: "completed", receipt: { authorization: "account_policy", submittedToSupplier: false },
      });
      const timeSensitive = await prepareRice({ deadline: deliveryInstant(2).toISOString(), deliveryMode: "on" });
      expect(timeSensitive.draft).toMatchObject({ status: "awaiting_approval", draft: { deliveryStatus: "time_unverified" } });
    } finally {
      await setPolicy(original);
    }
  });

  it.each([
    { label: "a substitute", source: "nemotron", tool: "amend_request", patch: { item: line("chicken") }, productId: "chicken",
      change: { kind: "item_changed", before: line("rice"), after: line("chicken") } },
    { label: "a quantity change", source: "mcp", tool: "amend_request", patch: { item: line("rice", 1) }, productId: "rice",
      change: { kind: "item_changed", before: line("rice"), after: line("rice", 1) } },
    { label: "a higher hard budget", source: "mcp", tool: "update_request_preferences", patch: { budgetCents: 4_000 }, productId: "rice",
      change: { kind: "constraints_relaxed", budget: { before: { cents: 3_000, mode: "hard" }, after: { cents: 4_000, mode: "hard" } } } },
    { label: "a preferred budget in place of a hard one", source: "mcp", tool: "update_request_preferences", patch: { budgetMode: "preferred" }, productId: "rice",
      change: { kind: "constraints_relaxed", budget: { before: { cents: 3_000, mode: "hard" }, after: { cents: 3_000, mode: "preferred" } } } },
    { label: "a removed hard delivery constraint", source: "mcp", tool: "update_request_preferences", patch: { deadline: null }, productId: "rice",
      change: { kind: "constraints_relaxed", delivery: { before: { deadline: deliveryInstant(4).toISOString(), mode: "by" }, after: null } } },
    { label: "a later hard deadline", source: "mcp", tool: "update_request_preferences", patch: { deadline: deliveryInstant(5).toISOString() }, productId: "rice",
      change: { kind: "constraints_relaxed", delivery: { before: { deadline: deliveryInstant(4).toISOString(), mode: "by" }, after: { deadline: deliveryInstant(5).toISOString(), mode: "by" } } } },
  ] as const)("requires the buyer's draft approval after an agent proposes $label", async ({ source, tool, patch, productId, change }) => {
    const service = new TradeService(runtime.db, testAdapter, origin, true);
    const agent = { ...consentBuyer, source, actorId: `${source}:consent-test` };
    const call = (name: ToolName, args: Record<string, unknown>) => service.execute(agent, name, args) as Promise<{
      runId: string; revision: number;
    }>;
    const { runId, revision } = await call("create_request", {
      ...line("rice"), budgetCents: 3_000, deadline: deliveryInstant(4).toISOString(),
    });
    const edited = await call(tool, { runId, revision, ...patch });
    const requestChanges = [{ ...change, actorSource: source, actorId: agent.actorId, revision: edited.revision }];
    expect(edited).toMatchObject({ requestChanges });
    const compared = await call("compare_products", { runId, revision: edited.revision });
    const draft = await call("prepare_order", { runId, revision: compared.revision, productId });
    expect(draft).toMatchObject({ status: "awaiting_approval", requestChanges });
    const rehearsal = { runId, revision: draft.revision, mode: "rehearsal", idempotencyKey: `consent-rehearsal-${runId}` };
    await expect(call("place_order", rehearsal)).rejects.toMatchObject({ code: "approval_required" });
    await expect(service.decide(agent, runId, draft.revision, true)).rejects.toMatchObject({ code: "human_required" });
    await expect(service.decide(consentBuyer, runId, edited.revision, true)).rejects.toMatchObject({ code: "stale_revision" });
    expect(await service.decide(consentBuyer, runId, draft.revision, true)).toMatchObject({ status: "approved", requestChanges });
    expect(await call("place_order", rehearsal)).toMatchObject({ receipt: { authorization: "buyer_approval", submittedToSupplier: false } });
  });

  it("keeps automatic authority for buyer edits and agent edits that tighten hard constraints", async () => {
    const agent: Actor = { ...consentBuyer, source: "mcp", actorId: "mcp:tighten-test" };
    const { runId, revision } = await runtime.service.execute(consentBuyer, "create_request", {
      ...line("rice"), budgetCents: 5_000, deadline: deliveryInstant(5).toISOString(),
    }) as { runId: string; revision: number };
    const amended = await runtime.service.execute(consentBuyer, "amend_request", {
      runId, revision, item: line("rice", 1),
    }) as { revision: number };
    const tightened = await runtime.service.execute(agent, "update_request_preferences", {
      runId, revision: amended.revision, budgetCents: 3_000, deadline: deliveryInstant(4).toISOString(),
    }) as { revision: number };
    const compared = await runtime.service.execute(agent, "compare_products", { runId, revision: tightened.revision }) as { revision: number };
    const draft = await runtime.service.execute(agent, "prepare_order", { runId, revision: compared.revision, productId: "rice" });
    expect(draft).toMatchObject({ status: "ready", approved_revision: null });
    expect(draft).not.toHaveProperty("requestChanges");
  });
  it("supports confidential OAuth clients and encrypts their secrets at rest", async () => {
    const flow = await authorize("client_secret_post");
    expect(flow.client.client_secret).toBeTruthy();
    const stored = await runtime.db.one(
      "SELECT metadata FROM trade_clients WHERE id=$1",
      [flow.client.client_id],
    );
    expect(stored!.metadata.client_secret).not.toBe(flow.client.client_secret);
    const response = await fetch(origin + "/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: flow.client.client_id,
        client_secret: flow.client.client_secret,
        code: flow.code,
        code_verifier: flow.verifier,
        redirect_uri: flow.client.redirect_uris[0],
        resource: origin + "/mcp",
      }),
    });
    expect(response.status).toBe(200);
    expect(
      (
        await runtime.oauth.verifyAccessToken(
          (await response.json()).access_token,
        )
      ).extra!.accountId,
    ).toBe("account-a");
  });
  it("exposes account context and history without leaking other accounts", async () => {
    const context = await runtime.service.execute(actor, "get_account_context", {}) as {supplierCheckoutAvailable:boolean;policy:unknown};
    expect(context.supplierCheckoutAvailable).toBe(false);
    expect(context.policy).toBeTruthy();
    const result = await runtime.service.execute(actor, "list_requests", {limit:50}) as {requests:{id:string}[]};
    expect(result.requests.some(row => row.id === runId)).toBe(true);
    const historyInput = { runId, limit: 10 };
    const firstHistory = await runtime.service.execute(actor, "get_activity", historyInput) as { events: { action: string }[] };
    const nextHistory = await runtime.service.execute(actor, "get_activity", historyInput);
    expect(firstHistory.events.length).toBeGreaterThan(0);
    expect(nextHistory).toEqual(firstHistory);
    expect(await runtime.db.rows("SELECT data FROM trade_events WHERE run_id=$1 AND action='get_activity' AND status='completed'", [runId]))
      .toEqual([{ data: { eventCount: firstHistory.events.length } }, { data: { eventCount: firstHistory.events.length } }]);
    await expect(runtime.service.execute({...actor,accountId:"account-b"}, "get_activity", {runId})).rejects.toBeInstanceOf(TradeError);
    await expect(runtime.service.execute({...actor,scopes:[]}, "get_account_context", {})).rejects.toBeInstanceOf(TradeError);
  });
  it("supports a real local stdio client using the same account and tools", async () => {
    const directory = await mkdtemp(join(tmpdir(), "cosign-stdio-"));
    const endpoint = origin + "/mcp";
    const filename =
      createHash("sha256")
        .update(endpoint + "http://127.0.0.1:19282/callback")
        .digest("hex") + ".json";
    const info = await runtime.oauth.verifyAccessToken(token);
    await writeFile(
      join(directory, filename),
      JSON.stringify({
        client: await runtime.oauth.clientsStore.getClient(info.clientId),
        tokens: {
          access_token: token,
          refresh_token: refresh,
          token_type: "Bearer",
          expires_in: 900,
        },
      }),
      { mode: 0o600 },
    );
    const client = new Client({ name: "stdio-verification", version: "1" });
    try {
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [
          fileURLToPath(new URL("../dist/trade/stdio.js", import.meta.url)),
        ],
        env: {
          ...Object.fromEntries(
            Object.entries(process.env).filter(
              (entry): entry is [string, string] => entry[1] !== undefined,
            ),
          ),
          COSIGN_MCP_URL: endpoint,
          COSIGN_CREDENTIAL_DIR: directory,
        },
      });
      await client.connect(transport);
      expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(
        expect.arrayContaining(["create_request", "compare_products", "amend_request", "remove_request_items", "update_request_preferences", "prepare_order", "get_request_status"]),
      );
      const result = await client.callTool({
        name: "get_request_status",
        arguments: { runId },
      });
      expect(result.isError).not.toBe(true);
      expect(
        JSON.parse((result.content as { text: string }[])[0].text).id,
      ).toBe(runId);
    } finally {
      await client.close();
      await rm(directory, { recursive: true, force: true });
    }
  }, 20000);
  it("rotates refresh tokens and revokes an entire connection", async () => {
    const info = await runtime.oauth.verifyAccessToken(token);
    const client = (await runtime.oauth.clientsStore.getClient(info.clientId))!;
    const next = await runtime.oauth.exchangeRefreshToken(client, refresh);
    await expect(
      runtime.oauth.exchangeRefreshToken(client, refresh),
    ).rejects.toThrow();
    expect(
      (await runtime.oauth.verifyAccessToken(next.access_token)).extra!
        .accountId,
    ).toBe("account-a");
    await post(`/api/connections/${granted}/revoke`, {});
    await expect(
      runtime.oauth.verifyAccessToken(next.access_token),
    ).rejects.toThrow();
    await expect(runtime.oauth.verifyAccessToken(token)).rejects.toThrow();
  });
});
