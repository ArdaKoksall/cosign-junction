import { hasLactoseFreeRequirement, lactoseFreeWords, productRequirements } from "@cosign/adapters";
import { z } from "zod";
import { requestUnits, type RequestUnit } from "../purchasing/quantity.js";
import { rankingObjectiveSchema, type RankingObjective } from "../purchasing/ranking-objective.js";

export const quantitySchema = z.number().min(0.001).max(1_000_000).multipleOf(0.001);
export const unitSchema = z.enum(requestUnits);
export const intakeFields = ["query", "quantity", "unit", "quantityLiters", "deadline", "deadlineDate", "budgetCents", "diet"] as const;
export type IntakeField = typeof intakeFields[number];

export const evidenceSchema = z.object({
  field: z.enum([...intakeFields, "conflict"]),
  source: z.enum(["note", "image"]),
  excerpt: z.string().trim().min(1).max(240),
}).strict();
export const sourceEvidenceSchema = evidenceSchema.omit({ field: true });
export const requirementEvidenceSchema = sourceEvidenceSchema.extend({ requirement: z.enum(productRequirements) });

export const draftSchema = z.object({
  query: z.string().trim().min(1).max(120).nullable(),
  quantity: quantitySchema.nullable(),
  unit: unitSchema.nullable(),
  deadline: z.iso.datetime({ offset: true }).nullable(),
  budgetCents: z.number().int().nonnegative().nullable(),
  diet: z.enum(["lactose-free", "none"]).nullable(),
}).strict();

export const intakeInputSchema = z.object({
  note: z.string().trim().max(2400).default(""),
  image: z.object({
    mimeType: z.enum(["image/png", "image/jpeg"]),
    base64: z.base64().min(1).max(2_796_204),
  }).strict().optional(),
}).strict().refine((input) => Boolean(input.note || input.image), "Add a note or a photo");

export type IntakeInput = z.infer<typeof intakeInputSchema>;
export type Draft = z.infer<typeof draftSchema> & { deadlineDate?: string };
export type Evidence = z.infer<typeof evidenceSchema>;
export type FieldEvidence = Omit<Evidence, "field"> & { field: IntakeField };
export type SourceEvidence = z.infer<typeof sourceEvidenceSchema>;
export type RequirementEvidence = z.infer<typeof requirementEvidenceSchema>;

export const budgetEstimateSchema = z.object({
  totalCents: z.number().int().nonnegative(),
  source: z.enum(["supplier_catalog", "planning_reference"]),
  label: z.string(),
}).strict();
export type BudgetEstimate = z.infer<typeof budgetEstimateSchema>;

export const intakeResponseSchema = z.object({
  model: z.string(),
  status: z.enum(["draft", "clarify", "review_conflict"]),
  question: z.string().nullable(),
  draft: draftSchema.extend({
    quantityLiters: z.number().nullable(), requirements: z.array(z.enum(productRequirements)).optional(),
    deadlineDate: z.iso.date().optional().describe("Suggested latest delivery day in Helsinki when the time is unspecified."),
    rankingObjective: rankingObjectiveSchema.optional(),
  }),
  evidence: z.array(evidenceSchema.extend({ field: z.enum(intakeFields) })),
  conflictEvidence: z.array(sourceEvidenceSchema).optional(),
  requirementEvidence: z.array(requirementEvidenceSchema).optional(),
  rankingEvidence: sourceEvidenceSchema.optional(),
  budgetEstimate: budgetEstimateSchema.nullable(),
}).strict();

