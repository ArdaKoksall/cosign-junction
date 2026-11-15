import type { SupplierObservation } from "./types.js";

export type StockUse = { salesUnits: number; availableSellUnits: number };
export type BasketSelection = { itemId: string; productId: string; availableDate: string };
export type BasketPlanExplanation = {
  basis: "earliest_completion_then_lowest_total";
  completionDate: string;
  priceOptimal: boolean;
};
export type BasketPlan =
  | { status: "feasible"; selections: BasketSelection[]; totalCents: number; caveats?: string[]; explanation?: BasketPlanExplanation }
  | { status: "blocked" | "unresolved"; reasons: string[] };

export function combinedStock(previous: StockUse | undefined, salesUnits: number, availableSellUnits: number): StockUse | null {
  const available = Math.min(previous?.availableSellUnits ?? Infinity, availableSellUnits);
  const used = Number(((previous?.salesUnits ?? 0) + salesUnits).toPrecision(15));
  return used > available ? null : { salesUnits: used, availableSellUnits: available };
}

export function deliveryStockKey(productId: string, availableDate: string | undefined) {
  return JSON.stringify([productId, availableDate]);
}

type BasketLine = { itemId: string; offers: SupplierObservation[] };
type BasketOption = BasketSelection & StockUse & { totalCents: number };
const searchLimit = 40_000;

/** Find the lowest total supported by the checked offers on the earliest completion day. */
export function recommendBasket(lines: BasketLine[], budgetCents?: number): BasketPlan {
  const maximumTotal = budgetCents ?? Number.MAX_SAFE_INTEGER;
  const optionsByLine = lines.map(({ itemId, offers }) => offers.flatMap((offer): BasketOption[] => {
    if (!offer.availableDate || offer.availableSellUnits == null || offer.estimate?.totalCents == null) return [];
    return [{
      itemId, productId: offer.productId, availableDate: offer.availableDate,
      salesUnits: offer.estimate.salesUnits, availableSellUnits: offer.availableSellUnits,
      totalCents: offer.estimate.totalCents,
    }];
  }));
  if (!optionsByLine.length || optionsByLine.some(options => !options.length)) {
    return { status: "blocked", reasons: ["At least one item has no eligible offer on the checked dates."] };
  }

  const dates = [...new Set(optionsByLine.flatMap(options => options.map(({ availableDate }) => availableDate)))].sort();
  const stock = new Map<string, StockUse>();
  const chosen: BasketOption[] = [];
  let visited = 0;

  for (const date of dates) {
    const candidateLines = optionsByLine.map(options => options.filter(option => option.availableDate <= date)
      .sort((left, right) => left.totalCents - right.totalCents || left.availableDate.localeCompare(right.availableDate)))
      .sort((left, right) => left.length - right.length);
    if (!candidateLines[0].length) continue;
    const cheapestRemaining = new Array<number>(candidateLines.length + 1).fill(0);
    for (let index = candidateLines.length - 1; index >= 0; index--) {
      cheapestRemaining[index] = candidateLines[index][0].totalCents + cheapestRemaining[index + 1];
    }

    let best: { options: BasketOption[]; totalCents: number } | undefined;
    function search(index: number, totalCents: number) {
      if (index === candidateLines.length) {
        best = { options: [...chosen], totalCents };
        return;
      }
      for (const option of candidateLines[index]) {
        const optionTotal = totalCents + option.totalCents;
        // Ignoring joint stock yields a lower bound. Later options cost at least as much.
        const minimumTotal = optionTotal + cheapestRemaining[index + 1];
        if (minimumTotal > maximumTotal || (best && minimumTotal >= best.totalCents)) break;
        if (++visited > searchLimit) return;
        const key = deliveryStockKey(option.productId, option.availableDate);
        const previous = stock.get(key);
        const combined = combinedStock(previous, option.salesUnits, option.availableSellUnits);
        if (!combined) continue;
        stock.set(key, combined);
        chosen.push(option);
        search(index + 1, optionTotal);
        chosen.pop();
        if (previous) stock.set(key, previous);
        else stock.delete(key);
        if (visited > searchLimit) return;
      }
    }

    search(0, 0);
    if (best) {
      const byItem = new Map(best.options.map(option => [option.itemId, option]));
      const selections = lines.map(({ itemId }) => {
        const { productId, availableDate } = byItem.get(itemId)!;
        return { itemId, productId, availableDate };
      });
      return {
        status: "feasible", selections, totalCents: best.totalCents,
        explanation: {
          basis: "earliest_completion_then_lowest_total",
          completionDate: date,
          priceOptimal: visited <= searchLimit,
        },
      };
    }
    if (visited > searchLimit) {
      return { status: "unresolved", reasons: ["The checked offers did not yield a basket within the comparison search limit."] };
    }
  }

  return {
    status: "blocked",
    reasons: [budgetCents === undefined
      ? "No combination from the checked offers fits the available stock and supported order total."
      : "No combination from the checked offers fits both the shared budget and available stock."],
  };
}
