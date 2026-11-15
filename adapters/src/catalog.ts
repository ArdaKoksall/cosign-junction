import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  DEFAULT_SHORTLIST_LIMIT,
  type AdapterErrorCode,
  type CatalogIngredient,
  type CatalogIndex,
  type CatalogNutrient,
  type CatalogProduct,
  type CatalogProductDetails,
  type ClaimEvidence,
  type EvidenceStatus,
  type LocalizedName,
  type PackUnit,
  type ShortlistItem,
  type ShortlistQuery,
  type SourceProvenance
} from "./types.js";
import { nowUtcIso } from "./time.js";
import { expectedRequirementUnit, removeRequirementWords, requirementClaims, requirementsFromQuery, type ProductRequirement } from "./diet.js";

interface RawClassificationValue {
  id?: string;
  synkkaId?: string;
  unit?: string;
}

interface RawClassification {
  name?: string;
  values?: RawClassificationValue[];
}

interface RawUnit {
  unitId?: string;
  gtin?: string;
  sizeInBaseUnits?: number;
}

interface RawVolume {
  unit?: string;
  value?: number;
}

interface RawConversion {
  synkkaPackagingType?: string;
  volume?: RawVolume;
  netWeight?: RawVolume;
}

const salesPackagingLevels = new Map([
  ["KI", "CASE"],
  ["PAL", "PALLET"],
]);

interface RawProduct {
  id?: string;
  category?: string;
  vendorName?: string;
  salesUnit?: string;
  baseUnit?: string;
  salesUnitGtin?: string;
  allowedLotSize?: number;
  countryOfOrigin?: string;
  temperatureCondition?: number;
  deposits?: CatalogProductDetails["deposits"];
  substitutions?: { substituteProduct?: string }[];
  units?: RawUnit[];
  synkkaData?: {
    names?: LocalizedName[];
    classifications?: RawClassification[];
    unitConversions?: RawConversion[];
    brand?: string;
    keyIngredients?: LocalizedName[];
    ingredients?: (Pick<CatalogIngredient, "sequence"> & Partial<Omit<CatalogIngredient, "sequence">>)[];
    nutritionalContent?: CatalogNutrient[];
    storageInstructions?: LocalizedName[];
    preparationInstructions?: LocalizedName[];
    usageInstructions?: LocalizedName[];
    minTemperature?: number;
    maxTemperature?: number;
    variableUnit?: boolean;
    lastUpdated?: string;
  };
}

function allergenStatus(unit?: string): EvidenceStatus {
  if (unit === "CONTAINS") return "DECLARED_PRESENT";
  if (unit === "MAY_CONTAIN") return "MAY_CONTAIN";
  if (unit === "FREE_FROM") return "VERIFIED_ABSENT";
  return "UNKNOWN";
}

function claimStatus(unit?: string): EvidenceStatus {
  if (unit === "FREE_FROM") return "VERIFIED_ABSENT";
  if (!unit) return "UNKNOWN";
  return "DECLARED_PRESENT";
}

function localizedText(items: LocalizedName[] | undefined): LocalizedName[] {
  return (items ?? []).filter((item) => typeof item.language === "string" && typeof item.value === "string" && item.value.trim());
}

function declaredNutrients(rows: CatalogNutrient[] = []): CatalogNutrient[] {
  return rows.flatMap(({ id, value, unit, basisQuantity, basisQuantityUnit, unitPrecision, servingSize, servingSizeUnit, dailyValueIntakePercent }) => {
    if (!id || !unit || !basisQuantityUnit || !Number.isFinite(basisQuantity) || basisQuantity <= 0 || !Number.isFinite(value) || value < 0) return [];
    return [{
      id, value, unit, basisQuantity, basisQuantityUnit,
      ...(unitPrecision && { unitPrecision }),
      ...(servingSize !== undefined && Number.isFinite(servingSize) && servingSize > 0 && servingSizeUnit && { servingSize, servingSizeUnit }),
      ...(dailyValueIntakePercent !== undefined && Number.isFinite(dailyValueIntakePercent) && dailyValueIntakePercent >= 0 && { dailyValueIntakePercent }),
    }];
  });
}

function declaredIngredients(rows: NonNullable<RawProduct["synkkaData"]>["ingredients"] = []): CatalogIngredient[] {
  return rows.flatMap(({ sequence, names, origins, percentage }) => {
    if (!Number.isInteger(sequence) || sequence < 1) return [];
    return [{
      sequence, names: localizedText(names), origins: (origins ?? []).filter(({ country, type }) => country && type),
      ...(percentage !== undefined && Number.isFinite(percentage) && percentage >= 0 && percentage <= 100 && { percentage }),
    }];
  }).sort((a, b) => a.sequence - b.sequence);
}

function productDetails(raw: RawProduct): CatalogProductDetails {
  const synkka = raw.synkkaData;
  return {
    countryOfOrigin: raw.countryOfOrigin || undefined,
    temperatureCondition: raw.temperatureCondition,
    deposits: (raw.deposits ?? []).filter(({ material, quantity, unit }) =>
      Boolean(material) && Number.isFinite(quantity) && quantity > 0 && Boolean(unit)),
    brand: synkka?.brand || undefined,
    ingredients: localizedText(synkka?.keyIngredients),
    structuredIngredients: declaredIngredients(synkka?.ingredients),
    nutritionalContent: declaredNutrients(synkka?.nutritionalContent),
    storageInstructions: localizedText(synkka?.storageInstructions),
    preparationInstructions: localizedText(synkka?.preparationInstructions),
    usageInstructions: localizedText(synkka?.usageInstructions),
    minTemperatureCelsius: synkka?.minTemperature,
    maxTemperatureCelsius: synkka?.maxTemperature,
    variableWeight: synkka?.variableUnit,
    manufacturerUpdatedAt: synkka?.lastUpdated,
  };
}

