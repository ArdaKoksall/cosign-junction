import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  mcpAuthRouter,
  createOAuthMetadata,
} from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { fileURLToPath } from "node:url";
import { createLiveAdapter, type CatalogAdapter } from "@cosign/adapters";
import {
  TradeDb,
  TradeError,
  hash,
  secret,
  requireValue,
  type Actor,
} from "./db.js";
import { TradeOAuth, SCOPES } from "./oauth.js";
import { createTradeMcpServer } from "./mcp.js";
import { passwordHash, passwordMatches } from "./password.js";
import {
  TradeService,
  policySchema,
  toolSchemas,
  toolDescriptions,
  readTools,
  type ToolName,
} from "./service.js";
import { NemotronWorker } from "./worker.js";

export async function buildTradeApp(options: {
  connection: string;
  origin: string;
  apiKey: string;
  encryptionKey: string;
  nvidiaKey?: string;
  model?: string;
  adapter?: CatalogAdapter;
  startWorker?: boolean;
  enableOrderRehearsal?: boolean;
  valioStubMode?: boolean;
}) {
  const url = new URL(options.origin);
  if (
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(url.hostname)
      ))
  )
    throw new Error(
      "PUBLIC_ORIGIN must be an HTTPS origin (HTTP loopback allowed for local verification)",
    );
  const origin = url.origin;
  const db = new TradeDb(options.connection);
  await db.rows("SELECT id FROM trade_accounts LIMIT 1");
  const materials = new URL(
    "../../../aimo_resources/challenge_portal/",
    import.meta.url,
  );
  const adapter =
    options.adapter ??
    createLiveAdapter({
      apiKey: options.apiKey,
      catalogPath: fileURLToPath(
        new URL("valio_aimo_junction26_product_data.json", materials),
      ),
      reliabilityPath: fileURLToPath(
        new URL("valio_aimo_junction26_delivery_reliability.csv", materials),
      ),
      carbonPath: fileURLToPath(
        new URL("valio_aimo_junction26_carbon_footprint.csv", materials),
      ),
    });
  const orderRehearsalAvailable = options.enableOrderRehearsal === true;
  const service = new TradeService(db, adapter, origin, orderRehearsalAvailable, options.valioStubMode);
  const oauth = new TradeOAuth(db, origin, options.encryptionKey);
  const worker = options.nvidiaKey
    ? new NemotronWorker(
        db,
        service,
        options.nvidiaKey,
        undefined,
        options.model,
      )
    : undefined;
  const app = express();
  app.disable("x-powered-by");
  // Only set this behind the documented single, controlled reverse proxy.
  if (process.env.TRUST_PROXY === "1") app.set("trust proxy", 1);
  app.use(helmet());
  app.use(express.json({ limit: "256kb" }));
  app.use(cookieParser());
  app.get("/healthz", async (_req, res) => {
    await db.rows("SELECT 1");
    res.json({ ready: true });
  });
  app.get("/api/capabilities", (_req, res) =>
    res.json({
      mode: "production",
      mcp: true,
      nemotron: Boolean(worker),
      supplierCheckout: false,
      orderRehearsalAvailable,
      ...(options.valioStubMode && { valioStubMode: true }),
      simulatorEnabled: false,
      connectedRehearsalEnabled: false,
    }),
  );
  const cookieName =
    url.protocol === "https:" ? "__Host-trade_session" : "trade_session";
  const cookieOptions = {
    httpOnly: true,
    secure: url.protocol === "https:",
    sameSite: "lax" as const,
    path: "/",
  };
  const dummyHash = await passwordHash(secret());
  const loginLimit = rateLimit({
    windowMs: 15 * 60_000,
    limit: 15,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  });
  app.use("/api", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      (req.headers.origin !== origin ||
        req.headers["x-requested-with"] !== "Cosign")
    ) {
      return res.status(403).json({
        error: "invalid_origin",
        message: "Same-origin request required",
      });
    }
    next();
  });
  app.post("/api/login", loginLimit, async (req, res) => {
    const input = z
      .object({
        email: z.email().max(254),
        password: z.string().min(1).max(256),
      })
      .parse(req.body);
    const account = await db.one(
      "SELECT id,password_hash FROM trade_accounts WHERE email=$1",
      [input.email.toLowerCase()],
    );
    const valid = await passwordMatches(
      input.password,
      account?.password_hash ?? dummyHash,
    );
    if (!account || !valid)
      throw new TradeError(
        401,
        "invalid_login",
        "Email or password is incorrect",
      );
    const token = secret();
    await db.rows(
      "INSERT INTO trade_sessions(hash,account_id,expires_at) VALUES($1,$2,now()+interval '12 hours')",
      [hash(token), account.id],
    );
    res
      .cookie(cookieName, token, { ...cookieOptions, maxAge: 12 * 3600_000 })
      .json({ ok: true });
  });
  app.use("/api", async (req, res, next) => {
    const row = await db.one(
      "SELECT a.id,a.name,a.email,a.policy FROM trade_sessions s JOIN trade_accounts a ON a.id=s.account_id WHERE s.hash=$1 AND s.expires_at>now()",
      [hash(req.cookies[cookieName] ?? "")],
    );
    if (!row)
      return res
        .status(401)
        .json({ error: "login_required", message: "Sign in to your account" });
    res.locals.account = row;
    res.locals.actor = {
      accountId: row.id,
      actorId: `buyer:${row.id}`,
      source: "web",
      scopes: SCOPES,
    } satisfies Actor;
    next();
  });
  app.use(
    "/api",
    rateLimit({
      windowMs: 60_000,
      limit: 240,
      keyGenerator: (_req, res) => res.locals.account.id,
      skip: (req) => req.path === "/events/stream",
    }),
  );
  app.get("/api/session", (_req, res) =>
    res.json({
      account: res.locals.account,
      mcpUrl: oauth.resource,
      nemotronModel: worker?.model ?? null,
      supplierCheckoutAvailable: false,
      orderRehearsalAvailable,
      ...(options.valioStubMode && { valioStubMode: true }),
    }),
  );
  app.post("/api/logout", async (req, res) => {
    await db.rows("DELETE FROM trade_sessions WHERE hash=$1", [
      hash(req.cookies[cookieName] ?? ""),
    ]);
    res.clearCookie(cookieName, cookieOptions).json({ ok: true });
  });
  app.get("/api/connections", async (_req, res) =>
    res.json(
      await db.rows(
        "SELECT g.id,g.scopes,g.created_at,g.revoked_at,c.metadata->>'client_name' AS name FROM trade_grants g JOIN trade_clients c ON c.id=g.client_id WHERE account_id=$1 ORDER BY created_at DESC",
        [res.locals.account.id],
      ),
    ),
  );
  app.post("/api/connections/:id/revoke", async (req, res) => {
    await db.rows(
      "UPDATE trade_grants SET revoked_at=now() WHERE id=$1 AND account_id=$2",
      [req.params.id, res.locals.account.id],
    );
    await db.event(res.locals.actor, null, "connection_revoked", "completed", {
      grantId: req.params.id,
    });
    res.json({ ok: true });
  });
  app.post("/api/policy", async (req, res) => {
    const policy = policySchema.parse(req.body);
    await db.transaction(async (tx) => {
      await db.rows(
        "UPDATE trade_accounts SET policy=$1 WHERE id=$2",
        [JSON.stringify(policy), res.locals.account.id],
        tx,
      );
      await db.rows(
        "UPDATE trade_runs SET approved_revision=NULL,status='active',draft=NULL,revision=revision+1,updated_at=now() WHERE account_id=$1 AND draft IS NOT NULL AND status NOT IN ('cancelled','rejected','completed')",
        [res.locals.account.id],
        tx,
      );
      await db.event(
        res.locals.actor,
        null,
        "policy_updated",
        "completed",
        policy,
        tx,
      );
    });
    res.json(policy);
  });
  app.get("/api/oauth/pending", async (req, res) =>
    res.json(
      await oauth.pending(z.string().min(32).max(100).parse(req.query.id)),
    ),
  );
  app.post("/api/oauth/consent", async (req, res) => {
    const input = z
      .object({ id: z.string().min(32).max(100), allow: z.boolean() })
      .parse(req.body);
    res.json({
      redirect: await oauth.consent(
        input.id,
        res.locals.account.id,
        input.allow,
      ),
    });
  });
  app.get("/api/runs", async (_req, res) =>
    res.json(
      await db.rows(
        "SELECT id,source,actor_id,status,title,requirements,revision,approved_revision,created_at,updated_at,draft,receipt FROM trade_runs WHERE account_id=$1 ORDER BY created_at DESC LIMIT 100",
        [res.locals.account.id],
      ),
    ),
  );
  app.get("/api/runs/:id", async (req, res) =>
    res.json(
      await service.visibleRun(res.locals.actor, req.params.id as string),
    ),
  );
  app.post("/api/runs/:id/decision", async (req, res) => {
    const input = z
      .object({ revision: z.number().int().positive(), approve: z.boolean() })
      .parse(req.body);
    res.json(
      await service.decide(
        res.locals.actor,
        req.params.id as string,
        input.revision,
        input.approve,
      ),
    );
  });
  app.post("/api/runs/:id/cancel", async (req, res) => {
    requireValue(
      await db.one(
        "UPDATE trade_runs SET status='cancelled',updated_at=now() WHERE id=$1 AND account_id=$2 AND status NOT IN ('completed','cancelled','rejected') RETURNING id",
        [req.params.id, res.locals.account.id],
      ),
    );
    await db.event(
      res.locals.actor,
      req.params.id as string,
      "cancel",
      "completed",
      {},
    );
    res.json({ ok: true });
  });
  app.get("/api/agent/tools", (_req, res) => res.json(Object.entries(toolDescriptions).map(([name, description]) => ({
    name,
    description,
    readOnly: readTools.includes(name),
    available: name !== "place_order" || orderRehearsalAvailable,
  }))));
  app.post("/api/tools/:name", async (req, res) => {
    const name = req.params.name as ToolName;
    if (!Object.hasOwn(toolSchemas, name))
      throw new TradeError(404, "unknown_tool", "Unknown tool");
    res.json(await service.execute(res.locals.actor, name, req.body));
  });
  app.post(
    "/api/agent/jobs",
    rateLimit({ windowMs: 60_000, limit: 10 }),
    async (req, res) => {
      if (!worker)
        throw new TradeError(
          503,
          "agent_unavailable",
          "NVIDIA credentials are not configured",
        );
      const { instruction } = z
        .object({ instruction: z.string().trim().min(10).max(8000) })
        .parse(req.body);
      res.status(202).json(await worker.enqueue(res.locals.actor, instruction));
    },
  );
  app.post("/api/agent/jobs/:id/reply", async (req, res) => {
    const { instruction } = z
      .object({ instruction: z.string().trim().min(2).max(8000) })
      .parse(req.body);
    if (!worker)
      throw new TradeError(
        503,
        "agent_unavailable",
        "NVIDIA credentials are not configured",
      );
    requireValue(
      await db.one(
        "UPDATE trade_runs SET messages=messages || $1::jsonb,status='queued',step=0,updated_at=now() WHERE id=$2 AND account_id=$3 AND source='nemotron' AND status IN ('completed','failed') RETURNING id",
        [
          JSON.stringify([{ role: "user", content: instruction }]),
          req.params.id,
          res.locals.account.id,
        ],
      ),
      "This agent task cannot accept a reply yet",
    );
    await db.event(
      res.locals.actor,
      req.params.id as string,
      "buyer_message",
      "completed",
      { content: instruction },
    );
    res.status(202).json({ ok: true });
  });
  app.get("/api/events", async (req, res) => {
    const runId = z.string().max(100).optional().parse(req.query.runId);
    if (runId) await service.run(res.locals.actor, runId);
    const after = z.coerce
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER)
      .default(0)
      .parse(req.query.after);
    res.json(
      await db.rows(
        "SELECT * FROM trade_events WHERE account_id=$1 AND id>$2 AND ($3::text IS NULL OR run_id=$3) ORDER BY id LIMIT 200",
        [res.locals.account.id, after, runId ?? null],
      ),
    );
  });
  const streams = new Map<string, number>();
  app.get("/api/events/stream", async (req, res) => {
    let cursor = z.coerce
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER)
      .default(0)
      .parse(req.headers["last-event-id"] ?? req.query.after);
    const accountId = res.locals.account.id;
    if ((streams.get(accountId) ?? 0) >= 5)
      throw new TradeError(
        429,
        "stream_limit",
        "Too many open activity streams",
      );
    streams.set(accountId, (streams.get(accountId) ?? 0) + 1);
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    let closed = false;
    res.on("close", () => {
      closed = true;
      const count = (streams.get(accountId) ?? 1) - 1;
      if (count) streams.set(accountId, count);
      else streams.delete(accountId);
    });
    while (!closed) {
      try {
        const session = await db.one(
          "SELECT hash FROM trade_sessions WHERE hash=$1 AND expires_at>now()",
          [hash(req.cookies[cookieName] ?? "")],
        );
        if (!session) {
          res.write("event: session_expired\ndata: {}\n\n");
          break;
        }
        const events = await db.rows(
          "SELECT * FROM trade_events WHERE account_id=$1 AND id>$2 ORDER BY id LIMIT 200",
          [res.locals.account.id, cursor],
        );
        for (const event of events) {
          cursor = Number(event.id);
          if (
            !res.write(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`)
          ) {
            closed = true;
            break;
          }
        }
        if (!events.length) res.write(": heartbeat\n\n");
      } catch {
        break;
      }
      if (!closed) await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    res.end();
  });
  app.get("/.well-known/oauth-authorization-server", (_req, res) =>
    res.json({
      ...createOAuthMetadata({
        provider: oauth,
        issuerUrl: new URL(oauth.issuer),
        scopesSupported: SCOPES,
      }),
      authorization_response_iss_parameter_supported: true,
    }),
  );
  app.use("/authorize", (_req, res, next) => {
    // The SDK has already validated the registered callback before redirecting
    // there with an error. Include the issuer for OpenAI's stable callback.
    const setLocation = res.location.bind(res);
    res.location = (target) => {
      if (!URL.canParse(target)) return setLocation(target);
      const callback = new URL(target);
      if (!callback.searchParams.has("error")) return setLocation(target);
      callback.searchParams.set("iss", oauth.issuer);
      return setLocation(callback.href);
    };
    next();
  });
  app.use(
    mcpAuthRouter({
      provider: oauth,
      issuerUrl: new URL(oauth.issuer),
      resourceServerUrl: new URL(oauth.resource),
      scopesSupported: SCOPES,
      resourceName: "VALIO:Cosign",
    }),
  );
  const bearer = requireBearerAuth({
    verifier: oauth,
    resourceMetadataUrl: `${origin}/.well-known/oauth-protected-resource/mcp`,
  });
  app.all(
    "/mcp",
    (_req, res, next) => {
      res.setHeader("Cache-Control", "no-store");
      next();
    },
    bearer,
    rateLimit({
      windowMs: 60_000,
      limit: 90,
      keyGenerator: (req) => String(req.auth!.extra!.accountId),
    }),
    async (req, res) => {
      if (req.headers.origin && req.headers.origin !== origin) {
        res.status(403).json({ error: "invalid_origin" });
        return;
      }
      const auth = req.auth!;
      const actor: Actor = {
        accountId: String(auth.extra?.accountId),
        actorId: String(auth.extra?.actorId),
        source: "mcp",
        scopes: auth.scopes,
      };
      const server = createTradeMcpServer(service, actor, orderRehearsalAvailable);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      res.on("close", () => {
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    },
  );
  app.use(
    (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
      if (res.headersSent) {
        res.end();
        return;
      }
      const status =
        error instanceof TradeError
          ? error.status
          : error instanceof z.ZodError
            ? 400
            : 500;
      if (status === 500)
        console.error(
          "Request failed",
          error instanceof Error ? error.name : "Error",
        );
      res.status(status).json({
        error:
          error instanceof TradeError
            ? error.code
            : status === 400
              ? "invalid_input"
              : "internal_error",
        message:
          error instanceof TradeError
            ? error.message
            : status === 400
              ? "Check the submitted fields"
              : "The operation could not be completed",
      });
    },
  );
  if (options.startWorker !== false) worker?.start();
  return {
    app,
    db,
    service,
    oauth,
    worker,
    close: async () => {
      await worker?.stop();
      await db.pool.end();
    },
  };
}
