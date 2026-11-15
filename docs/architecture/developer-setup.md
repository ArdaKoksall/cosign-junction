# Developer setup

The default `cosign` Compose project runs the account workspace with locally supplied Valio datasets. The optional fixture simulator uses a separate PostgreSQL database. Both web apps use a same-origin API proxy and bind their ports to the local machine. Copy the root `.env.example` to `.env` and keep provider keys and database credentials in that root file for Compose, VS Code and host development. [Valio data setup](../../aimo_resources/README.md) · [Synthetic demo and checks](../../validation/README.md)

## VS Code Dev Container

1. Start Docker Desktop and open the repo locally in VS Code with the Dev Containers extension installed. The account workspace reads the Valio datasets from the checkout and provider keys from the root `.env`. [Valio data setup](../../aimo_resources/README.md)
2. In the Command Palette choose **Dev Containers: Reopen in Container**. If you are updating an existing container configuration, use **Dev Containers: Rebuild and Reopen in Container** or **Dev Containers: Rebuild Container**.
3. Wait for dependency installation, then select **Cosign (Dev Container)** in Run and Debug and press **F5**. VS Code builds the adapters, generates Prisma, applies migrations, and starts the account API and Vite inside Docker. Open <http://localhost:5173> for a local session. For public HTTPS access, set `NGROK_DOMAIN` and `NGROK_TOKEN` in the root `.env` and open the origin for that domain. [Tunnel setup](../production-mcp.md#optional-ngrok-tunnel)
4. For fixture repricing and mandate development, stop the session and choose **Cosign Simulator (Dev Container)**. The usual local buyer token is `local-demo-buyer`.

**Shift+F5** stops the frontend, API, and any tunnel opened by the debug session. The Dev Container and its PostgreSQL service stay ready for the next run. If a standalone Compose instance already owns the ngrok domain, run `docker compose stop web api` on the Docker host before starting this debug session.

**Dev Containers: Reopen Folder Locally** closes the remote connection. Run `bash .devcontainer/install.sh` in the container after changing dependency lockfiles. Restart the debug session after changing `NGROK_TOKEN`. Rebuild the Dev Container after changing `NGROK_DOMAIN` or `POSTGRES_PASSWORD` so the container receives those settings.

## Host development

Use Node.js 24. Create the root `.env` from `.env.example` if needed, then set `POSTGRES_PASSWORD`, `OAUTH_ENCRYPTION_KEY`, and `VALIO_API_KEY`. Set `NVIDIA_API_KEY` to use the hosted assistant. Set up the local Valio datasets before running these commands from the repository root. [Valio data setup](../../aimo_resources/README.md)

```sh
docker compose up -d --wait db
npm --prefix adapters ci
npm --prefix adapters run build
npm --prefix server ci
npm --prefix server run db:generate
npm --prefix server run db:migrate
npm --prefix client ci
```

Select **Cosign** in VS Code, or run the API and frontend in separate terminals from the repository root.

```sh
PUBLIC_ORIGIN=http://localhost:5173 NGROK_TOKEN='' npm --prefix server run dev
```

```sh
VITE_API_BASE='' npm --prefix client run dev
```

Open <http://localhost:5173>. The API and Prisma derive local database URLs from `POSTGRES_PASSWORD` and `COSIGN_DB_PORT`, which defaults to `55432`. Set `DATABASE_URL` or `SIMULATOR_DATABASE_URL` in the root `.env` when using a different PostgreSQL instance.

## Legacy workspaces

Run the standalone fixture simulator with `docker compose --profile simulator up -d --build --wait simulator-web`. Open <http://localhost:8081> or use the configured `COSIGN_SIMULATOR_WEB_PORT`. The example buyer and agent tokens are for local review.

To develop the fixture simulator on the host, set distinct `COSIGN_BUYER_TOKEN` and `COSIGN_AGENT_TOKEN` in the root `.env`. Stop the account API, then migrate and start the legacy API with the simulator flag.

```sh
COSIGN_ENABLE_SIMULATOR=true npm --prefix server run db:migrate
COSIGN_RUNTIME=legacy COSIGN_ENABLE_SIMULATOR=true npm --prefix server run dev
```