function volumeToMl(volume?: RawVolume): number | null {
  if (!volume || typeof volume.value !== "number" || !Number.isFinite(volume.value) || volume.value <= 0) return null;
  if (volume.unit === "LTR") return volume.value * 1000;
  if (volume.unit === "MLT") return volume.value;
  return null;
}

function weightToG(weight?: RawVolume): number | null {
  if (!weight || typeof weight.value !== "number" || !Number.isFinite(weight.value) || weight.value <= 0) return null;
  if (weight.unit === "KGM") return weight.value * 1000;
  if (weight.unit === "GRM") return weight.value;
  return null;
}

function conversionAtLevel(conversions: RawConversion[], level: string | undefined): RawConversion | undefined {
  if (level === undefined) return undefined;
  const matches = conversions.filter((conversion) => conversion.synkkaPackagingType === level);
  return matches.length === 1 ? matches[0] : undefined;
}

function integerLot(allowedLotSize: number): { increment: number; min: number; notes: AdapterErrorCode[] } {
  const notes: AdapterErrorCode[] = [];
  if (!Number.isFinite(allowedLotSize) || allowedLotSize <= 0) {
    return { increment: 1, min: 1, notes };
  }
  if (Number.isInteger(allowedLotSize)) {
    return { increment: allowedLotSize, min: allowedLotSize, notes };
  }
  notes.push("PACK_UNMAPPED");
  return { increment: 1, min: 1, notes };
}

export function normalizeCatalogProduct(raw: RawProduct): CatalogProduct | null {
  if (!raw.id || !raw.salesUnit || !raw.baseUnit) return null;
  const names = raw.synkkaData?.names ?? [];
  const preferred =
    names.find((n) => n.language === "en") ?? names.find((n) => n.language === "fi") ?? names[0];
  const units: PackUnit[] = (raw.units ?? [])
    .filter((u): u is RawUnit & { unitId: string; sizeInBaseUnits: number } =>
      typeof u.unitId === "string" && typeof u.sizeInBaseUnits === "number"
    )
    .map((u) => ({ unitId: u.unitId, gtin: u.gtin, sizeInBaseUnits: u.sizeInBaseUnits }));

  const salesPacks = units.filter((unit) =>
    unit.unitId === raw.salesUnit && (!raw.salesUnitGtin || !unit.gtin || unit.gtin === raw.salesUnitGtin)
  );
  const salesPack = salesPacks.length === 1 ? salesPacks[0] : undefined;
  const notes: AdapterErrorCode[] = [];
  let amountPerSellUnit: number | null = null;
  let amountDimension: CatalogProduct["amountDimension"] = "unmapped";
  let secondaryPackMeasure: CatalogProduct["secondaryPackMeasure"];

  if (salesPack && Number.isFinite(salesPack.sizeInBaseUnits) && salesPack.sizeInBaseUnits > 0) {
    const conversions = raw.synkkaData?.unitConversions ?? [];
    const baseConversion = conversionAtLevel(conversions, "BASE_UNIT_OR_EACH");
    // A case or pallet measurement already describes the whole packaging level.
    const salesConversion = conversionAtLevel(conversions, salesPackagingLevels.get(raw.salesUnit));
    const baseMl = volumeToMl(baseConversion?.volume);
    const baseG = weightToG(baseConversion?.netWeight);
    const ml = volumeToMl(salesConversion?.volume) ?? (baseMl === null ? null : baseMl * salesPack.sizeInBaseUnits);
    const g = weightToG(salesConversion?.netWeight) ?? (baseG === null ? null : baseG * salesPack.sizeInBaseUnits);
    // Products invoiced by weight are priced per kg; the base net weight can
    // describe an entire physical package (e.g. a 4.4 kg minimum lot).
    if (raw.salesUnit === "KG" && raw.baseUnit === "KG") {
      amountPerSellUnit = 1000;
      amountDimension = "g";
    } else if (ml !== null && Number.isFinite(ml) && ml > 0) {
      amountPerSellUnit = ml;
      amountDimension = "ml";
      if (g !== null && Number.isFinite(g) && g > 0) secondaryPackMeasure = { amount: g, unit: "g" };
    } else if (g !== null && Number.isFinite(g) && g > 0) {
      amountPerSellUnit = g;
      amountDimension = "g";
    }
  }
  if (amountPerSellUnit === null) notes.push("PACK_UNMAPPED");

  const claims: ClaimEvidence[] = [];
  const allergens: ClaimEvidence[] = [];
  for (const group of raw.synkkaData?.classifications ?? []) {
    for (const value of group.values ?? []) {
      if (!value.id) continue;
      if (group.name === "allergen" || group.name === "nonAllergen") {
        allergens.push({
          id: value.id,
          group: group.name,
          status: allergenStatus(value.unit),
          synkkaId: value.synkkaId
        });
      }
      if (group.name === "nutritionalClaim" || group.name === "packagingMarkedLabel") {
        claims.push({
          id: value.id,
          group: group.name,
          status: group.name === "packagingMarkedLabel" ? "DECLARED_PRESENT" : claimStatus(value.unit),
          synkkaId: value.synkkaId,
          unit: value.unit,
        });
      }
    }
  }

  const lot = integerLot(raw.allowedLotSize ?? 1);
  notes.push(...lot.notes);

  return {
    id: raw.id,
    names,
    displayName: preferred?.value ?? raw.id,
    category: raw.category ?? "",
    vendorName: raw.vendorName ?? "",
    salesUnit: raw.salesUnit,
    baseUnit: raw.baseUnit,
    salesUnitGtin: raw.salesUnitGtin,
    allowedLotSize: raw.allowedLotSize ?? 1,
    sellUnitIncrement: lot.increment,
    minSellUnits: lot.min,
    amountPerSellUnit,
    amountDimension,
    ...(secondaryPackMeasure && { secondaryPackMeasure }),
    units,
    substituteProductIds: (raw.substitutions ?? [])
      .map((s) => s.substituteProduct)
      .filter((id): id is string => typeof id === "string"),
    claims,
    allergens,
    packNotes: [...new Set(notes)],
    details: productDetails(raw)
  };
}

