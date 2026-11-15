import { productRequirements, requirementsFromQuery, type ProductRequirement } from "@cosign/adapters";
import { z } from "zod";

export const allergenCode = z.string().regex(/^[A-Z][A-Z0-9]{1,2}$/);

export function requestedProductRequirements(diet: string, selected: readonly ProductRequirement[] = [], query = "") {
  const requirements = new Set<ProductRequirement>([...selected, ...requirementsFromQuery(query)]);
  if (diet === "lactose-free") requirements.add("lactose-free");
  return productRequirements.filter((requirement) => requirements.has(requirement));
}
