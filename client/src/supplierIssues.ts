const issueLabels: Record<string, string> = {
  STOCK_UNKNOWN: "Stock quantity is unverified",
  STOCK_SHORT: "No stock reported",
  CUTOFF_PASSED: "Ordering cutoff has passed",
  CUTOFF_UNVERIFIED: "Ordering cutoff is unverified",
  SALES_BLOCK: "Sales are blocked",
  PRICE_UNUSABLE: "No usable price returned",
  PRICE_LOOKUP_UNAVAILABLE: "Supplier pricing could not be loaded",
  AVAILABILITY_LOOKUP_UNAVAILABLE: "Supplier availability could not be loaded",
  EMPTY_SCHEDULE: "No availability schedule returned",
  PACK_UNMAPPED: "Pack size or sales increment needs confirmation",
  VOLUME_UNMAPPED: "Sales-unit volume needs confirmation",
  UNIT_MISMATCH: "Availability and catalog units differ",
  DELIVERY_CONFLICT: "Availability misses the requested date",
  DELIVERY_TIME_UNVERIFIED: "Delivery hour has not been confirmed",
  DEPOSIT_CHARGES_UNVERIFIED: "Deposit charges need confirmation",
  VARIABLE_WEIGHT: "The final quantity and cost depend on the actual weight",
  OVER_BUDGET: "Exceeds the requested budget",
  OVER_PREFERRED_BUDGET: "Exceeds the budget target",
  OUTSIDE_PREFERRED_DELIVERY_DATE: "Outside the preferred delivery date",
  STOCK_INSUFFICIENT: "Reported stock cannot cover the requested quantity",
};

const finnishIssueLabels: Record<string, string> = {
  STOCK_UNKNOWN: "Varastosaldoa ei ole vahvistettu",
  STOCK_SHORT: "Tuotetta ei ole ilmoitettu olevan varastossa",
  CUTOFF_PASSED: "Tilausaika on päättynyt",
  CUTOFF_UNVERIFIED: "Tilausaikaa ei ole vahvistettu",
  SALES_BLOCK: "Tuote on myyntikiellossa",
  PRICE_UNUSABLE: "Käyttökelpoista hintaa ei saatu",
  PRICE_LOOKUP_UNAVAILABLE: "Toimittajan hintatietoja ei saatu",
  AVAILABILITY_LOOKUP_UNAVAILABLE: "Toimittajan saatavuustietoja ei saatu",
  EMPTY_SCHEDULE: "Saatavuusaikataulua ei saatu",
  PACK_UNMAPPED: "Pakkauskoko tai myyntierä on vahvistettava",
  VOLUME_UNMAPPED: "Myyntiyksikön tilavuus on vahvistettava",
  UNIT_MISMATCH: "Saatavuustietojen ja tuotevalikoiman yksiköt eroavat",
  DELIVERY_CONFLICT: "Tuotetta ei ole saatavilla pyydettynä ajankohtana",
  DELIVERY_TIME_UNVERIFIED: "Toimituksen kellonaikaa ei ole vahvistettu",
  DEPOSIT_CHARGES_UNVERIFIED: "Panttimaksut on vahvistettava",
  VARIABLE_WEIGHT: "Lopullinen määrä ja hinta riippuvat todellisesta painosta",
  OVER_BUDGET: "Ylittää pyydetyn budjetin",
  OVER_PREFERRED_BUDGET: "Ylittää budjettitavoitteen",
  OUTSIDE_PREFERRED_DELIVERY_DATE: "Toivotun toimitusajankohdan ulkopuolella",
  STOCK_INSUFFICIENT: "Ilmoitettu varasto ei kata pyydettyä määrää",
};

export function supplierIssueLabel(issue: string, locale: "en" | "fi" = "en") {
  const labels = locale === "fi" ? finnishIssueLabels : issueLabels;
  return labels[issue] ?? issue.replaceAll("_", " ").toLowerCase();
}
