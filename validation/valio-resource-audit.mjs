import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const portal = new URL("../aimo_resources/challenge_portal/", import.meta.url);
const baseUrl = "https://junction26.valioaimo.fi";
const controlProducts = ["463038", "464179", "465039", "464398", "460013", "463989", "000000"];
const baselineDates = ["2026-11-16", "2026-11-20"];
const downloadFiles = {
  products: "valio_aimo_junction26_product_data.json",
  "delivery-reliability": "valio_aimo_junction26_delivery_reliability.csv",
  "carbon-footprint": "valio_aimo_junction26_carbon_footprint.csv",
};
const file = (folder, name) => readFileSync(new URL(name, folder));
const json = (folder, name) => JSON.parse(file(folder, name));

const present = (value) => Array.isArray(value)
  ? value.length > 0
  : value !== undefined && value !== null && value !== "";

function countPresent(records, fields) {
  return Object.fromEntries(fields.map((field) => [
    field, records.filter((record) => present(record[field])).length,
  ]));
}

function frequency(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return Object.fromEntries([...counts.entries()].sort(([a], [b]) => String(a).localeCompare(String(b))));
}

function readSignals(name, catalogIds) {
  // The two supplied CSV files contain unquoted product IDs and numeric values.
  const [header, ...lines] = file(portal, name).toString().trim().split(/\r?\n/);
  const rows = lines.map((line) => line.split(","));
  const ids = new Set(rows.map(([id]) => id));
  const values = rows.map(([, value]) => value?.trim() === "" ? NaN : Number(value));
  const finite = values.filter(Number.isFinite);
  return {
    ids,
    summary: {
      measurement: header.split(",")[1],
      rows: rows.length,
      uniqueIds: ids.size,
      matchedIds: [...ids].filter((id) => catalogIds.has(id)).length,
      invalidValues: values.length - finite.length,
      min: finite.length ? Math.min(...finite) : null,
      max: finite.length ? Math.max(...finite) : null,
    },
  };
}

function profile(manifest) {
  const files = manifest.files.map(({ file: name, bytes, sha256 }) => {
    const contents = file(portal, name);
    const verified = contents.length === bytes && createHash("sha256").update(contents).digest("hex") === sha256;
    if (!verified) process.exitCode = 1;
    return { file: name, bytes: contents.length, verified };
  });
  const productData = manifest.files.find(({ file: name }) => name.endsWith("_product_data.json"));
  const catalog = json(portal, productData.file);
  const ids = new Set(catalog.map(({ id }) => id));
  const synkka = catalog.map(({ synkkaData }) => synkkaData ?? {});
  const nutrientRows = synkka.flatMap(({ nutritionalContent = [] }) => nutritionalContent);
  const groups = synkka.flatMap(({ classifications = [] }) =>
    [...new Set(classifications.filter(({ values }) => present(values)).map(({ name }) => name))]);
  const byId = new Map(catalog.map((product) => [product.id, product]));
  const substitutions = catalog.flatMap(({ substitutions = [] }) => substitutions);
  const linkedProducts = substitutions.flatMap(({ product, substituteProduct }) => {
    const original = byId.get(product);
    const replacement = byId.get(substituteProduct);
    return original && replacement ? [[original, replacement]] : [];
  });
  const reliability = readSignals("valio_aimo_junction26_delivery_reliability.csv", ids);
  const carbon = readSignals("valio_aimo_junction26_carbon_footprint.csv", ids);
  const spec = json(portal, "openapi.json");
  return {
    files,
    operations: Object.entries(spec.paths).flatMap(([path, methods]) =>
      Object.keys(methods).map((method) => `${method.toUpperCase()} ${path}`)),
    catalog: {
      records: catalog.length,
      uniqueIds: ids.size,
      categories: new Set(catalog.map(({ category }) => category)).size,
      vendorNames: new Set(catalog.map(({ vendorName }) => vendorName).filter(present)).size,
      salesUnits: frequency(catalog.map(({ salesUnit }) => salesUnit)),
      fractionalAllowedLotSizes: catalog.filter(({ allowedLotSize }) =>
        Number.isFinite(allowedLotSize) && !Number.isInteger(allowedLotSize)).length,
      oneHundredthLotSizes: catalog.filter(({ allowedLotSize }) => allowedLotSize === 0.01).length,
      fields: countPresent(catalog, ["salesUnitGtin", "units", "countryOfOrigin", "temperatureCondition", "deposits", "substitutions"]),
      synkkaFields: countPresent(synkka, ["names", "brand", "countriesOfOrigin", "ingredients", "keyIngredients",
        "nutritionalContent", "preparationInstructions", "usageInstructions", "storageInstructions",
        "unitConversions", "medias", "fishingReports", "safetyData", "minTemperature", "maxTemperature",
        "vatCode", "producers", "disposalInformations", "marketingTexts", "materialAdditionalDescriptions"]),
      nutritionalDeclarations: {
        rows: nutrientRows.length,
        basisUnits: frequency(nutrientRows.map(({ basisQuantityUnit }) => basisQuantityUnit)),
        precisions: frequency(nutrientRows.map(({ unitPrecision }) => unitPrecision ?? "(unspecified)")),
        multipleBases: synkka.filter(({ nutritionalContent = [] }) =>
          new Set(nutritionalContent.map(({ basisQuantity, basisQuantityUnit }) => `${basisQuantity}:${basisQuantityUnit}`)).size > 1).length,
      },
      nutritionalClaims: frequency(synkka.flatMap(({ classifications = [] }) => classifications
        .filter(({ name }) => name === "nutritionalClaim").flatMap(({ values = [] }) => values.map(({ id, unit }) => `${id}:${unit}`)))),
      variableWeight: synkka.filter(({ variableUnit }) => variableUnit === true).length,
      classificationsWithValues: frequency(groups),
      substitutionLinks: substitutions.length,
      substitutionLinksInCatalog: linkedProducts.length,
      selfSubstitutions: linkedProducts.filter(([original, replacement]) => original.id === replacement.id).length,
      differentCategorySubstitutions: linkedProducts.filter(([original, replacement]) =>
        original.category !== replacement.category).length,
      differentSalesUnitSubstitutions: linkedProducts.filter(([original, replacement]) =>
        original.salesUnit !== replacement.salesUnit).length,
    },
    signals: {
      reliability: reliability.summary,
      carbon: carbon.summary,
      matchedBoth: [...ids].filter((id) => reliability.ids.has(id) && carbon.ids.has(id)).length,
    },
  };
}

