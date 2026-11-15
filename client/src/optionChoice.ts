import { formatEuro } from "./api";
import type { Locale } from "./i18n";
import { allergenLabel, productRequirementLabel } from "./productRequirements";
import { supplierIssueLabel } from "./supplierIssues";
import type { CatalogMismatch, CompareResponse, ProductRequirement, SupplierObservation } from "./types";

type RunnerUp = NonNullable<NonNullable<CompareResponse["decision"]>["runnersUp"]>[number];
type ClosestProduct = NonNullable<CompareResponse["closestProducts"]>[number];

/** What choosing a runner-up changes in the request so that this product can be compared and checked out. */
export interface OptionChoice {
  productId: string;
  name: string;
  removeRequirements: ProductRequirement[];
  removeAllergens: string[];
  /** Raised budget, ex VAT, when the option's estimate is over the current budget. */
  budgetCents?: number;
  /** Helsinki calendar date the supplier reported as available. */
  deliveryDate?: string;
  /** Blockers that changing the request cannot fix. */
  unresolved: string[];
  /** Health-related declarations the buyer gives up by choosing this product. */
  healthRisks: string[];
}

const fixedByDate = new Set(["DELIVERY_CONFLICT"]);
const fixedByBudget = new Set(["OVER_BUDGET"]);

function helsinkiToday(now: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Helsinki" }).format(now);
}

export function choiceFromRunnerUp(option: RunnerUp, observation: SupplierObservation | undefined, current: {
  budgetCents: number; deadlineDate: string; now?: Date;
}): OptionChoice {
  const unresolved: string[] = [];
  let budgetCents: number | undefined;
  let deliveryDate: string | undefined;
  for (const blocker of option.blockers) {
    if (fixedByBudget.has(blocker) && option.totalCents != null && option.totalCents > current.budgetCents) {
      // Round up to whole euros so the new budget reads cleanly and still covers the estimate.
      budgetCents = Math.ceil(option.totalCents / 100) * 100;
    } else if (fixedByDate.has(blocker)) {
      const available = observation?.availableDate?.slice(0, 10);
      if (available && /^\d{4}-\d{2}-\d{2}$/.test(available) && available !== current.deadlineDate
        && available >= helsinkiToday(current.now ?? new Date())) {
        deliveryDate = available;
      } else {
        unresolved.push(blocker);
      }
    } else {
      unresolved.push(blocker);
    }
  }
  return { productId: option.productId, name: option.name, removeRequirements: [], removeAllergens: [], budgetCents, deliveryDate, unresolved, healthRisks: [] };
}

export function choiceFromClosest(product: ClosestProduct, locale: Locale = "en"): OptionChoice {
  const removeRequirements: ProductRequirement[] = [];
  const removeAllergens: string[] = [];
  const healthRisks: string[] = [];
  for (const mismatch of product.mismatches as CatalogMismatch[]) {
    if (mismatch.kind === "requirement") {
      removeRequirements.push(mismatch.requirement);
      if (mismatch.healthRisk) healthRisks.push(productRequirementLabel(mismatch.requirement, locale));
    } else if (mismatch.kind === "allergen") {
      removeAllergens.push(mismatch.allergen);
      const name = allergenLabel(mismatch.allergen, locale).toLowerCase();
      healthRisks.push(locale === "fi" ? `ei sisällä allergeenia ${name}` : `free from ${name}`);
    }
  }
  return { productId: product.productId, name: product.name, removeRequirements, removeAllergens, unresolved: [], healthRisks };
}

const dateLabels = {
  en: new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }),
  fi: new Intl.DateTimeFormat("fi-FI", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }),
};

/** Plain-language list of request changes, for the confirmation step. */
export function describeChoice(choice: OptionChoice, locale: Locale = "en"): string[] {
  const fi = locale === "fi";
  const changes = [fi ? `Tilaa juuri tämä tuote (tuotenumero ${choice.productId})` : `Order exactly this product (SKU ${choice.productId})`];
  if (choice.removeRequirements.length) {
    const requirements = choice.removeRequirements.map((requirement) => productRequirementLabel(requirement, locale)).join(", ");
    changes.push(fi ? `Poista tuotevaatimuksista: ${requirements}` : `Drop the requirement${choice.removeRequirements.length > 1 ? "s" : ""}: ${requirements}`);
  }
  if (choice.removeAllergens.length) {
    const allergens = choice.removeAllergens.map((code) => allergenLabel(code, locale).toLowerCase()).join(", ");
    changes.push(fi ? `Poista allergeenittomuusvaatimuksista: ${allergens}` : `Drop "declared free from": ${allergens}`);
  }
  if (choice.budgetCents != null) {
    const budget = formatEuro(choice.budgetCents, locale);
    changes.push(fi ? `Nosta budjettia: ${budget} (alv 0 %)` : `Raise the budget to ${budget} ex VAT`);
  }
  if (choice.deliveryDate) {
    const date = dateLabels[locale].format(new Date(`${choice.deliveryDate}T00:00:00Z`));
    changes.push(fi ? `Siirrä toimitus Valion ilmoittamalle päivälle ${date}` : `Move delivery to ${date}, when Valio reports it available`);
  }
  return changes;
}

export function describeUnresolved(choice: OptionChoice, locale: Locale = "en"): string[] {
  const fi = locale === "fi";
  return choice.unresolved.map((blocker) => {
    const label = supplierIssueLabel(blocker, locale);
    if (blocker === "CUTOFF_PASSED") {
      return fi ? `${label}. Tarkista päivät löytääksesi myöhemmän toimituspäivän.` : `${label}: use Check dates to find a later delivery day`;
    }
    return fi ? `${label}. Pyynnön muokkaus ei ratkaise tätä.` : `${label}: changing the request can't fix this`;
  });
}