export function indexCatalog(
  records: unknown[],
  source: Omit<SourceProvenance, "kind"> & { kind?: SourceProvenance["kind"] }
): CatalogIndex {
  const products = new Map<string, CatalogProduct>();
  for (const record of records) {
    const product = normalizeCatalogProduct(record as RawProduct);
    if (product) products.set(product.id, product);
  }
  return {
    products,
    hash: source.catalogHash,
    source: {
      kind: source.kind ?? "LOCAL_CATALOG",
      label: source.label,
      observedAt: source.observedAt,
      revision: source.revision,
      evidenceRef: source.evidenceRef,
      catalogHash: source.catalogHash
    }
  };
}

export async function loadCatalogFile(path: string, label = "local product catalog"): Promise<CatalogIndex> {
  const buf = await readFile(path);
  const hash = createHash("sha256").update(buf).digest("hex");
  const parsed = JSON.parse(buf.toString("utf8")) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("catalog JSON must be an array");
  }
  return indexCatalog(parsed, {
    kind: "LOCAL_CATALOG",
    label,
    observedAt: nowUtcIso(),
    revision: 1,
    evidenceRef: path,
    catalogHash: hash
  });
}

function searchText(value: string): string {
  const normalized = value.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "")
    .replace(/\b\d{1,3}(?: \d{3})+\b/g, (number) => number.replaceAll(" ", ""))
    .replace(/(\d),(?=\d)/g, "$1.")
    .match(/\d+(?:\.\d+)?|\p{L}+/gu)?.join(" ") ?? "";
  return normalized
    .replace(/\b(oat|almond|soy|soya|rice) milk\b(?! chocolate\b)/g, "$1 drink")
    .replace(/\bsoya drink\b/g, "soy drink")
    .replace(/\b(?:yoghurt|yoghurts|yogurts)\b/g, "yogurt")
    .replace(/\b(tomato|potato)es\b/g, "$1")
    .replace(/\b(?:fillets|filets|filet)\b/g, "fillet")
    .replace(/\b(?:breastfillet|breastfilet)s?\b/g, "breast fillet")
    .replace(/\bmilkdrink\b/g, "milk drink")
    .replace(/\bmaitoa\b/g, "maito");
}

const searchIndexes = new WeakMap<CatalogIndex, Map<string, {
  names: string[];
  nameWords: Set<string>;
  otherWords: Set<string>;
  codes: string[];
}>>();

function searchIndex(index: CatalogIndex) {
  const cached = searchIndexes.get(index);
  if (cached) return cached;
  const entries = new Map([...index.products.values()].map((product) => {
    const names = [...new Set([product.displayName, ...product.names.map(({ value }) => value)].map(searchText))];
    const codes = [product.id, product.salesUnitGtin, ...product.units.map(({ gtin }) => gtin)]
      .filter((code): code is string => Boolean(code)).map((code) => code.toLowerCase());
    return [product.id, {
      names,
      nameWords: new Set(names.flatMap((name) => name.split(" "))),
      otherWords: new Set(searchText(`${product.category} ${product.vendorName}`).split(" ")),
      codes,
    }] as const;
  }));
  searchIndexes.set(index, entries);
  return entries;
}

function singleEdit(left: string, right: string): boolean {
  if (Math.abs(left.length - right.length) > 1) return false;
  let i = 0;
  while (i < left.length && left[i] === right[i]) i += 1;
  if (left.length > right.length) return left.slice(i + 1) === right.slice(i);
  if (left.length < right.length) return left.slice(i) === right.slice(i + 1);
  return left.slice(i + 1) === right.slice(i + 1)
    || (left[i] === right[i + 1] && left[i + 1] === right[i] && left.slice(i + 2) === right.slice(i + 2));
}

const spellingVocabularies = new WeakMap<CatalogIndex, Map<string, number>>();

/** Word -> how many products use it in a name (or, at lower weight, category/vendor). */
function spellingVocabulary(index: CatalogIndex) {
  const cached = spellingVocabularies.get(index);
  if (cached) return cached;
  const counts = new Map<string, number>();
  for (const entry of searchIndex(index).values()) {
    for (const word of entry.nameWords) if (/^\p{L}{2,}$/u.test(word)) counts.set(word, (counts.get(word) ?? 0) + 2);
    for (const word of entry.otherWords) if (/^\p{L}{2,}$/u.test(word)) counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  spellingVocabularies.set(index, counts);
  return counts;
}

function editDistance(left: string, right: string, max: number): number {
  if (Math.abs(left.length - right.length) > max) return max + 1;
  let previous2: number[] = [];
  let previous = Array.from({ length: right.length + 1 }, (_, j) => j);
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      let value = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      if (i > 1 && j > 1 && left[i - 1] === right[j - 2] && left[i - 2] === right[j - 1]) value = Math.min(value, previous2[j - 2] + 1);
      current.push(value);
      rowMin = Math.min(rowMin, value);
    }
    if (rowMin > max) return max + 1;
    previous2 = previous;
    previous = current;
  }
  return previous[right.length];
}

