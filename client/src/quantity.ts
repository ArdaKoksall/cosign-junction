import type { Locale } from "./i18n";
import type { QuantityUnit, SavedRequest } from "./types";

export const quantityUnits = [
  { value: "kg", label: "Kilograms (kg)", finnish: "Kilogrammat (kg)" },
  { value: "g", label: "Grams (g)", finnish: "Grammat (g)" },
  { value: "L", label: "Litres (L)", finnish: "Litrat (l)" },
  { value: "ml", label: "Millilitres (mL)", finnish: "Millilitrat (ml)" },
  { value: "each", label: "Items", finnish: "Kappaleet" },
  { value: "case", label: "Cases", finnish: "Laatikot" },
] satisfies { value: QuantityUnit; label: string; finnish: string }[];

const numbers = {
  en: new Intl.NumberFormat("en", { maximumFractionDigits: 3 }),
  fi: new Intl.NumberFormat("fi", { maximumFractionDigits: 3 }),
};
const finnishUnits: Partial<Record<QuantityUnit, string>> = { each: "kpl", case: "laatikkoa", L: "l", ml: "ml" };

export function formatQuantity(amount: number, unit: QuantityUnit, locale: Locale = "en"): string {
  const label = locale === "fi" ? finnishUnits[unit] ?? unit
    : unit === "each" ? (amount === 1 ? "item" : "items")
      : unit === "case" ? (amount === 1 ? "case" : "cases")
        : unit === "ml" ? "mL" : unit;
  return `${numbers[locale].format(amount)} ${label}`;
}

export function formatRequestQuantity(request: Pick<SavedRequest, "quantity" | "unit" | "quantityLiters">, locale: Locale = "en"): string {
  return formatQuantity(request.quantity ?? request.quantityLiters ?? 0, request.unit ?? "L", locale);
}