export function intakeResult(
  draft: Draft,
  evidence: FieldEvidence[],
  options: { model: string; conflict?: string | null; conflictEvidence?: SourceEvidence[]; budgetEstimate?: BudgetEstimate | null;
    requirements?: z.infer<typeof intakeResponseSchema>["draft"]["requirements"]; requirementEvidence?: RequirementEvidence[];
    ranking?: { objective: RankingObjective; evidence: SourceEvidence } },
): z.infer<typeof intakeResponseSchema> {
  const { model, conflict, conflictEvidence, budgetEstimate = null, requirements, requirementEvidence } = options;
  const ranking = conflict ? undefined : options.ranking;
  const question = conflict
    ?? (!draft.query ? "What product does the kitchen need?"
      : draft.quantity === null || draft.unit === null ? "What total quantity and unit does the kitchen need?"
        : !draft.deadline ? draft.deadlineDate ? "What time is the delivery due?" : "What date and time is the delivery due?"
          : draft.budgetCents === null && !budgetEstimate ? "What is the total budget in euros excluding VAT?"
            : null);
  const quantityLiters = draft.quantity === null ? null : draft.unit === "L" ? draft.quantity
    : draft.unit === "ml" ? draft.quantity / 1000 : null;
  return {
    model, status: conflict ? "review_conflict" : question ? "clarify" : "draft", question,
    draft: { ...draft, quantityLiters, ...(requirements?.length && { requirements }), ...(ranking && { rankingObjective: ranking.objective }) },
    evidence,
    ...(conflictEvidence?.length && { conflictEvidence }),
    ...(requirementEvidence?.length && { requirementEvidence }),
    ...(ranking && { rankingEvidence: ranking.evidence }),
    budgetEstimate,
  };
}