const spellingStopWords = new Set([
  "a", "an", "and", "the", "of", "for", "with", "without", "or", "to", "in", "on", "by", "per", "at", "is", "are",
  "i", "we", "need", "want", "would", "like", "please", "order", "buy", "get", "some", "looking", "free", "pack", "packs",
  "kg", "kilo", "kilos", "kilogram", "kilograms", "gram", "grams", "litre", "litres", "liter", "liters", "ml", "dl",
  "case", "cases", "box", "boxes", "piece", "pieces", "unit", "units", "each", "bottle", "bottles", "carton", "cartons",
  "deliver", "delivery", "delivered", "before", "today", "tomorrow", "next", "budget", "under", "most", "up",
  "ja", "tai", "kpl", "tarvitsen", "tarvitaan", "tilataan",
]);

function foldWord(word: string) {
  return word.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "");
}

/**
 * "Did you mean" for product searches: replaces words that appear nowhere in the catalog with the closest
 * catalog word. Returns null when every word is known (or a prefix of a known word) or nothing is close enough.
 */
export function suggestCatalogSpelling(index: CatalogIndex, query: string | undefined): string | null {
  const text = query?.trim() ?? "";
  if (!text) return null;
  const vocabulary = spellingVocabulary(index);
  const protectedWords = new Set((removeRequirementWords(text).match(/\p{L}+/gu) ?? []).map(foldWord));
  const requirementWords = new Set((text.match(/\p{L}+/gu) ?? []).map(foldWord).filter((word) => !protectedWords.has(word)));
  let changed = false;
  const corrected = text.replace(/\p{L}+/gu, (original) => {
    const word = foldWord(original);
    if (word.length < 3 || spellingStopWords.has(word) || requirementWords.has(word) || vocabulary.has(word)) return original;
    const max = word.length <= 4 ? 1 : 2;
    let best: { word: string; distance: number; count: number } | null = null;
    for (const [candidate, count] of vocabulary) {
      if (candidate.length < 3) continue;
      if (candidate.startsWith(word)) return original; // still typing a real word
      const distance = editDistance(word, candidate, max);
      if (distance > max) continue;
      if (!best || distance < best.distance || (distance === best.distance && count > best.count)) best = { word: candidate, distance, count };
    }
    if (!best) return original;
    changed = true;
    return original[0] === original[0].toUpperCase() && original[0] !== original[0].toLowerCase()
      ? best.word[0].toUpperCase() + best.word.slice(1) : best.word;
  });
  return changed && corrected.toLowerCase() !== text.toLowerCase() ? corrected : null;
}

const orderAmount = /\b\d+(?:\.\d+)? (?:kg|kilos?|kilograms?|kiloa|kilogrammaa?|g|grams?|grammaa?|l|ltr|lit(?:er|re)s?|litraa?|ml|millilit(?:er|re)s?|millilitraa?|dl|cases?|box(?:es)?|packs?|pieces?|units?|each|ea|pcs?|bottles?|cartons?|kpl|kappaletta|pulloa?|pakettia|laatikko(?:a)?)\b/g;
const orderPrefix = /^(?:please )?(?:(?:i |we )?(?:need|want|would like)(?: to (?:buy|order|get))?|order|buy|get|looking for|tarvitsen|tarvitaan|tilataan)\s+/;
const orderDetails = /[;\r\n]|,?\s+(?=(?:deliver(?:ed|y)?|budget|toimitus|toimitetaan|budjetti|viimeistään)\b|(?:before|by|for)\s+(?:today|tomorrow|next|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?|\d)|(?:under|up to|at most)\s+(?:€\s*)?\d)/iu;

// Prefer matching product families over prepared foods that mention the same ingredient.
const preferredCategories = new Map([
  ["milk", "10400"], ["maito", "10400"], ["mjolk", "10400"],
  ["oat drink", "10402"], ["soy drink", "10402"], ["almond drink", "10402"],
  ["yogurt", "10412"], ["jogurtti", "10412"],
  ["cheese", "106"], ["juusto", "106"],
  ["tomato", "17401"], ["tomaatti", "17401"],
  ["chicken breast", "18750"], ["chicken breast fillet", "18750"],
  ["pasta", "21380"],
]);

const dryRice = {
  category: "21340",
  name: /\b(?:rice|(?:basmati|jasmin|jasmiini|pitka|pika|puuro|risotto|sushi|taysjyva)?riisi|ris)\b/,
  incompatibleName: /\b(?:mix|multigrain|blend|with|rice ?paper|riisipaperi|moniviljaseos|wrapper|pie|dessert|porridge mix|express|precooked|pre cooked|cooked|steamed|ready to eat|valmisriisi|riisipuuro)\b/,
  preferredName: /\b(?:long(?: grain)? rice|long grain|parboil(?:ed)?|pitkariisi|pitkajyvainen)\b/,
};

interface CatalogProductForm {
  query: RegExp;
  category: string;
  name: RegExp;
  incompatibleName: RegExp;
  preferredName?: RegExp;
  variety?: RegExp;
}

