import { calendarDateInHelsinki, requirementClaims, type CatalogAdapter, type ProductRequirement } from "@cosign/adapters";
import { requiredSalesUnits, supplierCostIssues, supplierUnitPriceCents } from "../purchasing/quantity.js";
import type { BudgetEstimate, Draft } from "./fields.js";

type EstimateInput = Draft & { query: string; quantity: number; unit: NonNullable<Draft["unit"]> };

const formatEuro = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" });
const plainChickenBreast = /^(?:chicken breast(?: fillets?)?|(?:kanan|broilerin) rintafilee(?:tä)?|kananrintafilee(?:tä)?)$/iu;
const preparedChicken = /\b(?:breaded|battered|tempura|marinated|sauced|skewer|cooked|grilled|roasted|sous vide|nugget|brine|bone in|popcorn)\b/iu;

function planningEstimate({ query, quantity, unit }: EstimateInput): BudgetEstimate | null {
  if (!plainChickenBreast.test(query) || (unit !== "kg" && unit !== "g")) return null;
  const kilograms = unit === "kg" ? quantity : quantity / 1000;
  const referenceCents = 900;
  return {
    totalCents: Math.round(kilograms * referenceCents),
    source: "planning_reference",
    label: `Planning assumption of ${formatEuro.format(referenceCents / 100)}/kg ex VAT`,
  };
}

async function catalogEstimate(
  input: EstimateInput, adapter: CatalogAdapter, now: Date, requirements: ProductRequirement[], signal: AbortSignal,
): Promise<BudgetEstimate | null> {
  const { query, quantity, unit, diet, deadline, deadlineDate } = input;
  const shortlist = await adapter.shortlist({
    query, limit: 12,
    requiredClaims: requirementClaims([...new Set<ProductRequirement>([...requirements, ...(diet === "lactose-free" ? ["lactose-free" as const] : [])])]),
  });
  signal.throwIfAborted();
  const eligible = shortlist.flatMap(({ product }) => {
    if (plainChickenBreast.test(query) && preparedChicken.test(product.displayName)) return [];
    if (supplierCostIssues(product).includes("DEPOSIT_CHARGES_UNVERIFIED")) return [];
    const salesUnits = requiredSalesUnits(quantity, unit, product);
    return salesUnits === null ? [] : [{ product, salesUnits }];
  });
  if (!eligible.length) return null;
  const requestedDate = deadlineDate ?? calendarDateInHelsinki(deadline ? new Date(deadline) : now);
  const lookup = await adapter.lookup({
    customer: "123", requestedDate, productIds: eligible.map(({ product }) => product.id), priceOnly: true, signal,
  });
  if (lookup.source.kind !== "VALIO_LIVE" || lookup.errors.some(({ endpoint }) => endpoint !== "availability")) return null;
  const candidates = eligible.flatMap(({ product, salesUnits }) => {
    const price = supplierUnitPriceCents(lookup.prices.find(({ productId }) => productId === product.id));
    if (price === null) return [];
    const totalCents = Math.round(salesUnits * price);
    return Number.isSafeInteger(totalCents) ? [{ product, salesUnits, totalCents }] : [];
  });
  const closest = candidates.slice(0, 5).sort((a, b) => a.totalCents - b.totalCents);
  const representative = closest[Math.floor(closest.length / 2)];
  return representative ? {
    totalCents: representative.totalCents,
    source: "supplier_catalog",
    label: `Valio catalog estimate ex VAT for ${representative.product.displayName} (${representative.salesUnits} sales units, ${requestedDate})`
      + (supplierCostIssues(representative.product).includes("VARIABLE_WEIGHT") ? ". Final weight may change the total." : ""),
  } : null;
}

export async function estimateBudget(
  draft: Draft,
  adapter: CatalogAdapter,
  now: Date,
  supplierPricing: boolean,
  requirements: ProductRequirement[] = [],
): Promise<BudgetEstimate | null> {
  const { query, quantity, unit } = draft;
  if (!query || quantity === null || !unit || draft.budgetCents !== null) return null;
  const input = { ...draft, query, quantity, unit };
  if (supplierPricing) {
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const limit = new Promise<null>((resolve) => {
      timeout = setTimeout(() => {
        controller.abort();
        resolve(null);
      }, 5000);
    });
    try {
      const estimate = await Promise.race([
        catalogEstimate(input, adapter, now, requirements, controller.signal).catch(() => null), limit,
      ]);
      if (estimate) return estimate;
    } finally {
      clearTimeout(timeout);
    }
  }
  return requirements.some((requirement) => requirement !== "lactose-free") ? null : planningEstimate(input);
}
