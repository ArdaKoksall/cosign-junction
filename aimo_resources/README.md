# Valio Aimo resources

Authorized Junction participants can obtain the official catalog and API access from the organizer. Keep downloaded materials and API credentials local. The Junction demo and standard CI use a synthetic catalog and supplier stub. [Valio challenge portal](https://junction26.valioaimo.fi/) · [Credential-free demo](../README.md#run-the-junction-demo)

## Connect to the challenge API

Create the Git-ignored `aimo_resources/challenge_portal/` directory inside the checkout. Place these three downloads there with their original filenames.

| File | Purpose |
|---|---|
| `valio_aimo_junction26_product_data.json` | Product search and catalog evidence |
| `valio_aimo_junction26_delivery_reliability.csv` | Historical delivery reliability |
| `valio_aimo_junction26_carbon_footprint.csv` | Estimated product-group carbon intensity |

Set `VALIO_API_KEY` in the private root `.env` and follow the account startup steps. The default Compose project mounts the local datasets read-only. [Account startup](../docs/production-mcp.md#local-startup) · [Integration guide](../docs/architecture/valio-integration.md)

## Optional local audit

Run `node validation/valio-resource-audit.mjs` if you have the original `manifest.json`, `materials.html`, `openapi.json`, and `valio_aimo_junction26_product_data_schema.json` alongside the three datasets. The audit verifies the files against the manifest and summarizes their coverage. For an authenticated check, add `--live YYYY-MM-DD` with a supported delivery date. The full-catalog adapter tests run when the local product JSON is present.
