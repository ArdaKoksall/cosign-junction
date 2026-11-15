import { z } from "zod";

export const rankingObjectiveSchema = z.enum(["cost", "reliability", "carbon"]);
export type RankingObjective = z.infer<typeof rankingObjectiveSchema>;
