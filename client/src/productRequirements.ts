import type { ProductRequirement } from "./types";

export const productRequirementLabels = {
  "lactose-free": "Lactose-free",
  "gluten-free": "Gluten-free",
  vegan: "Vegan",
  vegetarian: "Vegetarian",
  "no-added-sugar": "No added sugar",
  "high-protein": "High protein",
} satisfies Record<ProductRequirement, string>;

const finnishProductRequirementLabels = {
  "lactose-free": "Laktoositon",
  "gluten-free": "Gluteeniton",
  vegan: "Vegaaninen",
  vegetarian: "Kasvisruokavalioon sopiva",
  "no-added-sugar": "Ei lisättyä sokeria",
  "high-protein": "Runsaasti proteiinia",
} satisfies Record<ProductRequirement, string>;

const requirementLists = {
  en: new Intl.ListFormat("en", { type: "conjunction" }),
  fi: new Intl.ListFormat("fi", { type: "conjunction" }),
};

export const allergenOptions: Readonly<Record<string, string>> = {
  AW: "Gluten-containing cereals", AC: "Crustaceans", AE: "Eggs", AF: "Fish", AP: "Peanuts", AY: "Soybeans",
  AM: "Milk", AN: "Tree nuts", BC: "Celery", BM: "Mustard", AS: "Sesame", AU: "Sulphites", NL: "Lupin", UM: "Molluscs",
};

const finnishAllergenLabels: Readonly<Record<string, string>> = {
  AW: "Gluteenia sisältävät viljat", AC: "Äyriäiset", AE: "Kananmunat", AF: "Kala", AP: "Maapähkinät", AY: "Soijapavut",
  AM: "Maito", AN: "Pähkinät", BC: "Selleri", BM: "Sinappi", AS: "Seesaminsiemenet", AU: "Sulfiitit", NL: "Lupiini", UM: "Nilviäiset",
};

export function productRequirementLabel(requirement: ProductRequirement, locale: "en" | "fi" = "en") {
  return (locale === "fi" ? finnishProductRequirementLabels : productRequirementLabels)[requirement];
}

export function allergenLabel(code: string, locale: "en" | "fi" = "en") {
  return (locale === "fi" ? finnishAllergenLabels : allergenOptions)[code] ?? code;
}

export function formatProductRequirements(requirements: readonly ProductRequirement[], locale: "en" | "fi" = "en") {
  return requirementLists[locale].format(requirements.map((requirement) => productRequirementLabel(requirement, locale)));
}

export function formatAllergenRequirements(allergens: readonly string[], locale: "en" | "fi" = "en") {
  return requirementLists[locale].format(allergens.map((code) => allergenLabel(code, locale)));
}