async function verifyDownloads(manifest) {
  return Promise.all(manifest.files.filter(({ source }) => {
    const url = new URL(source);
    return url.origin === baseUrl && url.pathname.startsWith("/files/");
  }).map(async ({ file: name, source, bytes, sha256 }) => {
    const response = await fetch(source, { redirect: "manual", signal: AbortSignal.timeout(90_000) });
    const hash = createHash("sha256");
    let receivedBytes = 0;
    if (response.ok && response.body) {
      for await (const chunk of response.body) {
        receivedBytes += chunk.byteLength;
        hash.update(chunk);
      }
    }
    const verified = response.ok && receivedBytes === bytes && hash.digest("hex") === sha256;
    if (!verified) process.exitCode = 1;
    return { file: name, http: response.status, bytes: receivedBytes, verified };
  }));
}

async function checkLive(manifest, dates) {
  if (!process.env.VALIO_API_KEY) {
    try {
      process.loadEnvFile(fileURLToPath(new URL("../.env", import.meta.url)));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  const apiKey = process.env.VALIO_API_KEY;
  if (!apiKey) throw new Error("Set VALIO_API_KEY in the environment or private repository-root .env.");

  async function request(path, payload) {
    return fetch(new URL(path, baseUrl), {
      method: payload ? "POST" : "GET",
      headers: { "X-API-Key": apiKey, ...(payload && { "Content-Type": "application/json" }) },
      body: payload ? JSON.stringify(payload) : undefined,
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
  }

  const ping = await request("/api/ping");
  const pingOk = ping.ok && (await ping.json()).status === "ok";
  if (!pingOk) process.exitCode = 1;
  const downloads = await Promise.all(Object.entries(downloadFiles).map(async ([resource, expectedFile]) => {
    const response = await request(`/api/${resource}/download`);
    const target = response.headers.get("location");
    const expected = manifest.files.find(({ file }) => file === expectedFile);
    const matchesManifest = response.status === 307 && target !== null && expected?.source === new URL(target, baseUrl).href;
    if (!matchesManifest) process.exitCode = 1;
    await response.body?.cancel();
    return { resource, http: response.status, matchesManifest };
  }));

  const lookups = [];
  for (const date of dates) {
    const payload = { customer: "123", requestedDate: date, products: controlProducts };
    const [price, availability] = await Promise.all(["price", "availability"].map(async (route) => {
      const response = await request(`/api/${route}`, payload);
      if (!response.ok) throw new Error(`Valio ${route} returned HTTP ${response.status} for ${date}`);
      const data = await response.json();
      if (!Array.isArray(data.products) || data.products.length !== controlProducts.length ||
          data.products.some((product, i) => product.productId !== controlProducts[i])) {
        throw new Error(`Valio ${route} did not return the requested product IDs in order for ${date}`);
      }
      return data;
    }));
    lookups.push({
      requestedDate: date,
      echoedAvailabilityDate: availability.requestedDate,
      pricingDate: price.pricingDate,
      timeNow: availability.timeNow,
      currency: price.currency,
      products: price.products.map((product, index) => {
        const stock = availability.products[index];
        return {
          id: product.productId,
          priceError: product.error,
          exVat: product.catalogPrice?.value,
          incVat: product.catalogPrice?.valueWithTax,
          netPriceFound: product.netPriceFound,
          taxRate: product.tax?.taxRate,
          priceValidity: Object.fromEntries(["catalogPrice", "priceWithTax", "comparisonPrice", "listPrice"].flatMap((name) => {
            const price = product[name];
            return price ? [[name, { from: price.validFrom, to: price.validTo }]] : [];
          })),
          logisticModel: stock.logisticModel,
          productSalesBlock: stock.salesBlock,
          closingTime: stock.closingTime,
          schedule: stock.scheduleLines,
          scheduleHasRequestedDate: stock.scheduleLines.some(({ availableDate }) => availableDate === date),
        };
      }),
    });
  }
  return { ping: { http: ping.status, ok: pingOk }, downloads, lookups };
}

const args = process.argv.slice(2);
const live = args.includes("--live");
const verifyRemote = args.includes("--verify-downloads");
const dates = args.filter((arg) => arg !== "--live" && arg !== "--verify-downloads");
if (dates.some((date) => !live || !/^\d{4}-\d{2}-\d{2}$/.test(date))) {
  console.error("Usage: node validation/valio-resource-audit.mjs [--verify-downloads] [--live [YYYY-MM-DD ...]]");
  process.exitCode = 1;
} else {
  const manifest = json(portal, "manifest.json");
  const report = { local: profile(manifest) };
  try {
    if (live) report.live = await checkLive(manifest, dates.length ? dates : baselineDates);
    if (verifyRemote) report.remoteDownloads = await verifyDownloads(manifest);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
  console.log(JSON.stringify(report, null, 2));
}