// These Valio categories include other foods. Match the requested form in the
// product names before a broad ingredient search can qualify it for pricing.
const productForms: CatalogProductForm[] = [
  {
    query: /^(?:milk|maito|maitojuoma|juomamaito|mjolk|mjolksdryck)$/,
    category: "10400",
    name: /\b(?:milk|(?:kevyt|tays|ykkos)?maito(?:juoma)?|(?:latt|hel)?mjolk(?:sdryck)?)\b/,
    incompatibleName: /\b(?:coffee|cafe|latte|cappuccino|mocha|condensed|sour ?milk|chocolate|vanilla|ice cream|kahvimaito(?:juoma)?|maitokahvijuoma|piima|vanilja|kondenserad|choklad)\b/,
  },
  {
    query: /^(?:(?:(?:fresh|whole|fresh whole|whole fresh) )?apples?|(?:(?:tuore|tuoretta|tuoreet|tuoreita|kokonaisia) )?omen(?:a|aa|at|ia))$/,
    category: "17412",
    name: /\b(?:apples?|applen|omen(?:a|aa|at|ia))\b/,
    incompatibleName: /\b(?:juice|cider|sauce|puree|dried|frozen|sliced|slices?|wedges?|cubes?|dices?|strips?|pastilles?|xylitol|suikale|kuutio|lohko|mehu|sose)\b/,
  },
  {
    ...dryRice,
    query: /^(?:(?:plain|dry|raw|uncooked|tavallinen|tavallista|kuiva|kuivaa|keittamaton|keittamatonta|vanligt) )?(?:rice|riisia?|ris)$/,
  },
  { ...dryRice, query: /^(?:basmati(?: rice|ris)?|basmatiriisi)$/, variety: /\bbasmati(?:riisi|ris)?\b/ },
  { ...dryRice, query: /^(?:jasmine? rice|jasmiini riisi|jasmiiniriisi)$/, variety: /\b(?:jasmine?|jasmiini(?:riisi)?)\b/ },
  { ...dryRice, query: /^(?:parboiled rice|parboiled riisi)$/, variety: /\bparboil(?:ed)?\b/ },
];

const groupedAllergens = new Map<string, readonly string[]>([
  ["AW", ["GB", "GK", "GO", "GS", "NR", "UW"]],
  ["AN", ["SA", "SC", "SH", "SM", "SP", "SR", "ST", "SW"]],
]);

export function hasExplicitAllergenAbsence(product: CatalogProduct, id: string): boolean {
  const evidence = product.allergens.filter((entry) => entry.id === id);
  if (!evidence.length || evidence.some(({ status }) => status !== "VERIFIED_ABSENT")) return false;
  const members = groupedAllergens.get(id);
  return !members || !product.allergens.some((entry) => members.includes(entry.id) && entry.status !== "VERIFIED_ABSENT");
}

function parseCatalogSearch(text: string | undefined) {
  const rawQuery = (text ?? "").trim();
  const typedRequirements = requirementsFromQuery(rawQuery);
  const productText = removeRequirementWords(rawQuery.split(orderDetails)[0]).toLowerCase();
  const normalized = searchText(productText);
  const withoutPrefix = normalized.replace(orderPrefix, "");
  const amounts = [...withoutPrefix.matchAll(orderAmount)].map(([amount]) => amount);
  const productQuery = withoutPrefix.replace(orderAmount, " ")
    .trim().replace(/^of\s+/, "").replace(/\b(?:please|of)\s*$/, "").trim()
    .replace(/^(?:plain )?(?:drinking )?milk$/, "milk");
  const phrase = (productQuery || withoutPrefix).trim().replace(/ +/g, " ");
  const tokens = [...new Set(phrase.split(" ").filter(Boolean))];
  const exactCode = productText && !/\s/.test(productText) ? productText : /^\d+$/.test(phrase) ? phrase : undefined;
  return {
    typedRequirements, productText, normalized, amounts, productQuery, phrase, tokens, exactCode,
    preferredCategory: preferredCategories.get(phrase),
  };
}

export function shortlistCatalog(index: CatalogIndex, query: ShortlistQuery): ShortlistItem[] {
  const limit = Math.min(Math.max(query.limit ?? DEFAULT_SHORTLIST_LIMIT, 1), 100);
  const offset = Math.min(Math.max(Math.floor(query.offset ?? 0), 0), 100000);
  const {
    typedRequirements, normalized, amounts, productQuery, phrase, tokens, exactCode, preferredCategory,
  } = parseCatalogSearch(query.query);
  const form = productForms.find((candidate) => candidate.query.test(phrase));
  const dietOnlySearch = typedRequirements.length > 0 && !tokens.length;
  const requiredClaims = [...new Set([...(query.requiredClaims ?? []), ...requirementClaims(typedRequirements)])];
  const freeFromAllergens = [...new Set(query.freeFromAllergens)];
  const wanted = new Set(query.productIds ?? []);

  if (query.includeSubstitutes) {
    for (const id of [...wanted]) {
      const product = index.products.get(id);
      for (const sub of product?.substituteProductIds ?? []) wanted.add(sub);
    }
  }

  const matches: { item: ShortlistItem; score: number }[] = [];
  const consider = wanted.size > 0 ? [...wanted].map((id) => index.products.get(id)).filter(Boolean) : [...index.products.values()];
  const searchable = tokens.length ? searchIndex(index) : undefined;

  for (const product of consider as CatalogProduct[]) {
    if (query.category && product.category !== query.category) continue;
    if (query.amountDimension && product.amountDimension !== query.amountDimension
      && product.secondaryPackMeasure?.unit !== query.amountDimension) continue;
    if (!freeFromAllergens.every((id) => hasExplicitAllergenAbsence(product, id))) continue;
    if (claimGate(product, requiredClaims)) continue;
    const reasons: string[] = [];
    let score = 0;
    if (tokens.length > 0) {
      const entry = searchable!.get(product.id)!;
      if (exactCode && entry.codes.includes(exactCode)) {
        score = 1000;
      } else if (form) {
        const { category, name: familyName, incompatibleName, variety, preferredName } = form;
        // Unclassified catalogs can still provide direct evidence through names.
        if ((/^\d+$/.test(product.category) && product.category !== category)
          || !entry.names.some((name) => familyName.test(name) && (!variety || variety.test(name)))
          || entry.names.some((name) => incompatibleName.test(name))) continue;
        score = preferredName && entry.names.some((name) => preferredName.test(name)) ? 50 : 20;
        if (amounts.some((amount) => entry.names.some((name) => ` ${name} `.includes(` ${amount} `)))) score += 2;
      } else if (entry.names.includes(normalized)) {
        score = 100;
      } else {
        let softened = 0;
        for (const token of tokens) {
          if (entry.nameWords.has(token)) score += 8;
          else if (entry.otherWords.has(token)) score += 5;
          else if (/^\p{L}{3,}$/u.test(token) && [...entry.nameWords].some((word) => word.startsWith(token))) score += 3;
          else if (/^\p{L}{5,}$/u.test(token) && softened === 0
            && [...entry.nameWords].some((word) => Math.min(word.length, token.length) >= 4 && singleEdit(token, word))) {
            softened += 1;
            score += 1;
          } else {
            score = -1;
            break;
          }
        }
        if (score < 0) continue;
        if (entry.names.includes(phrase)) score += 24;
        else if (entry.names.some((name) => ` ${name} `.includes(` ${phrase} `))) score += 12;
        else if (softened && entry.names.some((name) => {
          const words = name.split(" ");
          return words.length === tokens.length && tokens.every((token, i) => singleEdit(token, words[i]));
        })) score += 6;
        if (productQuery && amounts.some((amount) => entry.names.some((name) => ` ${name} `.includes(` ${amount} `)))) score += 2;
      }
      if (preferredCategory && product.category.startsWith(preferredCategory)) score += 30;
      reasons.push("QUERY_MATCH");
    }
    if (dietOnlySearch && product.names.some(({ value }) => {
      const declaredInName = requirementsFromQuery(value);
      return typedRequirements.every((requirement) => declaredInName.includes(requirement));
    })) score += 10;
    reasons.push(...requiredClaims.map((claim) => `CLAIM:${claim}`));
    reasons.push(...freeFromAllergens.map((id) => `ALLERGEN_FREE_FROM:${id}`));
    if (wanted.has(product.id)) reasons.push("REQUESTED_ID");
    matches.push({ item: { product, reasons, source: index.source }, score });
    if (!tokens.length && !dietOnlySearch && matches.length >= offset + limit) break;
  }
  return matches.sort((left, right) => right.score - left.score).slice(offset, offset + limit).map(({ item }) => item);
}

