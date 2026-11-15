import { requirementsFromQuery, type ProductRequirement } from "@cosign/adapters";
import type { RankingObjective } from "../purchasing/ranking-objective.js";
import type { RequirementEvidence, SourceEvidence } from "./fields.js";

const priorityCue = /\b(?:prioriti[sz]e|prefer|favo[u]r|optimi[sz]e\s+for|focus\s+on|choose|select|aim\s+for|matters?\s+(?:most|more\s+than)|(?:top|main|highest)\s+priority|priority(?=\s*:)|rank\s+by|sort\s+by|takes?\s+priority|suosi|valitse|priorisoi|painota|ensisijais\p{L}*|tärkein)\b/iu;
const directedPreference = String.raw`\b(?:lowest\s+(?:carbon(?:\s+(?:footprint|intensity|emissions))?|emissions|co2e?|(?:total\s+)?(?:price|cost))|highest\s+(?:delivery\s+)?reliability)\b`;
const explicitPrioritySuffix = new RegExp(String.raw`${directedPreference}\s+priority\b`, "iu");
const barePrioritySuffix = new RegExp(String.raw`(?:^|,\s*|\bwith\s+|(?:€|\b(?:euros?|euroa|eur))\s+)(?:the\s+)?${directedPreference}[.!]?$`, "iu");
export const prioritySuffix = new RegExp(String.raw`(?:${explicitPrioritySuffix.source}|${directedPreference}(?=[.!]?$))`, "iu");
const preferenceTopics: Record<RankingObjective, RegExp> = {
  cost: /\b(?:price|cost|cheapest|affordab\p{L}*|hint\p{L}*|halv\p{L}*|edullis\p{L}*|kustann\p{L}*)\b/iu,
  reliability: /\b(?:reliab\p{L}*|dependab\p{L}*|on[\s-]time\s+deliver\p{L}*|delivery\s+record|toimitusvarmu\p{L}*|täsmälli\p{L}*|luotettav\p{L}*)\b/iu,
  carbon: /\b(?:carbon|emissions|co2e?|climate\s+impact|hiilijalanjäl\p{L}*|päästö\p{L}*|ilmastovaikut\p{L}*)\b/iu,
};
const uncertainPriority = /\b(?:not|no(?:ne)?|never|without|avoid|deprioriti[sz]e|uncertain|optional|if\s+(?:possible|available)|ei|älä|epäselvää|valinnainen|jos\s+mahdollista)\b|n['’]t\b/iu;
const wrongDirection = /\b(?:highest|higher|most\s+expensive)\s+(?:(?:purchase|total|unit)\s+)?(?:price|cost|carbon|emissions)\b|\b(?:lowest|lower|least)\s+(?:delivery\s+)?(?:reliability|reliable)\b/iu;
const alternativeTradeoff = /\s+(?:(?:matters?\s+)?more\s+than|over|rather\s+than|ahead\s+of|ennen)\s+/iu;
const optionalRequirement = /\b(?:optional|preferred|preferably|ideally|not\s+(?:required|necessary)|nice\s+to\s+have|would\s+be\s+nice|if\s+possible|ei\s+(?:pakollinen|tarpeen)|valinnainen|mielellään|jos\s+mahdollista)\b/iu;

function excerpts(text: string) {
  return text.split(/[\r\n;]|(?<=[.!?])(?=\s+\p{L})/u).map((part) => part.trim()).filter(Boolean);
}

function requirementClauses(text: string) {
  return excerpts(text).flatMap((excerpt) => {
    const separators = [...excerpt.matchAll(/,\s+|\s+(?:but|mutta)\s+/giu)];
    const clauses: string[] = [];
    let start = 0;
    for (const [index, separator] of separators.entries()) {
      const next = separator.index + separator[0].length;
      const before = excerpt.slice(start, separator.index);
      const after = excerpt.slice(next, separators[index + 1]?.index);
      if (requirementsFromQuery(before).length && requirementsFromQuery(after).length) {
        clauses.push(before.trim());
        start = next;
      }
    }
    return [...clauses, excerpt.slice(start).trim()];
  });
}

export function readRanking(text: string, source: SourceEvidence["source"]) {
  const decisions = new Map<RankingObjective, SourceEvidence>();
  for (const excerpt of excerpts(text)) {
    if (!priorityCue.test(excerpt) && !explicitPrioritySuffix.test(excerpt) && !barePrioritySuffix.test(excerpt)) continue;
    const [preferred] = excerpt.split(alternativeTradeoff);
    const objectives = (Object.keys(preferenceTopics) as RankingObjective[]).filter((key) => preferenceTopics[key].test(preferred));
    if (objectives.length > 1 || objectives.length > 0 && (uncertainPriority.test(excerpt) || wrongDirection.test(preferred))) return;
    if (objectives.length === 1 && excerpt.length <= 240 && !decisions.has(objectives[0])) {
      decisions.set(objectives[0], { source, excerpt });
    }
  }
  if (decisions.size !== 1) return;
  const [[objective, evidence]] = decisions;
  return { objective, evidence };
}

export function supportsRequirement(excerpt: string, requirement: ProductRequirement) {
  return typedRequirements(excerpt).some((item) => item.requirement === requirement);
}

export function typedRequirements(note: string): RequirementEvidence[] {
  const evidence = new Map<ProductRequirement, RequirementEvidence>();
  for (const excerpt of requirementClauses(note)) {
    if (excerpt.length > 240 || optionalRequirement.test(excerpt)) continue;
    for (const requirement of requirementsFromQuery(excerpt)) {
      if (!evidence.has(requirement)) evidence.set(requirement, { requirement, source: "note", excerpt });
    }
  }
  return [...evidence.values()];
}
