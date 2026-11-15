import type { CatalogAdapter } from "@cosign/adapters";
import type { FastifyInstance } from "fastify";
import { httpError } from "../http-error.js";
import { estimateBudget } from "../intake/budget.js";
import { intakeInputSchema, intakeResult, type Draft, type FieldEvidence } from "../intake/fields.js";
import { readKitchenIntake } from "../intake/nemotron.js";
import { readRanking, typedRequirements } from "../intake/preferences.js";
import { isSimpleTypedRequest, readTypedNote } from "../intake/text.js";

export function registerIntakeRoute(app: FastifyInstance, options: {
  apiKey?: string;
  now: () => Date;
  adapter: CatalogAdapter;
  supplierPricing: boolean;
}) {
  app.post("/api/intake", { bodyLimit: 2_900_000 }, async (req) => {
    const input = intakeInputSchema.parse(req.body);
    const now = options.now();
    if (!options.apiKey && input.image) throw httpError(501, "Photo intake needs Nemotron. Type the request or use the manual form.");
    const local = readTypedNote(input.note, now);
    if (!input.image && local.delivery.standalone) {
      const result = intakeResult(local.draft, local.evidence, { model: "local" });
      if (local.draft.deadline) return { ...result, status: "draft", question: null };
      return { ...result, question: local.draft.deadlineDate ? "What time is the delivery due?" : "What future date and time is the delivery due?" };
    }
    const apiKey = input.image || !isSimpleTypedRequest(input.note, local.draft) ? options.apiKey : undefined;
    const extracted = apiKey ? await readKitchenIntake(input, { apiKey, now }).catch((error: unknown) => {
      if (input.image) throw error;
      return null;
    }) : null;
    const { providerAbstained, ...providerResult } = extracted ?? {};
    // Preserve an explicit abstention on reference material, while recovering fields rejected during grounding.
    if (providerAbstained) return providerResult;
    let draft: Draft = extracted?.draft ?? local.draft;
    let evidence: FieldEvidence[] = extracted?.evidence ?? local.evidence;
    if (extracted && !input.image && extracted.status !== "review_conflict" && !local.conflict) {
      const hasLocalDate = Boolean(local.draft.deadline || local.draft.deadlineDate || local.delivery.recognized && !local.delivery.expectedDate);
      const deadline = hasLocalDate ? local.draft.deadline : draft.deadline;
      const deadlineDate = hasLocalDate ? local.draft.deadlineDate : draft.deadlineDate;
      const reconciledFields = new Set<FieldEvidence["field"]>(["quantity", "unit", "budgetCents"]);
      if (hasLocalDate) {
        reconciledFields.add("deadline");
        reconciledFields.add("deadlineDate");
      }
      if (!draft.query) reconciledFields.add("query");
      if (!draft.diet) reconciledFields.add("diet");
      draft = {
        query: draft.query ?? local.draft.query,
        quantity: local.draft.quantity,
        unit: local.draft.unit,
        deadline,
        ...(deadlineDate && { deadlineDate }),
        budgetCents: local.draft.budgetCents,
        diet: draft.diet ?? local.draft.diet,
      };
      evidence = [...evidence.filter(({ field }) => !reconciledFields.has(field)), ...local.evidence.filter(({ field }) => reconciledFields.has(field))];
    }
    const conflict = extracted?.status === "review_conflict" ? extracted.question : local.conflict;
    if (local.conflict && !input.image) {
      draft = { ...draft, ...(local.ambiguousQuantity && { quantity: null, unit: null }), ...(local.ambiguousBudget && { budgetCents: null }) };
      evidence = evidence.filter(({ field }) => field !== "quantityLiters" && draft[field] != null);
    }
    const requirementEvidence = [...new Map([...(extracted?.requirementEvidence ?? []), ...typedRequirements(input.note)]
      .map((item) => [item.requirement, item])).values()];
    const requirements = requirementEvidence.map(({ requirement }) => requirement);
    const ranking = !input.image ? readRanking(input.note, "note") : extracted?.draft.rankingObjective && extracted.rankingEvidence
      ? { objective: extracted.draft.rankingObjective, evidence: extracted.rankingEvidence }
      : undefined;
    const budgetEstimate = conflict ? null : await estimateBudget(draft, options.adapter, now, options.supplierPricing, requirements);
    return intakeResult(draft, evidence, {
      model: extracted?.model ?? "local",
      conflict,
      conflictEvidence: extracted?.conflictEvidence,
      budgetEstimate,
      requirements,
      requirementEvidence,
      ranking,
    });
  });
}