const fishAndShellfish = ["AF", "AC", "UM"];
const conflictingAllergens = new Map([
  ["FREE_FROM_GLUTEN", ["AW", "GLUTEN"]],
  ["VEGAN", [...fishAndShellfish, "AM", "ML", "AE"]],
  ["VEGETARIAN", fishAndShellfish],
]);

export function claimGate(product: CatalogProduct, requiredClaims: string[]): AdapterErrorCode | undefined {
  for (const claim of requiredClaims) {
    if (claim === "FREE_FROM_LACTOSE") {
      const nutrition = product.claims.filter(({ group, id, synkkaId }) => group === "nutritionalClaim"
        && (id === claim || id === "LOW_LACTOSE" || synkkaId === "LACTOSE"));
      const directLactoseEvidence = [...nutrition,
        ...product.allergens.filter(({ id, synkkaId }) => id === "ML" || id === "LACTOSE" || synkkaId === "LACTOSE"),
      ];
      if (directLactoseEvidence.some(({ id, status }) => id === "LOW_LACTOSE"
        || status === "DECLARED_PRESENT" || status === "MAY_CONTAIN")) return "CLAIM_NOT_MET";
      if (!nutrition.some(({ id, status }) => id === claim && status === "VERIFIED_ABSENT")
        || directLactoseEvidence.some(({ status }) => status === "UNKNOWN")) return "CLAIM_UNKNOWN";
      continue;
    }
    const expectedUnit = expectedRequirementUnit(claim);
    if (expectedUnit) {
      const declarations = product.claims.filter(({ id, group }) => id === claim && group === "nutritionalClaim");
      if (!declarations.length) return "CLAIM_UNKNOWN";
      if (declarations.some(({ status }) => status === "UNKNOWN")) return "CLAIM_UNKNOWN";
      if (declarations.some(({ unit }) => unit !== expectedUnit)) return "CLAIM_NOT_MET";
      const conflicts = conflictingAllergens.get(claim);
      if (conflicts && product.allergens.some(({ id, synkkaId, status }) => (conflicts.includes(id) || (synkkaId && conflicts.includes(synkkaId)))
        && (status === "DECLARED_PRESENT" || (claim === "FREE_FROM_GLUTEN" && status === "MAY_CONTAIN")))) return "CLAIM_NOT_MET";
      continue;
    }
    const found = product.claims.find((c) => c.id === claim || c.synkkaId === claim);
    if (!found || found.status === "UNKNOWN") return "CLAIM_UNKNOWN";
  }
  return undefined;
}

type PackDimension = CatalogProduct["amountDimension"];
type MeasuredUnit = "ml" | "g";

/** A reason a closest-match product falls short of the search. */
export type CatalogMismatch =
  | { kind: "query_word"; word: string }
  | { kind: "requirement"; requirement: ProductRequirement; status: "not_met" | "unknown"; healthRisk: boolean }
  | { kind: "allergen"; allergen: string; status: "present" | "may_contain" | "undeclared"; healthRisk: true }
  | { kind: "pack_measure"; requested: PackDimension; actual: PackDimension; approximate?: { amount: number; unit: MeasuredUnit } };

export interface ClosestCatalogMatch extends ShortlistItem {
  mismatches: CatalogMismatch[];
  healthRisk: boolean;
}

export interface ClosestCatalogQuery {
  query?: string;
  requirements?: readonly ProductRequirement[];
  freeFromAllergens?: readonly string[];
  amountDimension?: PackDimension;
  limit?: number;
}

