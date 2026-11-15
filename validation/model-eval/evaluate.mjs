import { readFile } from "node:fs/promises";
import { extname } from "node:path";

const base = new URL(process.env.COSIGN_URL ?? "http://localhost:8080");
const model = "nvidia/nemotron-3.5-super-vl-120b-a12b";
const photo = await readFile(new URL("./kitchen-note.png", import.meta.url));
const milkPhoto = { mimeType: "image/png", base64: photo.toString("base64") };
const pantryRequisition = await readFile(new URL("./pantry-requisition.png", import.meta.url));
const cases = [
  {
    name: "Finnish explicit requirements",
    note: "Tarvitaan laktoositonta maitoa 1000 l. Toimitus 24.11.2080 klo 11. Budjetti 1450 € ilman ALV:tä.",
    status: "draft",
    expected: { quantity: 1000, unit: "L", quantityLiters: 1000, budgetCents: 145000, diet: "lactose-free", deadline: "2080-11-24T09:00:00.000Z" },
  },
  {
    name: "English case count without a litre conversion",
    note: "Need 10 cases of lactose-free milk delivered before 11:00 Helsinki time on 24 November 2080. Total budget €1450 ex VAT.",
    status: "draft",
    expected: { quantity: 10, unit: "case", quantityLiters: null },
  },
  {
    name: "Finnish conflicting volumes",
    note: "Laktoositonta maitoa 100 l. Toinen vuoro vahvisti 1000 l samalle tilaukselle. Toimitus 24.11.2080 klo 11, budjetti 1450 € alv 0 %.",
    status: "review_conflict",
    expected: { quantity: null, unit: null, quantityLiters: null },
  },
  {
    name: "English missing time",
    note: "Please order 1000 L lactose-free milk for 24 November 2080. Budget €1450 ex VAT.",
    status: "clarify",
    expected: { deadline: null, deadlineDate: "2080-11-24" },
    question: "What time is the delivery due?",
  },
  {
    name: "Typed reliability preference with a hard budget",
    note: "Order 1000 L of lactose-free milk by 11:00 Helsinki time on 24 November 2080. Total budget 1450 EUR ex VAT. Prioritize the most reliable supplier.",
    status: "draft",
    expected: { quantity: 1000, unit: "L", budgetCents: 145000, diet: "lactose-free", rankingObjective: "reliability" },
    rankingEvidence: { source: "note", line: "Prioritize the most reliable supplier." },
  },
  {
    name: "Spoken-style transcript with a colloquial unit and a carbon preference",
    note: "12 kgs of chicken breast until November 20th 2080 at 10 AM budget is 400 euros lowest carbon intensity",
    status: "draft",
    expected: { query: "chicken breast", quantity: 12, unit: "kg", quantityLiters: null, budgetCents: 40000,
      deadline: "2080-11-20T08:00:00.000Z", rankingObjective: "carbon" },
    rankingEvidence: { source: "note", line: "12 kgs of chicken breast until November 20th 2080 at 10 AM budget is 400 euros lowest carbon intensity" },
  },
  {
    name: "Finnish photo with unspecified case volume",
    image: milkPhoto,
    status: "draft",
    expected: {
      query: ["milk", "maito"],
      quantity: 10,
      unit: "case",
      quantityLiters: null,
      deadline: "2080-11-24T09:00:00.000Z",
      budgetCents: 145000,
      diet: "lactose-free",
    },
    photoEvidence: {
      query: "Tuote: laktoositon maito (milk)",
      quantity: "Määrä: 10 laatikkoa",
      unit: "Määrä: 10 laatikkoa",
      deadline: "Toimitus: 24.11.2080 klo 11 (Helsinki)",
      budgetCents: "Budjetti: 1450 € (ALV 0 %)",
      diet: "Tuote: laktoositon maito (milk)",
    },
  },
  {
    name: "Photo with two product requirements and a carbon preference",
    image: { mimeType: "image/png", base64: pantryRequisition.toString("base64") },
    status: "draft",
    expected: { query: "pasta", quantity: 20, unit: "kg", deadline: "2080-11-24T09:00:00.000Z", budgetCents: 15000, rankingObjective: "carbon" },
    requirements: {
      vegan: { source: "image", line: "Product: Vegan gluten-free pasta" },
      "gluten-free": { source: "image", line: "Product: Vegan gluten-free pasta" },
    },
    rankingEvidence: { source: "image", line: "Prioritize the lowest carbon footprint." },
  },
  {
    name: "Photo and typed note disagree on the milk case count",
    note: "Order 100 cases of lactose-free milk.",
    image: milkPhoto,
    status: "review_conflict",
    expected: { query: ["milk", "maito"], quantity: null, unit: null, quantityLiters: null },
    question: "The note and photo give different quantities or units. Which total should the buyer use?",
    conflictEvidence: [
      { source: "note", line: "Order 100 cases of lactose-free milk.", amount: "100 cases" },
      { source: "image", line: "Määrä: 10 laatikkoa", amount: "10 laatikkoa" },
    ],
  },
  {
    name: "Photo and typed note agree on the milk case count",
    note: "Order 10 cases of lactose-free milk.",
    image: milkPhoto,
    status: "draft",
    expected: { query: ["milk", "maito"], quantity: 10, unit: "case", quantityLiters: null, deadline: "2080-11-24T09:00:00.000Z", budgetCents: 145000 },
    conflictEvidence: [],
  },
];

