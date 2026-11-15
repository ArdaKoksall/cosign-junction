import type { Locale } from "./i18n";
import type { RankingObjective } from "./types";

export const rankingLabels = {
  cost: "Lowest estimated cost",
  reliability: "Highest historical reliability",
  carbon: "Lowest carbon intensity",
} satisfies Record<RankingObjective, string>;

const finnishRankingLabels = {
  cost: "Pienin arvioitu hinta",
  reliability: "Paras aiempi toimitusvarmuus",
  carbon: "Pienin päästöintensiteetti",
} satisfies Record<RankingObjective, string>;

export function rankingLabel(objective: RankingObjective, locale: Locale = "en") {
  return (locale === "fi" ? finnishRankingLabels : rankingLabels)[objective];
}