/** An amount typed in a search, such as "10 kg" or "2,5 dl", with its value in grams or millilitres. */
export interface RequestedAmount {
  amount: number;
  unit: "kg" | "g" | "L" | "dl" | "cl" | "ml";
  base: number;
  baseUnit: MeasuredUnit;
}

/** How many packs cover a requested amount. Volume and weight are interchanged at 1 kg per litre and flagged as approximate. */
export interface PackConversion {
  requested: { amount: number; unit: RequestedAmount["unit"] };
  packAmount: number;
  packUnit: MeasuredUnit;
  packs: number;
  approximate: boolean;
}

// Missing these declarations can harm people with an intolerance or a disease, not only a preference.
const healthRequirements = new Set<ProductRequirement>(["lactose-free", "gluten-free"]);

const amountUnits: Record<string, { unit: RequestedAmount["unit"]; factor: number; baseUnit: MeasuredUnit }> = {
  kg: { unit: "kg", factor: 1000, baseUnit: "g" }, kilo: { unit: "kg", factor: 1000, baseUnit: "g" },
  kilos: { unit: "kg", factor: 1000, baseUnit: "g" }, kilogram: { unit: "kg", factor: 1000, baseUnit: "g" },
  kilograms: { unit: "kg", factor: 1000, baseUnit: "g" }, kiloa: { unit: "kg", factor: 1000, baseUnit: "g" },
  g: { unit: "g", factor: 1, baseUnit: "g" }, gram: { unit: "g", factor: 1, baseUnit: "g" },
  grams: { unit: "g", factor: 1, baseUnit: "g" }, grammaa: { unit: "g", factor: 1, baseUnit: "g" },
  l: { unit: "L", factor: 1000, baseUnit: "ml" }, ltr: { unit: "L", factor: 1000, baseUnit: "ml" },
  liter: { unit: "L", factor: 1000, baseUnit: "ml" }, liters: { unit: "L", factor: 1000, baseUnit: "ml" },
  litre: { unit: "L", factor: 1000, baseUnit: "ml" }, litres: { unit: "L", factor: 1000, baseUnit: "ml" },
  litraa: { unit: "L", factor: 1000, baseUnit: "ml" },
  dl: { unit: "dl", factor: 100, baseUnit: "ml" }, cl: { unit: "cl", factor: 10, baseUnit: "ml" },
  ml: { unit: "ml", factor: 1, baseUnit: "ml" },
};
const typedAmount = /(?<![\p{L}\p{N}.,])(\d+(?:[.,]\d+)?)\s*(kg|kilos?|kilograms?|kiloa|g|grams?|grammaa|l|ltr|lit(?:er|re)s?|litraa|dl|cl|ml)(?![\p{L}\p{N}])/iu;

export function requestedAmountFromQuery(text: string): RequestedAmount | undefined {
  const match = typedAmount.exec(text);
  if (!match) return undefined;
  const amount = Number(match[1].replace(",", "."));
  const unit = amountUnits[match[2].toLowerCase()];
  if (!unit || !Number.isFinite(amount) || amount <= 0) return undefined;
  return { amount, unit: unit.unit, base: amount * unit.factor, baseUnit: unit.baseUnit };
}

function packMeasures(product: CatalogProduct): { amount: number; unit: MeasuredUnit }[] {
  const measures: { amount: number; unit: MeasuredUnit }[] = [];
  if ((product.amountDimension === "ml" || product.amountDimension === "g") && product.amountPerSellUnit) {
    measures.push({ amount: product.amountPerSellUnit, unit: product.amountDimension });
  }
  if (product.secondaryPackMeasure?.amount) measures.push(product.secondaryPackMeasure);
  return measures;
}

/** Converts a typed amount into packs of this product. kg and g, or L, dl, cl and ml, convert exactly. */
export function packConversion(product: CatalogProduct, requested: RequestedAmount): PackConversion | undefined {
  const measures = packMeasures(product);
  const exact = measures.find(({ unit }) => unit === requested.baseUnit);
  const pack = exact ?? measures[0];
  if (!pack) return undefined;
  const ratio = requested.base / pack.amount;
  const rounded = Math.round(ratio);
  const packs = Math.abs(ratio - rounded) < 1e-9 ? rounded : Math.ceil(ratio);
  if (!Number.isSafeInteger(packs) || packs < 1) return undefined;
  return {
    requested: { amount: requested.amount, unit: requested.unit },
    packAmount: pack.amount, packUnit: pack.unit, packs, approximate: !exact,
  };
}

function allergenEvidenceStatus(product: CatalogProduct, id: string): "present" | "may_contain" | "undeclared" {
  const ids = [id, ...(groupedAllergens.get(id) ?? [])];
  const evidence = product.allergens.filter((entry) => ids.includes(entry.id));
  if (evidence.some(({ status }) => status === "DECLARED_PRESENT")) return "present";
  if (evidence.some(({ status }) => status === "MAY_CONTAIN")) return "may_contain";
  return "undeclared";
}

/** Missing declarations are "unknown", unless a declared allergen rules the requirement out, as gluten does for gluten-free. */
function requirementStatus(product: CatalogProduct, requirement: ProductRequirement): "not_met" | "unknown" | undefined {
  const [claim] = requirementClaims([requirement]);
  const gate = claimGate(product, [claim]);
  if (!gate) return undefined;
  if (gate === "CLAIM_NOT_MET") return "not_met";
  const conflicts = conflictingAllergens.get(claim);
  const declaredConflict = conflicts && product.allergens.some(({ id, synkkaId, status }) => status === "DECLARED_PRESENT"
    && (conflicts.includes(id) || (synkkaId !== undefined && conflicts.includes(synkkaId))));
  return declaredConflict ? "not_met" : "unknown";
}

