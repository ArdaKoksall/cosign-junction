# VALIO:Cosign buyer workspace

The React, Vite and TypeScript client selects the workspace based on the API's runtime mode. In the default account workspace, buyers sign in to browse the catalog, review purchasing requests, set account rules and use the hosted Nemotron assistant or connect an MCP client. [Account setup](../docs/production-mcp.md#local-startup)

The legacy runtime provides two rehearsal workflows.

- **Connected workspace.** Enter a request manually or use a note such as `10kg chicken breast` to fill the product, quantity, unit and suggested budget. Nemotron can interpret longer notes and photos when configured. Review the editable fields, then compare Valio challenge prices and availability. Open a saved request to review its latest comparison. With connected rehearsal enabled, sign in as the buyer to prepare an eligible simulated quote, approve it and place a simulated order on that request.
- **Simulator.** Enter the local buyer token to review and approve a fixture basket. Simulate a price change, approve the new revision and retry the checkout to recover the same receipt. The weekly milk mandate controls one simulated purchase per Helsinki week.

## Run

Follow the [Dev Container setup](../docs/architecture/developer-setup.md#vs-code-dev-container) for VS Code development or [Docker Compose startup](../docs/production-mcp.md#local-startup) for the account workspace.

For local Vite development with the API already running on port 3001, run these commands from the repository root.

```sh
npm --prefix client ci
VITE_API_BASE='' npm --prefix client run dev
```

Open <http://localhost:5173>. Set the API's `PUBLIC_ORIGIN` to `http://localhost:5173` for account sign-in. The blank `VITE_API_BASE` uses the local Vite proxy, which forwards requests to port 3001. [Host development](../docs/architecture/developer-setup.md#host-development)

HeroUI wrappers live in [components/ui.tsx](src/components/ui.tsx). The [screens](src/screens/) render intake, comparisons, approvals, order history and the weekly mandate. The repository's styles support the published client. An optional local `src/heroui-pro.css` is Git-ignored.

The shared [theme](src/styles.css) and [wordmark](src/components/CoSignBrand.tsx) serve both workspaces. The interface follows the browser's language and color scheme by default and falls back to English if neither English nor Finnish is preferred. Use **Language and appearance** to override either preference.

The main photo is from [Valio Aimo's Pikatukut page](https://www.valioaimo.fi/asiakkaaksi/pikatukut/). The handwritten wordmark uses [Caveat](public/licenses/caveat.txt).

The kitchen briefs are editable samples. Search by product name, challenge SKU or barcode and combine dietary requirements with explicit allergen-absence declarations. A catalog result carries selected requirements into the request. Open its detail panel to inspect pack measurements, nutrition, ingredient origins and linked substitutes. Supplier lookup checks the same products across up to three dates and reports price and availability feed results separately. [Valio integration](../docs/architecture/valio-integration.md)

The Monday milk example uses a [photo by Eugenia Pan'kiv on Unsplash](https://unsplash.com/photos/a-glass-of-milk-and-a-bottle-of-milk-on-a-counter-mM8W4cxT-kI).

## Verify

```sh
npm --prefix client test
npm --prefix client run build
```

[Browser and MCP rehearsal](../validation/README.md#account-backed-rehearsal-with-a-local-supplier-stub)
