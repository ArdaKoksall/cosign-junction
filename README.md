# VALIO:Cosign

Cosign is a purchasing workspace for Valio Aimo’s Trusted Trade Agents challenge at Junction. A buyer sets product requirements and a spending limit. The buyer or a connected agent can compare supplier offers, prepare a purchase draft and track its approval in the same account.

- **Supplier evidence.** Search the Valio Aimo challenge catalog and compare dated prices, stock and order cutoffs. Each draft keeps the supplier evidence and its revision.
- **Agent connections.** Connect ChatGPT, Claude, Claude Code, Codex or another MCP client through OAuth, or use the hosted NVIDIA Nemotron assistant.
- **Buyer authority.** Requests outside automatic authority need buyer approval. The decision history records the authorization, amount and receipt for a committed rehearsal.

## Run the Junction demo

Use Docker Compose and create a root `.env` from `.env.example`. Set `POSTGRES_PASSWORD` using `openssl rand -hex 16` and `OAUTH_ENCRYPTION_KEY` using `openssl rand -hex 32`. The demo includes a synthetic catalog, prices, and stock. A fresh checkout can run it without Valio files or provider API keys.

```sh
docker compose -f compose.yaml -f validation/compose-account-rehearsal.yaml \
  -p cosign-judging up --build -d --wait web
```

1. Provision a synthetic buyer and open the workspace at <http://localhost:8182>. [Buyer setup](validation/README.md#account-backed-rehearsal-with-a-local-supplier-stub)
2. Open **New request → Try the Monday milk example**. Check that the request is for 1,000 L of lactose-free milk with a €1,800 ex-VAT cap. In **Product**, search for SKU `900001` and select the 1 L catalog match. Set **Needed by (Helsinki)** to tomorrow.
3. Select **Create request**, then **Check price and availability**, and choose the €1,650 ex-VAT offer. Approve the draft with **Allow draft**, then select **Commit rehearsal order**.
4. Reopen the receipt and show the fixed total, buyer approval and **Decision history**.

To demo the same flow through ChatGPT, connect the rehearsal over HTTPS. The walkthrough includes an unavailable rice line and buyer approval of a revised basket. [Rehearsal tunnel setup](validation/README.md#account-backed-rehearsal-with-a-local-supplier-stub) · [ChatGPT walkthrough](docs/production-mcp.md#chatgpt-judging-walkthrough)

The Valio Aimo challenge endpoints also serve synthetic data. They provide pricing and availability observations and have no documented order submission endpoint. A rehearsal saves a simulated receipt in Cosign and sends no supplier order.

## Development

For the workspace connected to Valio, authorized participants supply the official datasets locally and set `VALIO_API_KEY`. Set `NVIDIA_API_KEY` to enable the hosted assistant. Local development uses Node.js 24. [Valio data setup](aimo_resources/README.md) · [Account setup](docs/production-mcp.md#local-startup) · [Developer setup](docs/architecture/developer-setup.md) · [Mobile app](mobile/README.md)

See the workspace and MCP architecture, supplier integration and test commands. The connected development workspace also includes Nemotron extraction from kitchen notes and photos. [System design](docs/architecture/system-design.md) · [Valio integration](docs/architecture/valio-integration.md) · [Validation](validation/README.md#credential-free-verification) · [Nemotron intake evaluation](validation/model-eval/README.md)

Write project documentation, code identifiers and comments in English. Keep interface copy available in English and Finnish.
