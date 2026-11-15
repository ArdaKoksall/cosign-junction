export const lactoseFreeWords = /(?<![\p{L}\p{N}])(?:lactose?[\p{Zs}\p{Pd}]*free|laktoosit(?:on(?:ta)?|tom\p{L}*|t\p{L}*)|laktosfr(?:i(?:a)?|itt))(?![\p{L}\p{N}])/iu;

export const productRequirements = ["lactose-free", "gluten-free", "vegan", "vegetarian", "no-added-sugar", "high-protein"] as const;
export type ProductRequirement = typeof productRequirements[number];

const definitions = {
  "lactose-free": { claim: "FREE_FROM_LACTOSE", unit: "FREE_FROM", phrase: lactoseFreeWords.source },
  "gluten-free": { claim: "FREE_FROM_GLUTEN", unit: "FREE_FROM", phrase: String.raw`gluten[\p{Zs}\p{Pd}]*free|gluteenit\p{L}+|glutenfr(?:i(?:a)?|itt)` },
  vegan: { claim: "VEGAN", unit: "DIET", phrase: String.raw`vegan|vegansk(?:t|a)?|vegaan\p{L}*` },
  vegetarian: { claim: "VEGETARIAN", unit: "DIET", phrase: String.raw`vegetarian|kasvisruokavalio\p{L}*|vegetarisk(?:t|a)?` },
  "no-added-sugar": { claim: "NO_ADDED_SUGARS", unit: "NO_ADDED", phrase: String.raw`(?:no[\p{Zs}\p{Pd}]+added|without\s+added)[\p{Zs}\p{Pd}]+sugars?|ei\s+lisättyä\s+sokeria|utan\s+tillsatt\s+socker` },
  "high-protein": { claim: "HIGH_PROTEIN", unit: "HIGH", phrase: String.raw`high[\p{Zs}\p{Pd}]+(?:in[\p{Zs}\p{Pd}]+)?protein|runsaasti\s+proteiinia|proteiinipitoinen|proteinrik(?:t|a)?` },
} as const satisfies Record<ProductRequirement, { claim: string; unit: string; phrase: string }>;

const claimUnits = new Map<string, string>(Object.values(definitions).map(({ claim, unit }) => [claim, unit]));
const phraseMatchers = productRequirements.map((requirement) => ({
  requirement, pattern: new RegExp(String.raw`(?<![\p{L}\p{N}])(?:${definitions[requirement].phrase})(?![\p{L}\p{N}])`, "giu"),
}));
const negatedPrefix = /(?:^|[^\p{L}\p{N}])(?:non|not(?:\s+necessarily)?|no|ei)[\s\p{Pd}]+$/iu;
const optionalSuffix = /^\s+(?:optional|not required|ei pakollinen)\b/iu;

function requirementMatches(text: string) {
  return phraseMatchers.flatMap(({ requirement, pattern }) => [...text.matchAll(pattern)].flatMap((match) => {
    const start = match.index;
    const end = start + match[0].length;
    if (negatedPrefix.test(text.slice(0, start)) || optionalSuffix.test(text.slice(end))) return [];
    return [{ requirement, start, end }];
  })).sort((a, b) => a.start - b.start);
}

export function requirementsFromQuery(text: string): ProductRequirement[] {
  return [...new Set(requirementMatches(text).map(({ requirement }) => requirement))];
}

export function removeRequirementWords(text: string): string {
  let lastEnd = 0;
  let result = "";
  for (const { start, end } of requirementMatches(text)) {
    const between = text.slice(lastEnd, start).replace(/(?:^|\s)(?:and|with|ja|och|med)\s*$/iu, " ");
    if (!lastEnd || !/^\s*(?:[,/&+]|or)?\s*$/iu.test(between)) result += between;
    result += " ";
    lastEnd = end;
  }
  return (result + text.slice(lastEnd)).replace(/\(\s*\)|\[\s*\]/g, " ").replace(/\s+/g, " ").trim();
}

export function requirementClaims(requirements: readonly ProductRequirement[]): string[] {
  return requirements.map((requirement) => definitions[requirement].claim);
}

export function expectedRequirementUnit(claim: string) {
  return claimUnits.get(claim);
}

export function hasLactoseFreeRequirement(text: string): boolean {
  return requirementsFromQuery(text).includes("lactose-free");
}

export function removeLactoseFreeWords(text: string): string {
  return text.replace(new RegExp(lactoseFreeWords.source, "giu"), " ")
    .replace(/\(\s*\)|\[\s*\]/g, " ").replace(/\s+/g, " ").trim();
}
