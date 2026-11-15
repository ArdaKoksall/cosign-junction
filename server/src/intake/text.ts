import { removeRequirementWords } from "@cosign/adapters";
import {
  budgetMentions, dietMention, type Draft, type FieldEvidence, isQuantityRange, quantityMentions, requestQuantityMentions,
} from "./fields.js";
import { deadlineDatePattern, readDeadline } from "./deadline.js";
import { prioritySuffix, typedRequirements } from "./preferences.js";

const notePrefix = /^(?:(?:(?:i|we)\s+(?:need|want|would like)|(?:please\s+)?(?:need|order|get|buy)|looking for|tarvitaan|tarvitsen|tilataan|tuote|product)(?:\s+|\s*:\s*))+/iu;
const purchaseInfinitive = /^to\s+(?:order|buy|get)\s+/iu;
const productLabel = /^\s*(?:(?:product|tuote)\s*:|(?:sku|gtin)(?:\s*[:#]|\b))\s*/iu;
const extraDetails = /[;\r\n]|(?:,\s*|\s+)(?:(?=(?:delivered|deliver(?:y)?|deadline|before|by|today|tomorrow|budget|toimitus|toimitetaan|budjetti|viimeistään|tänään|huomenna|klo|kello|no dietary (?:needs|restrictions|requirements)|no special diet)\b)|(?=(?:under|up to|max(?:imum)?|total)\s+[€\d]|for\s+(?:(?:today|tomorrow|next)\b|\d)|(?:at|on)\s+\d|\d{1,2}\.\d{1,2}\.|\d{4}-\d{2}-\d{2}(?=T|\b)))|[.!?](?:\s|$)/iu;

const dateDetails = new RegExp(`(?:,\\s*|\\s+)(?=(?:(?:on|for|until|ennen)\\s+)?${deadlineDatePattern}(?![\\p{L}\\d]))`, "iu");
const priorityDetails = new RegExp(`(?:,\\s*|\\s+)(?=(?:with\\s+)?${prioritySuffix.source})`, "iu");

export function readTypedNote(note: string, now: Date) {
  const draft: Draft = { query: null, quantity: null, unit: null, deadline: null, budgetCents: null, diet: null };
  const evidence: FieldEvidence[] = [];
  const add = (field: FieldEvidence["field"], excerpt: string) => evidence.push({ field, source: "note", excerpt });
  const diet = dietMention(note);
  if (diet && (diet.value !== "lactose-free" || typedRequirements(note).some(({ requirement }) => requirement === "lactose-free"))) {
    draft.diet = diet.value;
    add("diet", diet.excerpt);
  }

  const quantities = requestQuantityMentions(note);
  const budgets = budgetMentions(note);
  const ambiguousQuantity = quantities.length > 1 || quantities.some((mention) => isQuantityRange(note, mention));
  const ambiguousBudget = new Set(budgets.map(({ cents }) => cents)).size > 1;
  if (!ambiguousQuantity && quantities.length === 1) {
    const { amount, unit, excerpt } = quantities[0];
    draft.quantity = amount;
    draft.unit = unit;
    add("quantity", excerpt);
    add("unit", excerpt);
  }
  if (!ambiguousBudget && budgets.length) {
    draft.budgetCents = budgets[0].cents;
    add("budgetCents", budgets[0].excerpt);
  }
  const delivery = readDeadline(note, now);
  if (delivery.deadline && delivery.excerpt) {
    draft.deadline = delivery.deadline;
    add("deadline", delivery.excerpt);
  } else if (delivery.deadlineDate && delivery.excerpt) {
    draft.deadlineDate = delivery.deadlineDate;
    add("deadlineDate", delivery.excerpt);
  }

  if (!ambiguousQuantity && !delivery.standalone) {
    const quantity = quantities[0];
    const productSource = note.split(/[;\r\n]/).find((line) => productLabel.test(line)) ?? note;
    const productLine = productSource.split(extraDetails)[0].split(dateDetails)[0].split(priorityDetails)[0].trim();
    const inlineBudget = budgetMentions(productLine)[0];
    const withoutBudget = inlineBudget ? productLine.slice(0, inlineBudget.index) : productLine;
    const quantityIndex = quantity ? withoutBudget.indexOf(quantity.excerpt) : -1;
    const withoutQuantity = quantity && quantityIndex >= 0
      ? `${withoutBudget.slice(0, quantityIndex)}${withoutBudget.slice(quantityIndex + quantity.excerpt.length).replace(/^\s*of\s+/iu, " ")}`
      : withoutBudget;
    const product = withoutQuantity
      .trimStart().replace(productLabel, "").replace(notePrefix, "").replace(purchaseInfinitive, "")
      .replace(/^[\s,]+/u, "").replace(/^(?:of|x|×)\s+/iu, "").replace(/\s+please$/iu, "");
    const query = removeRequirementWords(product).replace(/^[\s,.:!?—–-]+|[\s,.:!?—–-]+$/gu, "").replace(/\s{2,}/g, " ");
    if (query && (/\p{L}/u.test(query) || /^\d{4,14}$/u.test(query)) && query.length <= 120) {
      draft.query = /^(?:maitoa|maito)$/iu.test(query) ? "milk" : query;
      const excerpt = [query, product.trim(), productLine].find((value) => value && value.length <= 240 && note.includes(value));
      if (excerpt) add("query", excerpt);
    }
  }

  const conflict = ambiguousQuantity ? "The note contains more than one possible quantity. Review the amount or enter one product per request."
    : ambiguousBudget ? "The note contains more than one possible budget. Review the total budget." : null;
  return { draft, evidence, conflict, ambiguousQuantity, ambiguousBudget, delivery };
}

export function isSimpleTypedRequest(note: string, draft: Draft) {
  if (!draft.query || draft.deadline || draft.deadlineDate || draft.budgetCents !== null) return false;
  const mentions = quantityMentions(note);
  if (mentions.length !== (draft.quantity === null ? 0 : 1)) return false;
  const productText = mentions.length ? note.replace(mentions[0].excerpt, "") : note;
  const product = productText.trim().replace(productLabel, "").replace(/^of\s+/iu, "");
  const query = removeRequirementWords(product);
  return query === draft.query && (/^\d{4,14}$/u.test(query) || /^(?:\p{L}[\p{L}'’-]*\s+){0,5}\p{L}[\p{L}'’-]*$/iu.test(query))
    && !/\b(?:and|or|but|need|want|by|before|deliver(?:ed|y)?|for|today|tomorrow|please|ja|tai|ennen|toimitus|tänään|huomenna)\b/iu.test(query);
}
