import type { RankingObjective } from "./ranking-objective.js";
import type { SupplierObservation } from "./types.js";

const hardBlocks = new Set(["CUTOFF_PASSED", "SALES_BLOCK", "DELIVERY_CONFLICT", "STOCK_SHORT"]);

export function supplierBlockers(product: SupplierObservation) {
  const blockers = product.issues.filter((issue) => hardBlocks.has(issue));
  if (product.estimate?.budgetFit === "over_budget") blockers.push("OVER_BUDGET");
  if (product.estimate?.stockFit === "reported_insufficient" && !blockers.includes("STOCK_SHORT")) {
    blockers.push("STOCK_INSUFFICIENT");
  }
  return blockers;
}

function rankingMetric(product: SupplierObservation, objective: RankingObjective) {
  switch (objective) {
    case "cost": return product.estimate?.totalCents ?? null;
    case "reliability": return product.reliability;
    case "carbon": return product.carbon;
  }
}

type Candidate = {
  productId: string;
  name: string;
  totalCents: number | null;
  blockers: string[];
  openQuestions: string[];
};

type Ranking = {
  objective: RankingObjective;
  status: "ranked" | "unavailable";
  candidateCount: number;
  measuredCount: number;
  preferred?: Candidate & { totalCents: number; reliability: number | null; carbon: number | null };
};

function rankOptions(options: { summary: Candidate; product: SupplierObservation }[], objective: RankingObjective): Ranking {
  const candidates = options.flatMap(({ summary, product }) => summary.blockers.length === 0
    && product.estimate?.budgetFit === "within_budget" && summary.totalCents !== null
    ? [{ summary: { ...summary, totalCents: summary.totalCents }, product }] : []);
  const measured = candidates.flatMap((candidate) => {
    const metric = rankingMetric(candidate.product, objective);
    return metric !== null && Number.isFinite(metric) ? [{ ...candidate, metric }] : [];
  });
  const direction = objective === "reliability" ? -1 : 1;
  measured.sort((left, right) => direction * (left.metric - right.metric)
    || left.summary.openQuestions.length - right.summary.openQuestions.length
    || left.summary.productId.localeCompare(right.summary.productId));
  const first = measured[0];
  return {
    objective, status: first ? "ranked" : "unavailable", candidateCount: candidates.length, measuredCount: measured.length,
    ...(first && { preferred: { ...first.summary, reliability: first.product.reliability, carbon: first.product.carbon } }),
  };
}

export function supplierDecision(observations: SupplierObservation[], objective?: RankingObjective) {
  const options = observations.map((product) => {
    const blockers = supplierBlockers(product);

    const openQuestions = product.issues.filter((issue) => !hardBlocks.has(issue));
    if (product.estimate?.stockFit === "unverified" && !blockers.includes("STOCK_SHORT")
      && !openQuestions.includes("STOCK_UNKNOWN") && !openQuestions.includes("VARIABLE_WEIGHT")) {
      openQuestions.push("STOCK_UNKNOWN");
    }
    return {
      summary: { productId: product.productId, name: product.name, totalCents: product.estimate?.totalCents ?? null, blockers, openQuestions },
      product,
    };
  });
  const withinBudget = options.filter(({ product, summary }) => product.estimate?.budgetFit === "within_budget" && summary.totalCents != null)
    .map(({ summary }) => summary)
    .sort((left, right) => (left.totalCents ?? 0) - (right.totalCents ?? 0) || left.productId.localeCompare(right.productId));
  const candidates = options.map(({ summary }) => summary).filter(({ blockers }) => blockers.length === 0);
  const firstToConfirm = withinBudget.find(({ blockers }) => blockers.length === 0);
  const outcome = observations.length === 0 ? "no_match"
    : candidates.some(({ openQuestions }) => openQuestions.length === 0) ? "evidence_complete"
    : candidates.length > 0 ? "needs_confirmation" : "blocked";
  return {
    outcome,
    withinBudgetCount: withinBudget.length,
    bestWithinBudget: firstToConfirm ?? withinBudget[0] ?? null,
    ...(outcome === "blocked" && { runnersUp: runnersUp(options.map(({ summary }) => summary)) }),
    ...(objective && { ranking: rankOptions(options, objective) }),
  } as const;
}

// How hard a blocker is to work around: paying more is easier than another delivery date, and a sales block cannot be.
const blockerWeights: Record<string, number> = {
  OVER_BUDGET: 1, STOCK_INSUFFICIENT: 2, STOCK_SHORT: 2, DELIVERY_CONFLICT: 3, CUTOFF_PASSED: 3, SALES_BLOCK: 6,
};

/** When every product is blocked, the nearest options with what stops each one. */
function runnersUp(options: Candidate[], limit = 3): Candidate[] {
  const weight = ({ blockers }: Candidate) => blockers.reduce((total, blocker) => total + (blockerWeights[blocker] ?? 3), 0);
  return [...options]
    .sort((left, right) => left.blockers.length - right.blockers.length || weight(left) - weight(right)
      || (left.totalCents ?? Infinity) - (right.totalCents ?? Infinity)
      || left.openQuestions.length - right.openQuestions.length
      || left.productId.localeCompare(right.productId))
    .slice(0, limit);
}
