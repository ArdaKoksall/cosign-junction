import type { CatalogProduct } from "./types";

const packNumbers = {
  en: new Intl.NumberFormat("en-GB", { maximumFractionDigits: 3 }),
  fi: new Intl.NumberFormat("fi-FI", { maximumFractionDigits: 3 }),
};

function formatPackMeasure(amount: number, dimension: "ml" | "g", packNumber: Intl.NumberFormat) {
  const unit = dimension === "ml" ? (amount >= 1000 ? "L" : "mL") : (amount >= 1000 ? "kg" : "g");
  return `${packNumber.format(amount >= 1000 ? amount / 1000 : amount)} ${unit}`;
}

export function catalogPackDescription({ amountPerSellUnit: amount, amountDimension: dimension, secondaryPackMeasure }:
  Pick<CatalogProduct, "amountDimension" | "amountPerSellUnit" | "secondaryPackMeasure">, locale: "en" | "fi" = "en") {
  if (amount === null || dimension === "unmapped") return locale === "fi" ? "Pakkauskokoa ei ole vahvistettu" : "Pack size unverified";
  const packNumber = packNumbers[locale];
  const suffix = locale === "fi" ? "myyntiyksikköä kohden" : "per sales unit";
  if (dimension === "each") return `${packNumber.format(amount)} ${suffix}`;
  const measures = [formatPackMeasure(amount, dimension, packNumber)];
  if (secondaryPackMeasure) measures.push(formatPackMeasure(secondaryPackMeasure.amount, secondaryPackMeasure.unit, packNumber));
  return `${measures.join(" · ")} ${suffix}`;
}
