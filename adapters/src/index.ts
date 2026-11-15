export * from "./types.js";
export { createFixtureAdapter, FixtureAdapter } from "./fixture.js";
export { createLiveAdapter, LiveValioAdapter } from "./live.js";
export { indexCatalog, loadCatalogFile, shortlistCatalog, claimGate, hasExplicitAllergenAbsence, normalizeCatalogProduct,
  closestCatalogMatches, packConversion, requestedAmountFromQuery, suggestCatalogSpelling,
  type CatalogMismatch, type ClosestCatalogMatch, type ClosestCatalogQuery, type PackConversion, type RequestedAmount } from "./catalog.js";
export { hasLactoseFreeRequirement, lactoseFreeWords, productRequirements, removeLactoseFreeWords, removeRequirementWords,
  requirementClaims, requirementsFromQuery, type ProductRequirement } from "./diet.js";
export { joinSignals, loadSignalTables, emptySignalTables } from "./signals.js";
export { normalizePrice, normalizeAvailability } from "./normalize.js";
export { eurosToCents, eur } from "./money.js";
export { calendarDateInHelsinki } from "./time.js";

import { createFixtureAdapter } from "./fixture.js";
import { createLiveAdapter } from "./live.js";
import type { CatalogAdapter, LiveAdapterOptions } from "./types.js";

export function createCatalogAdapter(
  mode: "fixture" | "live" = (process.env.VALIO_ADAPTER as "fixture" | "live") ?? "fixture",
  options: LiveAdapterOptions = {}
): CatalogAdapter {
  if (mode === "live") return createLiveAdapter(options);
  return createFixtureAdapter();
}
