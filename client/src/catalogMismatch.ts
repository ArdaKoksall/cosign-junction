import type { Locale } from "./i18n";
import { formatQuantity } from "./quantity";
import { allergenLabel, productRequirementLabel } from "./productRequirements";
import type { CatalogMismatch, CatalogPackConversion, CatalogProduct } from "./types";

const dimensionNames = {
  en: { ml: "volume", g: "weight", each: "pieces", unmapped: "no catalog volume or weight" },
  fi: { ml: "tilavuus", g: "paino", each: "kappalemäärä", unmapped: "ei tilavuutta tai painoa luettelossa" },
} satisfies Record<Locale, Record<CatalogProduct["amountDimension"], string>>;

const requirementRisks: Record<Locale, Partial<Record<string, string>>> = {
  en: {
    "lactose-free": "Health risk for people with lactose intolerance.",
    "gluten-free": "Health risk for people with coeliac disease or gluten intolerance.",
  },
  fi: {
    "lactose-free": "Terveysriski laktoosi-intoleranssista kärsiville.",
    "gluten-free": "Terveysriski keliaakikoille ja gluteeniyliherkille.",
  },
};

function measure(amount: number, unit: "ml" | "g", locale: Locale) {
  return amount >= 1000
    ? formatQuantity(amount / 1000, unit === "ml" ? "L" : "kg", locale)
    : formatQuantity(amount, unit, locale);
}

/** Plain-language reason a closest match falls short, with a health warning where one applies. */
export function describeMismatch(mismatch: CatalogMismatch, locale: Locale = "en"): { text: string; risk?: string } {
  const fi = locale === "fi";
  switch (mismatch.kind) {
    case "query_word":
      return { text: fi ? `Tuotteen nimi ei vastaa hakusanaa ”${mismatch.word}”` : `Name doesn't match “${mismatch.word}”` };
    case "requirement": {
      const label = productRequirementLabel(mismatch.requirement, locale);
      return {
        text: mismatch.status === "not_met"
          ? fi ? `Tuote ei toimittajan ilmoituksen mukaan täytä vaatimusta ”${label}”`
            : `Doesn't meet “${label}”: the supplier's declaration rules it out`
          : fi ? `Toimittaja ei ilmoita merkintää ”${label}”, joten sitä ei voi vahvistaa`
            : `“${label}” isn't declared by the supplier, so it can't be confirmed`,
        risk: mismatch.healthRisk
          ? requirementRisks[locale][mismatch.requirement] ?? (fi ? "Mahdollinen terveysriski." : "Possible health risk.")
          : undefined,
      };
    }
    case "allergen": {
      const name = allergenLabel(mismatch.allergen, locale).toLowerCase();
      if (fi) {
        const text = mismatch.status === "present" ? `Sisältää allergeenin ${name}`
          : mismatch.status === "may_contain" ? `Saattaa sisältää pieniä määriä allergeenia ${name}`
            : `Toimittaja ei ole vahvistanut allergeenin ${name} puuttumista`;
        return { text, risk: `Mahdollinen terveysriski allergeenille ${name} herkistyneille.` };
      }
      const text = mismatch.status === "present" ? `Contains ${name}`
        : mismatch.status === "may_contain" ? `May contain traces of ${name}`
          : `Not declared free from ${name}, so it can't be confirmed safe`;
      return { text, risk: `Health risk for people allergic to ${name}.` };
    }
    case "pack_measure": {
      const actual = dimensionNames[locale][mismatch.actual];
      const requested = dimensionNames[locale][mismatch.requested];
      const text = fi ? `Tuotteen mitta: ${actual}. Pyydetty: ${requested}` : `Measured by ${actual}, not ${requested}`;
      if (!mismatch.approximate) return { text: fi ? `${text}. Yksiköitä ei voi muuntaa.` : `${text}, so it can't be converted` };
      const original = mismatch.approximate.unit === "ml" ? "g" : "ml";
      const from = measure(mismatch.approximate.amount, original, locale);
      const to = measure(mismatch.approximate.amount, mismatch.approximate.unit, locale);
      return { text: fi ? `${text}. ${from} ≈ ${to} (oletus 1 kg ≈ 1 l)` : `${text}: ${from} is about ${to} (assuming 1 kg ≈ 1 L)` };
    }
  }
}

/** "Your 10 kg = 10 × 1 kg packs", flagged when volume and weight were interchanged. */
export function describeConversion({ requested, packAmount, packUnit, packs, approximate }: CatalogPackConversion, locale: Locale = "en") {
  const fi = locale === "fi";
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 3 });
  const asked = `${number.format(requested.amount)} ${fi && requested.unit === "L" ? "l" : requested.unit}`;
  const packCount = number.format(packs);
  const size = measure(packAmount, packUnit, locale);
  const calculation = `${asked} ${approximate ? "≈" : "="} ${packCount} × ${size}`;
  return fi
    ? `Pyydetty ${calculation}${approximate ? " (arvio, oletus 1 kg ≈ 1 l)" : ""}`
    : `Your ${calculation} ${packs === 1 ? "pack" : "packs"}${approximate ? " (approx., assuming 1 kg ≈ 1 L)" : ""}`;
}
