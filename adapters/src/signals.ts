import { readFile } from "node:fs/promises";
import { parseCsv } from "./csv.js";
import { nowUtcIso } from "./time.js";
import type { ProductSignals, SignalValue, SourceProvenance } from "./types.js";

export interface SignalTables {
  reliability: Map<string, number>;
  carbon: Map<string, number>;
  reliabilitySource: SourceProvenance;
  carbonSource: SourceProvenance;
}

function unknownSignal(source: SourceProvenance): SignalValue {
  return { present: false, granularity: "UNKNOWN", source };
}

export function emptySignalTables(kind: SourceProvenance["kind"], label: string): SignalTables {
  const source: SourceProvenance = {
    kind,
    label,
    observedAt: nowUtcIso(),
    revision: 1
  };
  return {
    reliability: new Map(),
    carbon: new Map(),
    reliabilitySource: source,
    carbonSource: source
  };
}

export async function loadSignalTables(options: {
  reliabilityPath?: string;
  carbonPath?: string;
  kind?: SourceProvenance["kind"];
}): Promise<SignalTables> {
  const kind = options.kind ?? "LOCAL_CATALOG";
  const tables = emptySignalTables(kind, "optional product signals");
  if (options.reliabilityPath) {
    const text = await readFile(options.reliabilityPath, "utf8");
    const { rows } = parseCsv(text);
    for (const row of rows) {
      const id = row.productId;
      const raw = row.deliveryReliability?.trim();
      const value = raw ? Number(raw) : NaN;
      if (id && Number.isFinite(value) && value >= 0 && value <= 1) tables.reliability.set(id, value);
    }
    tables.reliabilitySource = {
      kind,
      label: "delivery reliability CSV",
      observedAt: nowUtcIso(),
      revision: 1,
      evidenceRef: options.reliabilityPath
    };
  }
  if (options.carbonPath) {
    const text = await readFile(options.carbonPath, "utf8");
    const { rows } = parseCsv(text);
    const carbonHeader = "AVG kg CO2-eq/kg";
    for (const row of rows) {
      const id = row.productId;
      const raw = row[carbonHeader]?.trim();
      const value = raw ? Number(raw) : NaN;
      if (id && Number.isFinite(value) && value >= 0) tables.carbon.set(id, value);
    }
    tables.carbonSource = {
      kind,
      label: "carbon footprint CSV (product-group estimate)",
      observedAt: nowUtcIso(),
      revision: 1,
      evidenceRef: options.carbonPath
    };
  }
  return tables;
}

export function joinSignals(tables: SignalTables, productIds: string[]): ProductSignals[] {
  return productIds.map((productId) => {
    const reliabilityValue = tables.reliability.get(productId);
    const carbonValue = tables.carbon.get(productId);
    return {
      productId,
      reliability:
        reliabilityValue == null
          ? unknownSignal(tables.reliabilitySource)
          : {
              present: true,
              value: reliabilityValue,
              unit: "score_0_1",
              granularity: "PRODUCT",
              source: tables.reliabilitySource
            },
      carbonKgCo2ePerKg:
        carbonValue == null
          ? unknownSignal(tables.carbonSource)
          : {
              present: true,
              value: carbonValue,
              unit: "kg_CO2e_per_kg",
              granularity: "PRODUCT_GROUP",
              source: tables.carbonSource
            }
    };
  });
}