const numberPattern = String.raw`(?:\d{1,3}(?:[ \u00a0\u202f]\d{3})+|\d+)(?:[.,]\d{1,3})?`;
const smallNumbers = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const tens = ["twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const singleDigit = smallNumbers.slice(1, 10).join("|");
const underHundred = `(?:(?:${tens.join("|")})(?:[ -](?:${singleDigit}))?|${smallNumbers.slice(1).join("|")})`;
const underThousand = `(?:(?:${singleDigit})\\s+hundred(?:\\s+(?:and\\s+)?${underHundred})?|${underHundred})`;
const spokenInteger = `(?:(?:${underThousand})\\s+thousand(?:\\s+(?:and\\s+)?${underThousand})?|${underThousand}|zero)`;
const decimalDigit = `(?:${smallNumbers.slice(0, 10).join("|")})`;
const spokenNumber = `${spokenInteger}(?:\\s+point(?:\\s+${decimalDigit}){1,3})?`;
const wholeAmount = `(?:${numberPattern}|${spokenNumber})`;
const wholeAmountBefore = new RegExp(String.raw`(?<![\p{L}\d])${wholeAmount}\s*(?:[-–—]|to|or|tai)\s*$`, "iu");
const wholeAmountAfter = new RegExp(String.raw`^\s*(?:[-–—]|to|or|tai)\s*${wholeAmount}(?![\p{L}\d])`, "iu");
const units: Record<RequestUnit, string> = {
  kg: "kgs?|kilos?|kilograms?|kiloa|kilon|kilogrammaa|kilogramma",
  g: "g|grams?|grammaa|gramman|gramma",
  L: "l|ltrs?|litres?|liters?|litraa|litran|litra",
  ml: "ml|millilitres?|milliliters?|millilitraa|millilitran|millilitra",
  each: "ea|each|pcs?|pieces?|units?|items?|bottles?|kpl|kappaletta|pulloa|pullo",
  case: "cases?|boxes|box|cartons?|laatikkoa|laatikko",
};

const unitPatterns = Object.entries(units).map(([unit, aliases]) => ({ unit: unit as RequestUnit, pattern: new RegExp(`^(?:${aliases})$`, "iu") }));
const unitPattern = Object.values(units).join("|");

function parseNumber(text: string) {
  return Number(text.replace(/[ \u00a0\u202f]/g, "").replace(",", "."));
}

function parseSpokenNumber(text: string) {
  const [integer, fraction] = text.toLowerCase().split(/\s+point\s+/u);
  let total = 0;
  let group = 0;
  for (const word of integer.split(/[-\s]+/u)) {
    if (word === "thousand") {
      total += group * 1000;
      group = 0;
    } else if (word === "hundred") {
      group *= 100;
    } else if (word !== "and") {
      const small = smallNumbers.indexOf(word);
      group += small >= 0 ? small : (tens.indexOf(word) + 2) * 10;
    }
  }
  const digits = fraction?.split(/\s+/u).map((word) => smallNumbers.indexOf(word)).join("");
  return total + group + (digits ? Number(`0.${digits}`) : 0);
}

export function quantityMentions(text: string) {
  const token = new RegExp(String.raw`(?:(?<![\p{L}\d.,+-])|(?<=\d-))(${numberPattern}|${spokenNumber}(?=\s))\s*(${unitPattern})(?![\p{L}\d])`, "giu");
  return Array.from(text.matchAll(token)).flatMap((match) => {
    const [, number, unitName] = match;
    const spoken = /^\p{L}/u.test(number);
    if (spoken && /\b(?:hundred|thousand|million|point|minus|negative)(?:\s+and)?\s*$/iu.test(text.slice(0, match.index))) return [];
    const amount = spoken ? parseSpokenNumber(number) : parseNumber(number);
    const unit = unitPatterns.find(({ pattern }) => pattern.test(unitName))?.unit;
    if (!unit || !quantitySchema.safeParse(amount).success
      || (unit === "each" || unit === "case") && !Number.isInteger(amount)) return [];
    return [{ amount, unit, excerpt: match[0], index: match.index }];
  });
}

export function supportsQuantity(excerpt: string, quantity: number | null, unit: RequestUnit | null) {
  const mentions = requestQuantityMentions(excerpt);
  if (mentions.length !== 1) return false;
  const [mention] = mentions;
  if (isQuantityRange(excerpt, mention)) return false;
  const { amount, unit: writtenUnit } = mention;
  return amount === quantity && writtenUnit === unit;
}

export function isQuantityRange(text: string, { index, excerpt }: { index: number; excerpt: string }) {
  return wholeAmountBefore.test(text.slice(0, index)) || wholeAmountAfter.test(text.slice(index + excerpt.length));
}

export function requestQuantityMentions(text: string) {
  const mentions = quantityMentions(text);
  return mentions.filter(({ index, excerpt, unit }, position) => {
    const previous = mentions[position - 1];
    const before = text.slice(previous ? previous.index + previous.excerpt.length : 0, index);
    const after = text.slice(index + excerpt.length);
    const measurement = unit !== "case" && unit !== "each";
    const packDetails = measurement && (previous?.unit === "case" && /^\s*(?:of|x|×|at)?\s*$/iu.test(before)
      || previous?.unit === "each" && /^\s*(?:of|x|×|at)\s*$/iu.test(before));
    const singlePack = /\b(?:per|each|pack size|carton size|bottle size)\s*[:=]?\s*$/iu.test(before)
      || /\d\s*(?:x|×)\s*$/iu.test(before)
      || /^\s*(?:per\s+\w|each\b|\/?\s*(?:cases?|box(?:es)?|packs?|bottles?|cartons?)\b)/iu.test(after);
    return !packDetails && !singlePack;
  });
}

const noRestriction = /\b(?:no dietary (?:needs|restrictions|requirements)|no special diet)\b/iu;

export function dietMention(text: string): { value: NonNullable<Draft["diet"]>; excerpt: string } | null {
  const lactose = text.match(lactoseFreeWords);
  if (lactose && hasLactoseFreeRequirement(text)) return { value: "lactose-free", excerpt: lactose[0] };
  const unrestricted = text.match(noRestriction);
  if (unrestricted) return { value: "none", excerpt: unrestricted[0] };
  return null;
}

export function typedDiet(excerpt: string): Draft["diet"] {
  return dietMention(excerpt)?.value ?? null;
}

export function budgetMentions(text: string) {
  const price = new RegExp(String.raw`(?:€\s*(${numberPattern})|(${numberPattern})\s*(?:€|euros?|euroa|eur)(?!\p{L}))`, "giu");
  return Array.from(text.matchAll(price)).flatMap((match) => {
    const after = text.slice(match.index + match[0].length);
    const context = text.slice(Math.max(0, match.index - 38), match.index + match[0].length + 24);
    const amount = match[1] ?? match[2];
    if (/^\s*(?:\/|per)\s*\p{L}/iu.test(after)
      || /\b(?:inc(?:l(?:uding)?)?\.?\s*VAT|with VAT|VAT included|sis\.?\s*alv)\b/i.test(context)
      || (match[2] && /[\d.,+-]$/u.test(text.slice(0, match.index)))
      || (match[1] && /^[\d.,]/u.test(after) && !/^\.(?:\s|$)/u.test(after))) return [];
    const value = parseNumber(amount);
    return Number.isSafeInteger(Math.round(value * 100)) && Math.abs(value * 100 - Math.round(value * 100)) < 1e-5
      ? [{ cents: Math.round(value * 100), excerpt: match[0], index: match.index }]
      : [];
  });
}