const nameAbbreviations: Partial<Record<ProductRequirement, RegExp>> = { "gluten-free": /\bg-?free\b/i };

function namedRequirement(product: CatalogProduct, requirement: ProductRequirement): boolean {
  return [product.displayName, ...product.names.map(({ value }) => value)].some((name) =>
    requirementsFromQuery(name).includes(requirement) || nameAbbreviations[requirement]?.test(name));
}

function packMismatch(product: CatalogProduct, requested: PackDimension): CatalogMismatch {
  const measured = (dimension: PackDimension): dimension is MeasuredUnit => dimension === "ml" || dimension === "g";
  const actual = product.amountDimension;
  const approximate = measured(requested) && measured(actual) && product.amountPerSellUnit
    ? { amount: product.amountPerSellUnit, unit: requested }
    : undefined;
  return { kind: "pack_measure", requested, actual, ...(approximate && { approximate }) };
}

function mismatchPenalty(mismatch: CatalogMismatch): number {
  switch (mismatch.kind) {
    case "query_word": return 0; // Already reflected in how much of the name matched.
    case "allergen": return mismatch.status === "present" ? 80 : mismatch.status === "may_contain" ? 60 : 45;
    case "requirement":
      if (mismatch.healthRisk) return mismatch.status === "not_met" ? 70 : 50;
      return mismatch.status === "not_met" ? 30 : 20;
    case "pack_measure": return mismatch.approximate ? 10 : 20;
  }
}

/**
 * Ranks the products nearest to a search that has no exact match, and lists what each one does not meet.
 * A product must share at least one search word. Safety gaps cost more than a less precise name.
 */
export function closestCatalogMatches(index: CatalogIndex, query: ClosestCatalogQuery): ClosestCatalogMatch[] {
  const limit = Math.min(Math.max(query.limit ?? 5, 1), 12);
  const { typedRequirements, phrase, tokens, exactCode, preferredCategory } = parseCatalogSearch(query.query);
  const requestedAmount = requestedAmountFromQuery(query.query ?? "");
  const requirements = [...new Set([...(query.requirements ?? []), ...typedRequirements])];
  const allergens = [...new Set(query.freeFromAllergens ?? [])];
  const searchable = tokens.length ? searchIndex(index) : undefined;
  const ranked: { match: ClosestCatalogMatch; score: number }[] = [];

  for (const product of index.products.values()) {
    const mismatches: CatalogMismatch[] = [];
    let relevance = 1;
    let wordScore = 0;
    let typeBonus = 0;
    // A typed "1000ml" prefers products sold by volume; other units still convert.
    const unitBonus = requestedAmount && packMeasures(product).some(({ unit }) => unit === requestedAmount.baseUnit) ? 10 : 0;
    if (tokens.length) {
      const entry = searchable!.get(product.id)!;
      if (exactCode && entry.codes.includes(exactCode)) {
        wordScore = 60;
      } else {
        let matched = 0;
        let softened = 0;
        for (const token of tokens) {
          let score = 0;
          if (entry.nameWords.has(token)) score = 8;
          else if (entry.otherWords.has(token)) score = 5;
          else if (/^\p{L}{3,}$/u.test(token) && [...entry.nameWords].some((word) => word.startsWith(token))) score = 3;
          else if (/^\p{L}{5,}$/u.test(token) && softened === 0
            && [...entry.nameWords].some((word) => Math.min(word.length, token.length) >= 4 && singleEdit(token, word))) {
            softened += 1;
            score = 1;
          }
          if (score) {
            matched += 1;
            wordScore += score;
          } else {
            mismatches.push({ kind: "query_word", word: token });
          }
        }
        if (!matched) continue;
        relevance = matched / tokens.length;
        if (entry.names.some((name) => ` ${name} `.includes(` ${phrase} `))) wordScore += 12;
      }
      // The product type asked for (milk, not milk chocolate) outranks meeting more of the requirements.
      if (preferredCategory && product.category.startsWith(preferredCategory)) typeBonus = 80;
    }

    let namedBonus = 0;
    for (const requirement of requirements) {
      const status = requirementStatus(product, requirement);
      if (status) mismatches.push({ kind: "requirement", requirement, status, healthRisk: healthRequirements.has(requirement) });
      // A name such as "CROISSANT GFREE" ranks an undeclared product higher, but it still shows as not declared.
      if (status === "unknown" && namedRequirement(product, requirement)) namedBonus += 15;
    }
    for (const allergen of allergens) {
      if (!hasExplicitAllergenAbsence(product, allergen)) {
        mismatches.push({ kind: "allergen", allergen, status: allergenEvidenceStatus(product, allergen), healthRisk: true });
      }
    }
    if (query.amountDimension && product.amountDimension !== query.amountDimension
      && product.secondaryPackMeasure?.unit !== query.amountDimension) {
      mismatches.push(packMismatch(product, query.amountDimension));
    }

    const penalty = mismatches.reduce((total, mismatch) => total + mismatchPenalty(mismatch), 0);
    ranked.push({
      score: relevance * 100 + Math.min(wordScore, 60) / 2 + typeBonus + unitBonus + namedBonus - penalty,
      match: {
        product, reasons: ["CLOSEST_MATCH"], source: index.source, mismatches,
        healthRisk: mismatches.some((mismatch) => "healthRisk" in mismatch && mismatch.healthRisk),
      },
    });
  }

  return ranked
    .sort((left, right) => right.score - left.score
      || left.match.mismatches.length - right.match.mismatches.length
      || left.match.product.id.localeCompare(right.match.product.id))
    .slice(0, limit)
    .map(({ match }) => match);
}