const challengePhoto = process.env.COSIGN_CHALLENGE_PHOTO;
if (challengePhoto) {
  const bytes = await readFile(challengePhoto);
  if (bytes.length > 2 * 1024 * 1024) throw new Error("Provide a PNG or JPEG version of the challenge photo under 2 MiB");
  const extension = extname(challengePhoto).toLowerCase();
  const mimeType = extension === ".png" ? "image/png" : /^\.jpe?g$/.test(extension) ? "image/jpeg" : null;
  if (!mimeType) throw new Error("The challenge photo must be a PNG or JPEG");
  cases.push({
    name: "Challenge poster example leaves purchase fields empty",
    image: { mimeType, base64: bytes.toString("base64") },
    status: "clarify",
    expected: { query: null, quantity: null, unit: null, deadline: null, budgetCents: null, diet: null, rankingObjective: undefined },
    requirements: {},
    photoEvidence: {},
    question: "What product does the kitchen need?",
  });
}

function fieldMatches(field, expected, actual) {
  if (Array.isArray(expected)) return typeof actual === "string" && expected.includes(actual.toLowerCase());
  if (field === "deadline" && typeof expected === "string") {
    return typeof actual === "string" && Date.parse(actual) === Date.parse(expected);
  }
  return actual === expected;
}

function evidenceMatches(actual, { source, line }) {
  return actual?.source === source && typeof actual.excerpt === "string" && Boolean(actual.excerpt.trim())
    && line.includes(actual.excerpt.trim());
}

function verifyPhotoEvidence(actual, expected) {
  if (!Array.isArray(actual)) return ["Expected image evidence for the extracted fields"];
  const problems = [];
  if (actual.length !== Object.keys(expected).length) {
    problems.push(`Expected ${Object.keys(expected).length} image evidence entries, got ${actual.length}`);
  }
  for (const [field, line] of Object.entries(expected)) {
    const entries = actual.filter((item) => item?.field === field);
    if (entries.length !== 1 || !evidenceMatches(entries[0], { source: "image", line })) {
      problems.push(`Expected exactly one ${field} excerpt from ${JSON.stringify(line)}, got ${JSON.stringify(entries)}`);
    }
  }
  return problems;
}