For the legacy connected Valio workflow on the host, start the API with `COSIGN_RUNTIME=legacy COSIGN_ENABLE_CONNECTED_REHEARSAL=true npm --prefix server run dev`. This uses the connected database and real challenge observations. Simulated quote approval requires the configured buyer token. The [validation Compose override](../../validation/README.md#credential-free-verification) can exercise the same workflow with a synthetic supplier response.

## Migrate an existing Docker installation

Update your root `.env` to match the current example, keeping the database password and OAuth encryption key. Use the variable names in `.env.example`. Move any required settings from a server-only env file into the root `.env`. Remove explicit local database URLs if you want Cosign to derive them from the current defaults.

Replace `previous-compose-project` with the name of the old Compose project. From the repository root, stop every service in that project, including PostgreSQL. Leave the stopped database container in place for the migration script.

```sh
legacy_project=previous-compose-project
docker compose -p "$legacy_project" --profile simulator stop
./deploy/migrate-docker-db.sh "$legacy_project" cosign
docker compose up -d --build --wait web
```

The script copies the old data into a fresh `cosign` project volume, renames the database role and databases, and retains the old volume for recovery. Run the script before starting the new project so its destination volume does not already exist. If you used a custom project name, supply the old and new names as arguments.

## Persistence and legacy import

PostgreSQL stores purchase requests, proposals, decision events, buyer mandates and simulated orders. A connected request can have a supplier comparison and a linked rehearsal quote. The event trail records revisions, approval and placement. Order creation, proposal completion and the commit event happen in one serializable transaction. Database uniqueness protects one order per request, one receipt per idempotency key and one delegated order per mandate and Helsinki week. Valio API calls happen outside the write transaction. A database sequence orders lookup starts, including those with the same timestamp, so an older lookup cannot replace a newer saved result.

The application uses PostgreSQL at runtime. The JSON repository remains available to regression tests. With a migrated empty destination, import an existing file explicitly.

```sh
npm --prefix server run db:import -- connected data/state.json
npm --prefix server run db:import -- simulator data/state.json
```

The importer routes draft requests without a proposal to the connected database, and identifies simulated requests by their fixture proposals or receipts. It preserves original IDs, receipt events and saved mandates, including the state and references needed to replay a weekly receipt. It leaves the original file available for recovery.

To wipe both local databases in the default Compose project, stop any host or Dev Container API processes, then run these commands from the repository root. This deletes all saved requests, proposals, mandates, decision events and simulated orders. Compose initializes fresh databases and applies the migrations at startup.

```sh
docker compose --profile simulator down --volumes
docker compose --profile simulator up --build -d --wait web simulator-web
```

## Verification

```sh
npm --prefix adapters run build
npm --prefix adapters test
npm --prefix server test
npm --prefix server run typecheck
npm --prefix client test
npm --prefix client run build
```

Run the [PostgreSQL HTTP smoke test](../../validation/README.md) with the simulator profile for transaction and permission checks. Use a new project name and unused ports to rehearse from an empty database while retaining the main workspace.

```sh
COSIGN_DB_PORT=55433 COSIGN_SIMULATOR_WEB_PORT=8181 \
  docker compose -p cosign-rehearsal --profile simulator up --build -d --wait simulator-web
```

Open the [rehearsal simulator](http://localhost:8181). Set `COSIGN_URL=http://localhost:8181` for the external agent, or `JUNCTION_API_BASE=http://localhost:8181` for the smoke tests.

The GitHub Actions workflow also tests connected checkout on PostgreSQL with a synthetic Valio response. It uses separate databases for the connected workspace and fixture simulator. [GitHub Actions workflow](../../.github/workflows/verify.yml) · [Credential-free verification](../../validation/README.md#credential-free-verification)

## Code map

- [Server composition](../../server/src/app.ts) registers routes, capability reporting and readiness.
- [Purchasing service](../../server/src/purchasing/service.ts) applies requirements, expiry, approvals and idempotency.
- [Prisma repository](../../server/src/prisma-repository.ts) maps purchase records and retries serializable conflicts.
- [Valio adapter](../../adapters/src/live.ts) reads the local catalog and requests only shortlisted product IDs.
- [Nemotron intake](../../server/src/intake/nemotron.ts) drafts cited fields for buyer confirmation. Supplier evidence comes from Valio and ordering authority is enforced by the purchasing service.
