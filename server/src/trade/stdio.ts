#!/usr/bin/env node
// Local MCP bridge. OAuth tokens stay in a private local file; stdout is MCP only.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  type OAuthClientProvider,
  UnauthorizedError,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationMixed,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createServer, type Server as HttpServer } from "node:http";
import { readFile, writeFile, mkdir, rename, chmod } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { randomBytes, createHash } from "node:crypto";

const endpoint = new URL(
  process.env.COSIGN_MCP_URL ?? "http://localhost:18080/mcp",
);
if (
  endpoint.username ||
  endpoint.password ||
  endpoint.search ||
  endpoint.hash ||
  endpoint.pathname !== "/mcp" ||
  (endpoint.protocol !== "https:" &&
    !(
      endpoint.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(endpoint.hostname)
    ))
)
  throw new Error("Use an HTTPS MCP URL or local loopback HTTP");
const callbackPort = Number(process.env.COSIGN_OAUTH_PORT ?? 19282);
if (!Number.isInteger(callbackPort) || callbackPort < 1 || callbackPort > 65535)
  throw new Error("COSIGN_OAUTH_PORT must be a port from 1 to 65535");
const callbackUrl = `http://127.0.0.1:${callbackPort}/callback`;
const customDirectory = process.env.COSIGN_CREDENTIAL_DIR;
const directory = customDirectory ?? join(homedir(), ".cosign");
await mkdir(directory, { recursive: true, mode: 0o700 });
await chmod(directory, 0o700);
const credentialName = `${createHash("sha256")
  .update(endpoint.href + callbackUrl)
  .digest("hex")}.json`;
const filename = join(directory, credentialName);
let stored: { client?: OAuthClientInformationMixed; tokens?: OAuthTokens } = {};
try {
  stored = JSON.parse(await readFile(filename, "utf8"));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  if (!customDirectory) {
    try {
      const previous = join(homedir(), ".orderguard", credentialName);
      stored = JSON.parse(await readFile(previous, "utf8"));
      await save();
    } catch (migrationError) {
      if ((migrationError as NodeJS.ErrnoException).code !== "ENOENT") throw migrationError;
    }
  }
}
async function save() {
  const tmp = `${filename}.${process.pid}.${randomBytes(8).toString("hex")}`;
  await writeFile(tmp, JSON.stringify(stored), { mode: 0o600 });
  await rename(tmp, filename);
  await chmod(filename, 0o600);
}
let verifier = "",
  state = "";
let callbackServer: HttpServer | undefined;
let callback: Promise<string> | undefined;
const provider: OAuthClientProvider = {
  redirectUrl: callbackUrl,
  clientMetadata: {
    client_name: "Cosign local connector",
    redirect_uris: [callbackUrl],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    scope: "catalog:read requests:write orders:write",
  },
  state() {
    state = randomBytes(32).toString("base64url");
    return state;
  },
  clientInformation: () => stored.client,
  async saveClientInformation(client) {
    stored.client = client;
    await save();
  },
  tokens: () => stored.tokens,
  async saveTokens(tokens) {
    stored.tokens = tokens;
    await save();
  },
  saveCodeVerifier(value) {
    verifier = value;
  },
  codeVerifier() {
    if (!verifier) throw new Error("Missing PKCE verifier");
    return verifier;
  },
  async invalidateCredentials(scope) {
    if (scope === "all" || scope === "client") delete stored.client;
    if (scope === "all" || scope === "tokens") delete stored.tokens;
    if (scope === "all" || scope === "verifier") verifier = "";
    await save();
  },
  async redirectToAuthorization(url) {
    if (url.origin !== endpoint.origin)
      throw new Error("Unexpected authorization server");
    callback = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        callbackServer?.close();
        reject(new Error("Sign-in timed out"));
      }, 300_000);
      callbackServer = createServer((req, res) => {
        const incoming = new URL(req.url ?? "/", callbackUrl);
        if (incoming.pathname !== "/callback") {
          res.writeHead(404).end();
          return;
        }
        if (
          incoming.searchParams.get("state") !== state ||
          incoming.searchParams.get("iss") !== new URL(endpoint.origin).href
        ) {
          res.writeHead(400).end("Invalid OAuth response");
          return;
        }
        const code = incoming.searchParams.get("code");
        res.setHeader("Content-Type", "text/plain");
        res.setHeader("Cache-Control", "no-store");
        clearTimeout(timer);
        if (!code) {
          res.writeHead(400).end("Connection declined");
          reject(new Error("Connection declined"));
        } else {
          res.end("Cosign connected. Return to your agent application.");
          resolve(code);
        }
        callbackServer?.close();
      });
      callbackServer.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      callbackServer.listen(callbackPort, "127.0.0.1", () => {
        // Never log the callback, code, tokens, or verifier. The browser receives the authorization request directly.
        console.error(
          "Cosign: sign in and approve the connection in your browser.",
        );
        if (process.platform === "darwin")
          execFile("open", [url.href], (error) => {
            if (error) console.error("Could not open the sign-in browser.");
          });
        else if (process.platform === "linux")
          execFile("xdg-open", [url.href], (error) => {
            if (error) console.error("Could not open the sign-in browser.");
          });
        else
          console.error(
            "Automatic browser sign-in is supported on macOS and Linux.",
          );
      });
    });
    // Attach a rejection handler immediately while the MCP transport unwinds UnauthorizedError.
    void callback.catch(() => {});
  },
};
const connectorInfo = {
  name: "cosign-local",
  title: "Cosign local connector",
  version: "1.0.0",
};
let client = new Client(connectorInfo);
async function connect() {
  const transport = new StreamableHTTPClientTransport(endpoint, {
    authProvider: provider,
  });
  try {
    await client.connect(transport);
  } catch (error) {
    if (!(error instanceof UnauthorizedError) || !callback) throw error;
    await transport.finishAuth(await callback);
    await client.close();
    client = new Client(connectorInfo);
    await client.connect(
      new StreamableHTTPClientTransport(endpoint, { authProvider: provider }),
    );
  }
}
await connect();
if (process.argv.includes("--login")) {
  console.error("Cosign local connection authorized.");
  await client.close();
  process.exit(0);
}
const bridge = new Server(
  connectorInfo,
  { capabilities: { tools: {} }, instructions: client.getInstructions() },
);
bridge.setRequestHandler(ListToolsRequestSchema, (request, { signal }) =>
  client.listTools(request.params, { signal }),
);
bridge.setRequestHandler(CallToolRequestSchema, (request, { signal }) =>
  client.callTool(request.params, undefined, { signal }),
);
await bridge.connect(new StdioServerTransport());
async function close() {
  callbackServer?.close();
  await client.close();
  await bridge.close();
}
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => void close());
