# Validation

## Account-backed rehearsal with a local supplier stub

The rehearsal runs the account workspace and its MCP endpoint with a separate database. The synthetic catalog and supplier stub provide a 1 L lactose-free milk product (`900001`) and mark parboiled rice (`900002`) as blocked. Copy `.env.example` to `.env` and set `POSTGRES_PASSWORD` and `OAUTH_ENCRYPTION_KEY` before starting the isolated Compose project. This flow needs neither official Valio datasets nor provider API keys. [Demo setup](../README.md#run-the-junction-demo)

```sh
docker compose -f compose.yaml -f validation/compose-account-rehearsal.yaml \
  -p cosign-judging up --build -d --wait web
```

Keep a private JSON file outside the checkout with the buyer’s `name`, `email`, `password` (at least 14 characters), and a synthetic `customerId`. Set `COSIGN_ACCOUNT_FILE` to its location, then provision the buyer.

```sh
docker compose -f compose.yaml -f validation/compose-account-rehearsal.yaml \
  -p cosign-judging exec -T api node dist/trade/provision.js < "$COSIGN_ACCOUNT_FILE"
```

1. Open the local workspace at `http://localhost:8182` and sign in as the buyer. Keep the automatic spending limit at €0 to demonstrate buyer approval.
2. Choose **New request → Try the Monday milk example**. In **Product**, search for `900001` and select the 1 L catalog match. Set **Needed by (Helsinki)** to tomorrow.
3. Choose **Create request**, then **Check price and availability**. Select the eligible offer for 1,000 L at €1,650 ex VAT.
4. Choose **Allow draft**, then **Commit rehearsal order**. Reopen the request to show the fixed receipt and **Decision history**.

Stop the stack with the same Compose files and project name. Set `COSIGN_REHEARSAL_WEB_PORT` and `COSIGN_REHEARSAL_DB_PORT` before starting Compose if its default ports, 8182 and 55434, are occupied. Use `localhost` with the selected web port so the address matches the configured OAuth origin.

For a ChatGPT web rehearsal, set `NGROK_DOMAIN` and `COSIGN_REHEARSAL_NGROK_TOKEN` in the environment or a private Compose env file before starting the isolated stack. The tunnel serves the buyer workspace and `/mcp` on the same HTTPS origin. Connect ChatGPT to that public origin. [ChatGPT judging walkthrough](../docs/production-mcp.md#chatgpt-judging-walkthrough)

### Automated MCP rehearsal

The smoke runs against the account-backed Compose setup above. It uses the official MCP SDK version pinned by the server and requires Node.js 24 and an installed `server/node_modules` (`npm --prefix server ci`). Provision a dedicated synthetic buyer with a zero automatic spending limit using the same Compose files and project name.

```sh
export COSIGN_REHEARSAL_EMAIL="rehearsal-$(openssl rand -hex 4)@cosign.invalid"
export COSIGN_REHEARSAL_PASSWORD="$(openssl rand -hex 16)"
node -e 'console.log(JSON.stringify({ name: "Rehearsal smoke buyer", email: process.env.COSIGN_REHEARSAL_EMAIL, password: process.env.COSIGN_REHEARSAL_PASSWORD, customerId: "rehearsal-smoke" }))' | \
  docker compose -f compose.yaml -f validation/compose-account-rehearsal.yaml \
    -p cosign-judging exec -T api node dist/trade/provision.js
COSIGN_REHEARSAL_URL="http://localhost:${COSIGN_REHEARSAL_WEB_PORT:-8182}" \
  npm --prefix validation run account-rehearsal
```

The smoke checks OAuth discovery, PKCE and tool discovery, then runs three scenarios with a fixed €1,650 ex-VAT amount for 1,000 L of milk.

1. With a €0 automatic limit, commitment requires the buyer to approve the milk draft.
2. With a €2,000 automatic limit, the same draft can be rehearsed under account policy.
3. With the €2,000 limit still in place, a two-item request shows the blocked rice and a feasible milk-only basket. The agent proposes removing the rice and refreshes the comparison. The resulting draft carries the proposed omission into buyer review, and commitment requires buyer approval of that revision.

Retries return the same receipt within each scenario, and the buyer session can reopen each receipt. The smoke restores the synthetic buyer's initial policy and leaves the three simulated requests available for review. CI runs the same check on a fresh Compose project. For a dedicated public demo stack, set `COSIGN_REHEARSAL_URL` to its HTTPS origin. The check verifies stub mode before signing in and requires a Secure session cookie.

## PostgreSQL simulator smoke test

Use Node.js 24. Configure `POSTGRES_PASSWORD` and `OAUTH_ENCRYPTION_KEY` in the root `.env`, then start the Compose simulator and run the test from the repository root. The commands use the default local simulator tokens. Use your configured values if they differ.

```sh
docker compose --profile simulator up --build -d --wait simulator-web
JUNCTION_API_BASE=http://localhost:8081 \
COSIGN_BUYER_TOKEN=local-demo-buyer \
COSIGN_AGENT_TOKEN=local-demo-agent \
npm --prefix validation test
```

For VS Code, start **Cosign Simulator (Dev Container)** and run `JUNCTION_API_BASE=http://localhost:5173 npm --prefix validation test` in the container terminal. The workspace receives both simulator tokens through Compose. [Dev Container setup](../docs/architecture/developer-setup.md#vs-code-dev-container)

The script polls the capabilities endpoint, creates a unique request and verifies the €1,264 → €1,328 price change. It checks forbidden agent approval and commit, rejection of an old revision, one receipt for two concurrent commits with the same key, rejection of a fresh key on the same request, and exactly one commit event in the stored receipt.

Set `JUNCTION_WAIT_MS` to override the 60-second startup timeout and `JUNCTION_DEADLINE` to override the default UTC deadline. The smoke test leaves its request and receipt available for review.

## Connected Valio observations

Run the connected PostgreSQL smoke against an isolated legacy connected workspace. It checks combined catalog claims, reloads a saved request with its decision events, searches and pages through request history, and verifies the supplier and checkout permission boundaries. The no-match lookup uses the synthetic catalog when run with the credential-free profile.

```sh
JUNCTION_API_BASE=http://localhost:8180 npm --prefix validation run connected
```

For a manual run against the official challenge API, supply the local datasets and `VALIO_API_KEY` and use an authorized buyer account. Start the account workspace, select a lactose-free milk SKU from the authorized catalog, and set **Needed by (Helsinki)** to a future date supported by Valio. Check price and availability, and choose a different date or SKU if the supplier reports an unusable price, stock or cutoff. [Valio data setup](../aimo_resources/README.md) · [Account startup](../docs/production-mcp.md#local-startup) · [Supplier evidence](../docs/architecture/valio-integration.md#interpret-the-response)

Run the connected rehearsal smoke against an isolated legacy connected workspace with rehearsal enabled. It creates a request, reopens the saved supplier comparison, and checks buyer-only quote approval and duplicate receipt recovery. Export the workspace's `COSIGN_BUYER_TOKEN` and `COSIGN_AGENT_TOKEN`. Choose `JUNCTION_PRODUCT_ID` from the authorized catalog and set `JUNCTION_DEADLINE` to a supported future ISO timestamp with an open cutoff and usable price. [Legacy workspaces](../docs/architecture/developer-setup.md#legacy-workspaces)

```sh
JUNCTION_API_BASE=http://127.0.0.1:8180 \
JUNCTION_PRODUCT_ID="${JUNCTION_PRODUCT_ID:?Set an eligible product SKU}" \
JUNCTION_DEADLINE="${JUNCTION_DEADLINE:?Set a supported future ISO timestamp}" \
  node --env-file=.env validation/connected-rehearsal-smoke.mjs
```

The optional resource audit checks the official files against a local manifest and profiles their coverage. It requires authorized access to the challenge materials. [Local audit setup](../aimo_resources/README.md#optional-local-audit)

For the connected photo-to-comparison flow and hosted evaluation, use the Nemotron guide. [Nemotron intake evaluation](model-eval/README.md)

## Delegated weekly purchase

Run `npm --prefix validation run routine` with the same variables against an isolated simulator without an existing weekly receipt. It verifies that only the buyer can grant a mandate, then tests an insufficient cap, revocation and two concurrent agent executions that return the same €120 order. The script leaves its test mandate and receipt in that simulator. [Isolated Compose rehearsal](../docs/architecture/developer-setup.md#verification)

## Credential-free verification

The CI Compose override uses the synthetic catalog and a Valio-compatible stub with milk and blocked rice responses. The legacy smoke uses the milk response. The stack uses the same Valio adapter and PostgreSQL repositories as the application and enables the legacy connected approval and checkout routes. Configure `POSTGRES_PASSWORD` and `OAUTH_ENCRYPTION_KEY` in the root `.env` before running the checks locally with clean databases and unused ports.

```sh
export COSIGN_BUYER_TOKEN=local-demo-buyer COSIGN_AGENT_TOKEN=local-demo-agent
export COSIGN_DB_PORT=55433 COSIGN_WEB_PORT=8180 COSIGN_SIMULATOR_WEB_PORT=8181
docker compose -f compose.yaml -f validation/compose.yaml -p cosign-validation \
  --profile simulator up --build -d --wait web simulator-web
JUNCTION_API_BASE=http://localhost:8180 npm --prefix validation run connected
JUNCTION_API_BASE=http://localhost:8180 \
JUNCTION_PRODUCT_ID=900001 \
JUNCTION_DEADLINE="$(node -p 'new Date(Date.now() + 3 * 86_400_000).toISOString()')" \
  npm --prefix validation run rehearsal
JUNCTION_API_BASE=http://localhost:8181 npm --prefix validation test
JUNCTION_API_BASE=http://localhost:8181 npm --prefix validation run routine
docker compose -f compose.yaml -f validation/compose.yaml -p cosign-validation \
  --profile simulator down -v
```

The last command removes the dedicated verification databases. [Live supplier checks](#connected-valio-observations) · [Hosted Nemotron evaluation](model-eval/README.md)
