# VALIO:Cosign account workspace

The default entry point starts the account-backed VALIO:Cosign service for purchasing through MCP and Nemotron. This runtime supports an opt-in order rehearsal and requires a buyer account. `COSIGN_RUNTIME=legacy` starts the separate workspace used for connected and simulator tests. [Development profiles](architecture/developer-setup.md#legacy-workspaces)

## Supplier data and hosted model

- The Valio-connected workspace uses locally supplied organizer data and requests price and availability from the Valio challenge APIs for shortlisted products. The Junction rehearsal uses a separate synthetic catalog and supplier stub. An administrator provisions each account’s customer ID. [Valio data setup](../aimo_resources/README.md) · [Local rehearsal](../validation/README.md#account-backed-rehearsal-with-a-local-supplier-stub)
- Valio’s challenge catalog and APIs contain synthetic data. [Valio integration](architecture/valio-integration.md)
- The organizer's OpenAPI documents ping, price, availability and three data downloads. Live supplier submission returns `supplier_checkout_unavailable`. Draft totals use the observed supplier prices as estimates. An explicit rehearsal can record a simulated commitment at that version's fixed total.
- The hosted agent calls NVIDIA Nemotron using the configured API key and model. It uses the same validated purchasing operations as MCP and the buyer UI. There is no fallback fixture or alternate model.

## Local startup

1. Set up the official datasets locally for the Valio-connected workspace. Copy `.env.example` to `.env` in the repository root. Set `VALIO_API_KEY`, a strong PostgreSQL password and `OAUTH_ENCRYPTION_KEY` (32 random bytes encoded as hex). Set `NVIDIA_API_KEY` to enable the hosted assistant. Keep this file private and use the database's current password with an existing volume. [Valio data setup](../aimo_resources/README.md) · [Database migration](architecture/developer-setup.md#migrate-an-existing-docker-installation)
2. Set `PUBLIC_ORIGIN` to the exact browser origin for runs without ngrok, for example `http://localhost:18080`, and set `COSIGN_WEB_PORT=18080`. Cookies and CSRF checks use the active origin. Only HTTPS and loopback HTTP are accepted.
3. Run `docker compose up -d --build web`. Migrations run before the API starts.
4. Provision each account with its authorized supplier customer ID. Keep the account JSON outside the checkout and set `COSIGN_ACCOUNT_FILE` to its location. The provisioning command reads it from stdin.

   ```sh
   docker compose exec -T api node dist/trade/provision.js < "$COSIGN_ACCOUNT_FILE"
   ```

   The input fields are `name`, `email`, `password` (at least 14 characters), and `customerId`. Protect/delete the input file after delivery. Passwords are stored using scrypt with N=131072, r=8, p=1; sessions and OAuth tokens are hashed. OAuth client secrets are AES-256-GCM encrypted using the separately configured encryption key.

5. Sign in. Set mandatory requirements and the per-order autonomous spending limit in **Authority**. A zero limit requires buyer review for paid purchases. Missing delivery evidence still requires review; approval cannot manufacture missing supplier guarantees.

## Agent connections

Open **Connections** in the workspace and choose your assistant. Copy the server address from this screen so it matches the deployment you are signed in to.

| Client | Setup |
| --- | --- |
| **ChatGPT** | In [ChatGPT Plugins on the web](https://chatgpt.com/plugins), choose **+ → Add custom MCP server**. Enter `VALIO:Cosign` and the server address. Choose **OAuth** and dynamic client registration. Create and install the plugin, then sign in to Cosign when prompted. If the option is missing, check the ChatGPT workspace’s custom MCP permissions. [OpenAI setup guide](https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt) |
| **Claude app** | Open **Customize → Connectors**, choose **+ Add → Add custom connector**, and enter `VALIO:Cosign` and the server address. For OAuth setup, choose **Sign in now** and **Register automatically**. For Team or Enterprise, an owner adds it under **Organization settings → Connectors → Add → Custom → Web**, then each member connects. [Anthropic setup guide](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp) |
| **Claude Code** | Run `claude mcp add --transport http cosign <mcp-url>`. In Claude Code, open `/mcp`, select `cosign`, and follow the browser sign-in. [Claude Code MCP guide](https://code.claude.com/docs/en/mcp) |
| **Codex** | Run `codex mcp add cosign --url <mcp-url>`, then `codex mcp login cosign` to open the browser sign-in. [Codex MCP guide](https://developers.openai.com/codex/mcp) |
| **Custom agent** | Add `VALIO:Cosign` as a Streamable HTTP MCP server using the URL from **Connections**. Configure OAuth discovery and dynamic client registration with the authorization code flow and PKCE (S256). Start OAuth from your agent, then sign in to Cosign and approve access in your browser. To verify access, call the read-only `get_account_context` tool with `{}`. [MCP authorization guide](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization) |

ChatGPT, the Claude app, and hosted custom agents need a publicly reachable HTTPS origin. Local clients such as Claude Code and Codex can use a loopback HTTP address when running on the same machine as the workspace. Sign in with your buyer account and approve the requested permissions. You can revoke a client under **Your connections**.

## Claude Desktop local bridge

The stdio bridge uses OAuth to the local account-backed server; it does not bypass identity or access the database directly. Build the adapter and server first:

```sh
npm --prefix adapters ci
npm --prefix adapters run build
npm --prefix server ci
npm --prefix server run build
COSIGN_MCP_URL=http://localhost:18080/mcp node server/dist/trade/stdio.js --login
```

The login command opens your browser. Sign in and approve the connector. The bridge saves OAuth credentials under `~/.cosign/` and migrates matching credentials from the old location on first use. Then configure the desktop client.

```json
{
  "mcpServers": {
    "cosign": {
      "command": "/path/to/node",
      "args": ["/path/to/cosign/server/dist/trade/stdio.js"],
      "env": { "COSIGN_MCP_URL": "http://localhost:18080/mcp" }
    }
  }
}
```

Use `COSIGN_OAUTH_PORT` if another local connector uses port 19282. Set `COSIGN_CREDENTIAL_DIR` to use a different credential directory. A local desktop stdio client needs the server and database running on the same machine.

## Optional ngrok tunnel

Set `NGROK_DOMAIN` to your ngrok hostname without the `https://` prefix and set `NGROK_TOKEN` to its authtoken in the root `.env`. Run `docker compose up -d --build web`. The API starts the tunnel to the Compose web service and uses the domain for the buyer workspace, OAuth metadata, and review links.

For a tunnel that follows the local debug session, use [Cosign (Dev Container)](architecture/developer-setup.md#vs-code-dev-container).

Open the buyer workspace on your assigned HTTPS origin. Configure connectors with the URL shown in **Connections**, which ends in `/mcp`. Set `COSIGN_MCP_URL` to the same endpoint for the stdio bridge.

To return to your configured `PUBLIC_ORIGIN`, remove or clear `NGROK_TOKEN` and run the same Compose command again. The recreated API runs without a tunnel.

## Remote MCP: ChatGPT and Claude cloud connectors

Cloud connectors require a public HTTPS origin. Use the ngrok tunnel described above or set `PUBLIC_ORIGIN` to your HTTPS deployment, then add `/mcp` as a custom connector. The service provides Streamable HTTP, OAuth discovery (including protected-resource metadata), dynamic registration, PKCE S256, resource-bound tokens, refresh rotation and revocation. Public clients and `client_secret_post` clients are supported. Each connector requires buyer consent in its account's connection flow. Protocol tests use the official MCP SDK.

Expose `/mcp`, `/.well-known/*`, `/authorize`, `/token`, `/register`, `/revoke` and the buyer web application through the same origin. The included Nginx config disables buffering for MCP and browser event streams. `TRUST_PROXY=1` is only appropriate behind the single controlled Nginx proxy shown in Compose. Rate limits are process-local; use an edge/distributed limiter before horizontal public deployment. Keep encryption keys stable, configure database backups/TLS as required by the deployment, and manage operator account provisioning and password recovery outside the agent.

### ChatGPT judging walkthrough

Use the isolated rehearsal workspace and a buyer with a zero automatic spending limit. Its overview and review link identify the simulated supplier prices and stock. Confirm that the public `/api/capabilities` response advertises `orderRehearsalAvailable: true`, `valioStubMode: true`, and `supplierCheckout: false`. Use an account with access to custom MCP write actions, select VALIO:Cosign in ChatGPT on the web, and use the same buyer to approve in the CoSign browser workspace. If a fresh browser shows the ngrok landing page, select **Visit Site** to open this demo. [OpenAI setup and permissions](https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt) · [Local SDK fallback](../validation/README.md#automated-mcp-rehearsal)

1. **Draft.** “Use VALIO:Cosign to check my account and prepare a draft for 1,000 L of lactose-free milk, SKU `900001`, by tomorrow in Helsinki. My maximum is €1,800 ex VAT. Show me the total and buyer review link.” The stub supplies 1,200 units at €1.65 each. The expected draft totals €1,650 ex VAT.
2. **Approve.** Open the review link, sign in if prompted, and choose **Allow draft**. The browser shows the revision, amount and estimated date.
3. **Commit.** Select VALIO:Cosign again. “Check the approval for that draft and commit it in rehearsal mode. Show me the fixed total, who authorized it and the receipt ID.” Reopen the buyer view to show the saved simulated receipt and decision history.
4. **Show an exception.** In a fresh request, include the same milk and 5 kg of parboiled rice, SKU `900002`. Ask which line is available and request the review link after agreeing to omit the rice. The review should list the omitted rice before the buyer approves the revised milk draft.

## Multi-item purchase requests

Pass an `items` array to `create_request` to keep up to 10 items in one request. Each item needs a query or exact `productId`, a quantity and unit, and any dietary and allergen requirements. Use `sales_unit` with an exact product ID to order whole supplier packs in valid lots. The flat input fields are still accepted for single-item requests.

```json
{
  "items": [
    { "query": "chicken breast", "quantity": 10, "unit": "kg" },
    { "query": "rice", "quantity": 2, "unit": "kg" }
  ],
  "deadline": "2030-11-18T12:00:00+02:00",
  "deliveryMode": "by",
  "budgetCents": 15000
}
```

`budgetCents` and `deadline` are optional. Leave out `budgetCents` to compare without a buyer-imposed price cap. Leave out `deadline` to check upcoming supplier delivery dates. An amount defaults to `budgetMode: "hard"`. Use `"preferred"` for a target that can be exceeded with a caveat on the estimate. A deadline defaults to `deliveryMode: "by"`, which allows earlier deliveries. Use `"on"` for the specified Helsinki calendar day or `"preferred_by"` and `"preferred_on"` for flexible dates. The account's approval policy still applies. When retrying creation, send the original inputs and the same optional `idempotencyKey`. A matching retry returns the existing request. Changing the inputs under that key returns a conflict.

Use `compare_products` with the returned `runId`. This tool writes a new comparison revision and requires `requests:write`. Inspect `itemAvailability` to distinguish insufficient stock, missing catalog matches, hard constraints, and unverified supplier responses. A missing supplier row can leave stock unverified while other rows in the same response remain usable. Retry a failed lookup before describing a line as out of stock.

- Search for replacements with `search_products`, the relevant `itemId`, and a query override. When `observedCoverage` shows some stock, you can also offer a smaller quantity. Once the buyer chooses a replacement or changes the quantity, call `amend_request` with the current revision, line ID, and updated item. Dietary and allergen requirements carry forward.
- If `partialBasketPlan` is present, show the buyer the proposed omissions and estimated total for the remaining lines. After the buyer opts in, pass the current `runId`, `revision`, and chosen `itemIds` to `remove_request_items`. The request retains at least one line and records omissions under `requirements.excludedItems` for review.
- If the buyer changes the budget or date, call `update_request_preferences` with the current `runId` and `revision`. Send only the fields that changed. Set `budgetCents` or `deadline` to `null` to clear that constraint, or send just the mode to change how the existing target is applied.

Each edit invalidates the previous comparison and draft. Agent changes to an item or quantity, omitted lines, and relaxations of hard budget or delivery constraints require the buyer to approve the revised draft even when it is within the account limit. The buyer can see the changes in the approval view. Call `compare_products` again and prepare from the new comparison revision. Pass the optional `revision` to `compare_products` to recheck a specific version after an edit. Tool execution failures include `error` and `message` in both structured and text results.

Read `deliveryOffers` for date-specific prices and stock, and `comparison.basketPlan` for a feasible set of selections when available. Send the comparison revision and one `{ "itemId": "…", "productId": "…", "availableDate": "…" }` entry per current item in `prepare_order.selections`. You can omit dates to let the server choose a feasible schedule for the selected products. A flat request accepts `productId` and optional `availableDate` directly. The supplier reports calendar days. A `time_unverified` offer has a day estimate with no verified arrival time for the deadline. The buyer reviews the selected schedule, estimated total, omissions, and any preference deviations in one draft.

## Order rehearsal

Enable `COSIGN_ENABLE_ORDER_REHEARSAL=true` for the judging workspace and apply the server migrations. The default is disabled. The session and MCP account context expose `orderRehearsalAvailable` independently from `supplierCheckoutAvailable`.

1. Create a request, call `compare_products` and prepare a draft using its current revision.
2. If the draft needs human approval, share its `reviewUrl` with the buyer. Wait for their decision and call `get_request_status` to read the approved revision. A draft inside the account's automatic authority may instead be `ready`.
3. At the buyer's explicit request, call `place_order` with `runId`, the authorized `revision`, a stable `idempotencyKey` of at least 16 characters, and `mode: "rehearsal"`. Rehearsal-enabled workspaces advertise the MCP tool, which requires `orders:write`.
4. Show the amount, `receiptId`, and authorization. The response has `kind: "order_rehearsal"` and `submittedToSupplier: false`. The same key and revision replay the original receipt. The browser opens the same receipt and decision history after reload.

A rehearsal requires a current draft, current account rules and fresh supplier evidence with an open cutoff. An expired draft needs a fresh comparison, selection and any newly required approval. The receipt fixes the simulated amount and performs no stock reservation or supplier delivery.

## State and authority

- Every operation is scoped by authenticated account, not a model-selected account ID.
- OAuth grants contain `catalog:read`, `requests:write`, and/or `orders:write`. None authorizes human approval.
- Only the buyer's signed-in account session can approve or reject a draft. Approval is version-bound. Fresh comparisons and changed account policies invalidate drafts and approvals.
- Account requirements are merged into every request and cannot be relaxed through MCP arguments.
- Events persist before/after tool execution. Browser SSE is account-scoped, rechecks the session, and replays from `Last-Event-ID`. Browser views show recorded outputs rather than fabricated progress or hidden model reasoning.
- Nemotron jobs persist their conversation and tool results in PostgreSQL. Workers claim jobs with leases, checkpoint each step, and pause for buyer approval. Approval wakes the waiting parent job. Work has a 20-step bound, request timeouts, cancellation and no fake-success path. Crash retries of request creation use deterministic IDs. A future supplier checkout connector must additionally implement supplier-side idempotency, unknown-outcome reconciliation, authoritative fixed-price validation and final approval/policy revalidation before any submission is enabled.

## Verification

```sh
TEST_TRADE_DATABASE_URL=postgresql://... npm --prefix server test
npm --prefix client test -- --run
npm --prefix client run build
npm --prefix server run build
```

The integration suite creates and removes its own random PostgreSQL schema. It verifies HTTP OAuth/PKCE, MCP SDK exchange, account isolation, mandatory account rules, and fail-closed checkout. Purchase scenarios use seeded supplier evidence to cover hard and preferred constraints, omitted inputs, and partial availability and recovery.

References: [MCP tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools), [OpenAI authentication](https://developers.openai.com/plugins/build/auth), [Claude remote connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp), [NVIDIA tool calling](https://docs.nvidia.com/nim/large-language-models/2.0.5/advanced-use-cases/tool-calling-and-mcp.html).

## Linux deployment

Use a Linux host with Docker Compose and systemd. Check out `main` and configure the repository’s private `.env`. Set `PUBLIC_ORIGIN` to your HTTPS hostname and keep the database password and OAuth encryption key stable. Point the reverse proxy at the loopback port configured by `COSIGN_WEB_PORT`. MCP is available at `/mcp` on the same origin.

If you have an existing Cosign database in another Compose project, stop its updater and migrate the database before starting the `cosign-live` project. Use `cosign-live` as the migration destination. [Database migration](architecture/developer-setup.md#migrate-an-existing-docker-installation)

From the deployment checkout, update `main` and install the updater.

```sh
git switch main
git fetch origin refs/heads/main:refs/remotes/origin/main
git merge --ff-only origin/main
sudo ./deploy/install-auto-update.sh
```

The systemd timer checks `origin/main` every 30 seconds. The updater fast-forwards the clean checkout, builds images, applies migrations, and recreates the API and web containers. The existing database volume and `.env` stay in place. The installer stores the checkout location locally. Rerun it after moving the checkout or updating the installation scripts or unit files.

```sh
systemctl status cosign-update.timer
journalctl -u cosign-update.service -n 80 --no-pager
docker compose -p cosign-live ps
```

The updater records the deployed revision after container and HTTP health checks pass. Set `COSIGN_HEALTH_URL` in the updater’s environment if you need to override its health endpoint. Failed builds leave existing containers running and retry on the next check. A migration or startup failure is retried, and the prior database is never automatically restored. Keep migrations compatible with the preceding app version. Local edits or a rewritten `main` stop deployment until an operator updates the checkout.

Pause updates with `sudo systemctl stop cosign-update.timer`. An active rollout can finish. Start the timer again with `sudo systemctl start cosign-update.timer`.

### Verify automatic rollout

Watch `journalctl -u cosign-update.service -f` after pushing an ordinary update to `main`. Confirm `Deployment healthy` reports the new revision and the public `/healthz` endpoint responds.