function verifyResult(response, actual, scenario) {
  if (!response.ok) return [`HTTP ${response.status}: ${actual?.error ?? "intake request failed"}`];
  if (!actual || typeof actual !== "object") return ["The API response is not a JSON object"];

  const problems = [];
  if (actual.model !== model && (scenario.image || actual.model !== "local")) {
    problems.push(`Expected ${scenario.image ? model : `${model} or local`}, got ${actual.model}`);
  }
  if (actual.status !== scenario.status) problems.push(`Expected status ${scenario.status}, got ${actual.status}`);
  if (scenario.question && actual.question !== scenario.question) {
    problems.push(`Expected question ${JSON.stringify(scenario.question)}, got ${JSON.stringify(actual.question)}`);
  }
  for (const [field, expected] of Object.entries(scenario.expected)) {
    const output = actual.draft?.[field];
    if (!fieldMatches(field, expected, output)) {
      problems.push(`Expected ${field} ${JSON.stringify(expected)}, got ${JSON.stringify(output)}`);
    }
  }
  if (scenario.photoEvidence) problems.push(...verifyPhotoEvidence(actual.evidence, scenario.photoEvidence));
  if (scenario.conflictEvidence) {
    const entries = Array.isArray(actual.conflictEvidence) ? actual.conflictEvidence : [];
    if (entries.length !== scenario.conflictEvidence.length) {
      problems.push(`Expected ${scenario.conflictEvidence.length} conflict excerpts, got ${entries.length}`);
    }
    for (const expected of scenario.conflictEvidence) {
      if (!entries.some((entry) => evidenceMatches(entry, expected) && entry.excerpt.includes(expected.amount))) {
        problems.push(`Expected a ${expected.source} conflict excerpt containing ${JSON.stringify(expected.amount)}`);
      }
    }
  }
  if (scenario.rankingEvidence && !evidenceMatches(actual.rankingEvidence, scenario.rankingEvidence)) {
    problems.push(`Expected ranking evidence from ${JSON.stringify(scenario.rankingEvidence.line)}, got ${JSON.stringify(actual.rankingEvidence)}`);
  }
  if (scenario.requirements) {
    const requirements = Object.keys(scenario.requirements).sort();
    const actualRequirements = Array.isArray(actual.draft?.requirements) ? actual.draft.requirements.toSorted() : [];
    if (JSON.stringify(requirements) !== JSON.stringify(actualRequirements)) {
      problems.push(`Expected requirements ${JSON.stringify(requirements)}, got ${JSON.stringify(actualRequirements)}`);
    }
    const entries = Array.isArray(actual.requirementEvidence) ? actual.requirementEvidence : [];
    if (entries.length !== requirements.length) problems.push(`Expected ${requirements.length} requirement excerpts, got ${entries.length}`);
    for (const [requirement, expected] of Object.entries(scenario.requirements)) {
      const matching = entries.find((item) => item?.requirement === requirement);
      if (!evidenceMatches(matching, expected)) problems.push(`Expected ${requirement} evidence from ${JSON.stringify(expected.line)}, got ${JSON.stringify(matching)}`);
    }
  }
  return problems;
}

const availability = await fetch(new URL("/api/capabilities", base), { signal: AbortSignal.timeout(10_000) });
if (!availability.ok || !(await availability.json()).intakePhotoEnabled) {
  throw new Error("Start the connected workspace with NVIDIA_API_KEY to run this evaluation");
}

let passes = 0;
const sources = new Map();
const latencies = [];
for (const scenario of cases) {
  const started = performance.now();
  let problems;
  let source;
  try {
    const response = await fetch(new URL("/api/intake", base), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ note: scenario.note, image: scenario.image }),
      signal: AbortSignal.timeout(40_000),
    });
    const actual = await response.json().catch(() => null);
    source = actual?.model === model ? "Nemotron" : actual?.model === "local" ? "local parser" : undefined;
    if (source) sources.set(source, (sources.get(source) ?? 0) + 1);
    latencies.push(performance.now() - started);
    problems = verifyResult(response, actual, scenario);
  } catch (error) {
    problems = [`Intake request failed: ${error.message}`];
  }
  const pass = problems.length === 0;
  passes += Number(pass);
  console.log(`${pass ? "PASS" : "FAIL"} ${scenario.name} · ${Math.round(performance.now() - started)} ms${source ? ` · ${source}` : ""}`);
  for (const problem of problems) console.log(`  ${problem}`);
}
console.log(`${passes}/${cases.length} intake cases passed`);
if (sources.size) console.log(`Extraction sources · ${[...sources].map(([source, count]) => `${source} ${count}`).join(" · ")}`);
if (latencies.length) {
  const ordered = latencies.toSorted((a, b) => a - b);
  const midpoint = Math.floor(ordered.length / 2);
  const median = ordered.length % 2 ? ordered[midpoint] : (ordered[midpoint - 1] + ordered[midpoint]) / 2;
  console.log(`HTTP response latency (n=${latencies.length}) · median ${Math.round(median)} ms · max ${Math.round(ordered.at(-1))} ms`);
}
process.exitCode = passes === cases.length ? 0 : 1;
