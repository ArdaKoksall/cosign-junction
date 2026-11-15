import { useI18n, type Locale, type Translate } from "../i18n";
import { useEffect, useState } from "react";
import { ArrowRight, CircleAlert } from "lucide-react";
import { getCatalogProductEvidence } from "../api";
import { formatProductRequirements } from "../productRequirements";
import type { CatalogClassification, CatalogIngredient, CatalogNutrient, CatalogPackDimension, CatalogProductEvidence } from "../types";
import { Button } from "./ui";

// AllergenTypeCode in the GS1 GDSN trade item and food information guides.
const allergenNames = (t: Translate): Record<string, string> => ({
  AC: t("Crustaceans", "Äyriäiset"), AE: t("Eggs", "Kananmunat"), AF: t("Fish", "Kala"), AM: t("Milk", "Maito"), AN: t("Tree nuts", "Pähkinät"), AP: t("Peanuts", "Maapähkinät"),
  AS: t("Sesame", "Seesami"), AU: t("Sulphur dioxide and sulphites", "Rikkidioksidi ja sulfiitit"), AW: t("Gluten-containing cereals", "Gluteenia sisältävät viljat"),
  AY: t("Soybeans", "Soija"), BC: t("Celery", "Selleri"), BM: t("Mustard", "Sinappi"), GB: t("Barley", "Ohra"), GK: t("Kamut", "Kamutvehnä"), GO: t("Oats", "Kaura"),
  GS: t("Spelt", "Speltti"), ML: t("Lactose", "Laktoosi"), NL: t("Lupin", "Lupiini"), NR: t("Rye", "Ruis"), SA: t("Almonds", "Mantelit"), SC: t("Cashews", "Cashewpähkinät"),
  SH: t("Hazelnuts", "Hasselpähkinät"), SM: t("Macadamia nuts", "Macadamiapähkinät"), SP: t("Pecans", "Pekaanipähkinät"), SR: t("Brazil nuts", "Parapähkinät"), ST: t("Pistachios", "Pistaasipähkinät"),
  SW: t("Walnuts", "Saksanpähkinät"), UM: t("Molluscs", "Nilviäiset"), UW: t("Wheat", "Vehnä"),
});

const allergenStates = (t: Translate) => ([
  ["DECLARED_PRESENT", t("Contains", "Sisältää")],
  ["MAY_CONTAIN", t("May contain", "Saattaa sisältää")],
  ["VERIFIED_ABSENT", t("Declared free from", "Ilmoituksen mukaan ei sisällä")],
  ["UNKNOWN", t("Undeclared status", "Ei merkintää")],
  ["CONFLICTING", t("Conflicting declarations", "Ristiriitaisia merkintöjä")],
] as const);

function evidenceFormat(locale: Locale) {
  return {
    number: new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }),
    nutritionNumber: new Intl.NumberFormat(locale, { maximumSignificantDigits: 15 }),
    percent: new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 }),
    regions: new Intl.DisplayNames([locale], { type: "region" }),
  };
}

const evidenceFormats = { en: evidenceFormat("en"), fi: evidenceFormat("fi") };

const nutrientNames = (t: Translate) => (new Map(Object.entries({
  "ENER-KJO": t("Energy", "Energia"), "ENER-E14": t("Energy", "Energia"), FAT: t("Fat", "Rasva"), FASAT: t("Saturated fat", "Tyydyttynyt rasva"), CHOAVL: t("Carbohydrates", "Hiilihydraatit"), "SUGAR-": t("Sugars", "Sokerit"),
  FIBTG: t("Fibre", "Ravintokuitu"), "PRO-": t("Protein", "Proteiini"), SALTEQ: t("Salt", "Suola"), LACS: t("Lactose", "Laktoosi"), NA: t("Sodium", "Natrium"), CA: t("Calcium", "Kalsium"), FE: t("Iron", "Rauta"),
  K: t("Potassium", "Kalium"), MG: t("Magnesium", "Magnesium"), ZN: t("Zinc", "Sinkki"), ID: t("Iodine", "Jodi"), RIBF: t("Riboflavin (B2)", "Riboflaviini (B2)"), "VITA-": t("Vitamin A", "A-vitamiini"),
  "VITB6-": t("Vitamin B6", "B6-vitamiini"), VITB12: t("Vitamin B12", "B12-vitamiini"), "VITC-": t("Vitamin C", "C-vitamiini"), VITC: t("Vitamin C", "C-vitamiini"), "VITD-": t("Vitamin D", "D-vitamiini"),
  VITD: t("Vitamin D", "D-vitamiini"), "VITE-": t("Vitamin E", "E-vitamiini"), VITE: t("Vitamin E", "E-vitamiini"), VITK: t("Vitamin K", "K-vitamiini"), FOL: t("Folate", "Folaatti"), THIA: t("Thiamin (B1)", "Tiamiini (B1)"),
})));
const nutritionUnits = new Map(Object.entries({ GRM: "g", KGM: "kg", MGM: "mg", MC: "µg", MLT: "mL", LTR: "L", E14: "kcal", KJO: "kJ", GL: "g/L" }));
const precisionPrefixes = (t: Translate) => (new Map(Object.entries({ APPROXIMATELY: t("About ", "Noin "), ABOUT: t("About ", "Noin "), LESS_THAN: "< ", LESS_THAN_OR_EQUAL: "≤ " })));

function classificationLabel(id: string) {
  const words = id.replaceAll("_", " ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function packDimension({ amount, unit }: CatalogPackDimension, locale: Locale) {
  const { number } = evidenceFormats[locale];
  if (unit === "case") return `${number.format(amount)} ${locale === "fi" ? "ltk" : amount === 1 ? "case" : "cases"}`;
  if (unit === "each") return `${number.format(amount)} ${locale === "fi" ? "kpl" : amount === 1 ? "piece" : "pieces"}`;
  if (unit === "ml" && amount >= 1000) return `${number.format(amount / 1000)} L`;
  if (unit === "g" && amount >= 1000) return `${number.format(amount / 1000)} kg`;
  return `${number.format(amount)} ${unit === "ml" ? "mL" : unit}`;
}

function allergenGroups(allergens: CatalogClassification[], conflicts: string[], t: Translate) {
  const statesByCode = new Map<string, Set<string>>();
  const names = allergenNames(t);
  for (const allergen of allergens) {
    const states = statesByCode.get(allergen.id) ?? new Set();
    states.add(allergen.status);
    statesByCode.set(allergen.id, states);
  }
  return allergenStates(t).flatMap(([state, label]) => {
    const items = [...statesByCode].flatMap(([code, states]) => {
      const matches = states.size > 1 || conflicts.includes(code) ? state === "CONFLICTING" : states.has(state);
      return matches ? [names[code] ?? t(`Code ${code}`, `Koodi ${code}`)] : [];
    });
    return items.length ? [{ label, items }] : [];
  });
}

function localizedText(values: CatalogProductEvidence["product"]["ingredients"], locale: Locale) {
  const fallback = locale === "en" ? "fi" : "en";
  return values.find(({ language }) => language?.toLowerCase().split("-")[0] === locale)
    ?? values.find(({ language }) => language?.toLowerCase().split("-")[0] === fallback)
    ?? values[0];
}

function storageRange({ min, max }: CatalogProductEvidence["product"]["storageTemperatureCelsius"], locale: Locale, t: Translate) {
  const { number } = evidenceFormats[locale];
  if (min !== null && max !== null) {
    return min === max ? `${number.format(min)} °C` : t(`${number.format(min)} to ${number.format(max)} °C`, `${number.format(min)}–${number.format(max)} °C`);
  }
  if (min !== null) return t(`At least ${number.format(min)} °C`, `Vähintään ${number.format(min)} °C`);
  if (max !== null) return t(`At most ${number.format(max)} °C`, `Enintään ${number.format(max)} °C`);
  return null;
}

function nutritionQuantity(value: number, unit: string, locale: Locale) {
  let label = nutritionUnits.get(unit) ?? unit;
  if (unit === "PTN") label = locale === "fi" ? value === 1 ? "annos" : "annosta" : value === 1 ? "portion" : "portions";
  if (unit === "H87") label = locale === "fi" ? "kpl" : value === 1 ? "piece" : "pieces";
  return `${evidenceFormats[locale].nutritionNumber.format(value)} ${label}`;
}

function NutritionDeclaration({ nutrients }: { nutrients: CatalogNutrient[] }) {
  const { t, locale } = useI18n();
  const { nutritionNumber } = evidenceFormats[locale];
  const names = nutrientNames(t);
  const prefixes = precisionPrefixes(t);
  const bases = new Map<string, CatalogNutrient[]>();
  for (const row of nutrients) {
    const basis = nutritionQuantity(row.basisQuantity, row.basisQuantityUnit, locale);
    const values = bases.get(basis) ?? [];
    values.push(row);
    bases.set(basis, values);
  }
  return (
    <details className="catalog-evidence-text">
      <summary>{t("Nutrition declaration", "Ravintoarvot")}</summary>
      {bases.size === 0 && <p>{t("No nutrition values supplied for this product.", "Tuotteelle ei ole ilmoitettu ravintoarvoja.")}</p>}
      {[...bases].map(([basis, values]) => {
        const hasServing = values.some(({ servingSize }) => servingSize !== undefined);
        const hasDailyIntake = values.some(({ dailyValueIntakePercent }) => dailyValueIntakePercent !== undefined);
        return (
          <table className="catalog-nutrition-table" key={basis}>
            <caption>{t("Per ", "Määrä ")}{basis}</caption>
            <thead><tr>
              <th scope="col">{t("Nutrient", "Ravintoaine")}</th><th scope="col">{t("Amount", "Määrä")}</th>
              {hasServing && <th scope="col">{t("Serving size", "Annoskoko")}</th>}
              {hasDailyIntake && <th scope="col">{t("Daily intake", "Päivittäinen saanti")}</th>}
            </tr></thead>
            <tbody>
              {values.map(({ id, value, unit, unitPrecision, servingSize, servingSizeUnit, dailyValueIntakePercent }, index) => (<tr key={`${id}-${unit}-${index}`}>
                <th scope="row">{names.get(id) ?? id}</th>
                <td>{unitPrecision && (prefixes.get(unitPrecision) ?? `${classificationLabel(unitPrecision)} `)}{nutritionQuantity(value, unit, locale)}</td>
                {hasServing && <td>{servingSize !== undefined && servingSizeUnit ? nutritionQuantity(servingSize, servingSizeUnit, locale) : "—"}</td>}
                {hasDailyIntake && <td>{dailyValueIntakePercent !== undefined ? `${nutritionNumber.format(dailyValueIntakePercent)}%` : "—"}</td>}
              </tr>))}
            </tbody>
          </table>
        );
      })}
    </details>
  );
}

function ingredientCountry(code: string, locale: Locale, t: Translate) {
  if (code === "NON_EU") return t("Non-EU", "EU:n ulkopuolinen alue");
  if (!/^\d{3}$/u.test(code)) return t(`Code ${code}`, `Koodi ${code}`);
  const region = new Intl.Locale(`und-${code}`).region;
  return region && /^[A-Z]{2}$/u.test(region) ? evidenceFormats[locale].regions.of(region) : t(`Code ${code}`, `Koodi ${code}`);
}

function StructuredIngredients({ ingredients }: { ingredients: CatalogIngredient[] }) {
  const { t, locale } = useI18n();
  const { nutritionNumber } = evidenceFormats[locale];
  return (
    <details className="catalog-evidence-text">
      <summary>{t("Structured ingredients and origins", "Ainesosat ja niiden alkuperä")}</summary>
      <p>{t("Manufacturer records may cover selected ingredients.", "Valmistajan tiedot voivat kattaa vain osan ainesosista.")}</p>
      <ol className="catalog-structured-ingredients">
        {ingredients.map(({ sequence, names, origins, percentage }, index) => {
          const name = localizedText(names, locale);
          return (
            <li key={`${sequence}-${index}`} value={sequence}>
              <strong lang={name?.language}>{name?.value ?? t("Ingredient name unavailable", "Ainesosan nimeä ei ole ilmoitettu")}</strong>
              {percentage !== undefined && <span> · {nutritionNumber.format(percentage)}%</span>}
              {origins.length > 0 && <p>{origins.map(({ country, type }) => `${classificationLabel(type)}: ${ingredientCountry(country, locale, t)}`).join(" · ")}</p>}
            </li>
          );
        })}
      </ol>
    </details>
  );
}

type AlternativeActions = {
  onViewProduct: (id: string) => void;
  onCheckSku: (id: string) => void;
};

export function CatalogEvidenceDetails({ data, onViewProduct, onCheckSku }: AlternativeActions & { data: CatalogProductEvidence }) {
  const { t, locale } = useI18n();
  const { number, percent, regions } = evidenceFormats[locale];
  const { product, alternatives, signals, source } = data;
  const groups = allergenGroups(product.allergens, product.allergenConflicts, t);
  const claims = [...new Set(product.claims.filter(({ status }) => status !== "UNKNOWN").map(({ id }) => classificationLabel(id)))];
  const labels = [...new Set(product.labels.map(({ id }) => classificationLabel(id)))];
  const temperature = storageRange(product.storageTemperatureCelsius, locale, t);
  const country = product.countryOfOrigin;
  const origin = country && /^[a-z]{2}$/i.test(country) ? regions.of(country.toUpperCase()) : country;
  const manufacturerText = [
    { label: t("Ingredient statement or main ingredients", "Ainesosaluettelo tai pääainesosat"), text: localizedText(product.ingredients, locale) },
    { label: t("Storage", "Säilytys"), text: localizedText(product.storageInstructions, locale) },
    { label: t("Preparation", "Valmistus"), text: localizedText(product.preparationInstructions, locale) },
    { label: t("Usage", "Käyttö"), text: localizedText(product.usageInstructions, locale) },
  ].filter(({ text }) => text);
  const reliability = signals?.reliability.present ? signals.reliability.value : undefined;
  const carbon = signals?.carbonKgCo2ePerKg.present ? signals.carbonKgCo2ePerKg.value : undefined;

  return (
    <div className="catalog-evidence">
      <div className="catalog-evidence-grid">
        <section aria-label={t("Pack and origin", "Pakkaus ja alkuperä")}>
          <h3>{t("Pack and origin", "Pakkaus ja alkuperä")}</h3>
          <dl>
            <div><dt>{t("Sales unit", "Myyntiyksikkö")}</dt><dd>{product.salesUnit}</dd></div>
            <div>
              <dt>{t("Amount per sales unit", "Määrä myyntiyksikköä kohden")}</dt>
              <dd>{product.packDimensions.length ? product.packDimensions.map((pack, index) => (
                  <span key={`${pack.unit}-${pack.source}`}>
                  {index > 0 && " · "}{packDimension(pack, locale)}
                  {pack.source !== "Challenge catalog" && <small> ({pack.source})</small>}
                </span>
              )) : t("Unverified", "Vahvistamaton")}</dd>
            </div>
            {product.allowedLotSize > 0 && <div><dt>{t("Catalog order lot", "Tilauserä tuoteluettelossa")}</dt><dd>{number.format(product.allowedLotSize)} {product.allowedLotSize === 1 ? t("sales unit", "myyntiyksikkö") : t("sales units", "myyntiyksikköä")}</dd></div>}
            {product.salesUnitGtin && <div><dt>{t("Sales-unit GTIN", "Myyntiyksikön GTIN")}</dt><dd>{product.salesUnitGtin}</dd></div>}
            {product.brand && <div><dt>{t("Brand", "Tuotemerkki")}</dt><dd>{product.brand}</dd></div>}
            {origin && <div><dt>{t("Country of origin", "Alkuperämaa")}</dt><dd>{origin}</dd></div>}
            {temperature && <div><dt>{t("Storage temperature", "Säilytyslämpötila")}</dt><dd>{temperature}</dd></div>}
            {product.variableWeight === true && <div><dt>{t("Weight", "Paino")}</dt><dd>{t("Sold by variable weight", "Myydään vaihtuvapainoisena")}</dd></div>}
            {product.deposits.length > 0 && <div>
              <dt>{t("Packaging deposit", "Pakkauspantti")}</dt>
              <dd>{product.deposits.map(({ material, quantity, unit }) => t(`${number.format(quantity)} ${unit} of material ${material}`, `${number.format(quantity)} ${unit} materiaalia (${material})`)).join(" · ")}{t(" per sales unit. Deposit charges are unavailable.", " myyntiyksikköä kohden. Pantin määrää ei ole ilmoitettu.")}</dd>
            </div>}
          </dl>
        </section>
        <section aria-label={t("Allergens and claims", "Allergeenit ja väitteet")}>
          <h3>{t("Allergens and claims", "Allergeenit ja väitteet")}</h3>
          {groups.length ? (
            <dl>
              {groups.map(({ label, items }) => <div key={label}><dt>{label}</dt><dd>{items.join(", ")}</dd></div>)}
            </dl>
          ) : <p>{t("No allergen declarations supplied.", "Allergeenimerkintöjä ei ole ilmoitettu.")}</p>}
          {product.allergenConflicts.length > 0 && <p className="catalog-evidence-warning">{t("Conflicting allergen evidence. Verify with the supplier.", "Allergeenitiedot ovat ristiriitaisia. Varmista tiedot toimittajalta.")}</p>}
          <p>{t("Unlisted allergens remain unknown. Confirm requirements against the current package before substituting.", "Luettelosta puuttuvien allergeenien tilasta ei ole tietoa. Tarkista merkinnät tuotepakkauksesta ennen korvaamista.")}</p>
          {claims.length > 0 && <p><strong>{t("Diet and nutrition claims", "Ruokavalio- ja ravitsemusväitteet")}</strong> {claims.join(" · ")}</p>}
          {labels.length > 0 && <p><strong>{t("Package labels", "Pakkausmerkinnät")}</strong> {labels.join(" · ")}</p>}
        </section>
      </div>

      {(reliability != null || carbon != null) && (
        <section className="catalog-evidence-signals" aria-label={t("Historical supplier data", "Aiemmat toimittajatiedot")}>
          <h3>{t("Historical supplier data", "Aiemmat toimittajatiedot")}</h3>
          <dl>
            <div><dt>{t("Delivery reliability score", "Toimitusvarmuuden arvosana")}</dt><dd>{reliability == null ? t("Unavailable", "Ei saatavilla") : percent.format(reliability)}</dd></div>
            <div><dt>{t("Product group carbon estimate", "Tuoteryhmän arvioitu hiilijalanjälki")}</dt><dd>{carbon == null ? t("Unavailable", "Ei saatavilla") : `${number.format(carbon)} kg CO₂e/kg`}</dd></div>
          </dl>
        </section>
      )}

      {manufacturerText.length > 0 && (
        <details className="catalog-evidence-text">
          <summary>{t("Ingredient statement and handling", "Ainesosaluettelo ja käsittely")}</summary>
          <dl>
            {manufacturerText.map(({ label, text }) => text && (
              <div key={label}><dt>{label}</dt><dd lang={text.language}>{text.value}</dd></div>
            ))}
          </dl>
          {product.manufacturerUpdatedAt && <p>{t("Manufacturer data updated ", "Valmistajan tiedot päivitetty ")}<time dateTime={product.manufacturerUpdatedAt}>{product.manufacturerUpdatedAt.slice(0, 10)}</time></p>}
        </details>
      )}
      {product.structuredIngredients?.length > 0 && <StructuredIngredients ingredients={product.structuredIngredients} />}
      <NutritionDeclaration nutrients={product.nutritionalContent ?? []} />

      <section className="catalog-alternatives" aria-label={t("Catalog-listed substitutes", "Tuoteluettelossa ilmoitetut korvaavat tuotteet")}>
        <h3>{t("Catalog-listed substitutes", "Tuoteluettelossa ilmoitetut korvaavat tuotteet")}</h3>
        {alternatives.length ? (
          <>
            <p>{t("Confirm suitability, price and availability for each suggested product.", "Varmista kunkin ehdotetun tuotteen soveltuvuus, hinta ja saatavuus.")}</p>
            <ul>
              {alternatives.map(({ candidateProductId, product: candidate }) => (
                <li key={candidateProductId}>
                  <div>
                    <strong>{candidate?.name ?? t(`SKU ${candidateProductId}`, `Tuotenumero ${candidateProductId}`)}</strong>
                    <p>{candidate ? t(`SKU ${candidateProductId}`, `Tuotenumero ${candidateProductId}`) : t("Product details are missing from this catalog.", "Tuotetiedot puuttuvat tästä tuoteluettelosta.")}
                      {candidate && candidate.packDimensions.length > 0 && <> · {candidate.packDimensions.map((pack) => packDimension(pack, locale)).join(" · ")} {t("per sales unit", "myyntiyksikköä kohden")}</>}</p>
                    {candidate?.requirements?.length ? <p>{t("Declared: ", "Merkinnät: ")}{formatProductRequirements(candidate.requirements, locale)}</p>
                      : candidate?.verifiedLactoseFree && <p>{t("Catalog lactose-free claim", "Tuoteluettelon laktoosittomuusmerkintä")}</p>}
                    {candidate?.variableWeight === true && <p>{t("Sold by variable weight", "Myydään vaihtuvapainoisena")}</p>}
                    {candidate && candidate.allergenConflicts.length > 0 && <p className="catalog-evidence-warning">{t("Conflicting allergen evidence. Verify with the supplier.", "Allergeenitiedot ovat ristiriitaisia. Varmista tiedot toimittajalta.")}</p>}
                  </div>
                  {candidate && <div className="catalog-product-actions">
                    <Button variant="tertiary" onClick={() => onCheckSku(candidate.id)} ariaLabel={t(`Check price and stock for ${candidate.name}`, `Tarkista tuotteen ${candidate.name} hinta ja varastosaldo`)}>{t("Check price and stock", "Tarkista hinta ja varastosaldo")}</Button>
                    <Button variant="secondary" onClick={() => onViewProduct(candidate.id)} ariaLabel={t(`View ${candidate.name}`, `Näytä ${candidate.name}`)}>{t("View product ", "Näytä tuote ")}<ArrowRight size={15} aria-hidden="true" /></Button>
                  </div>}
                </li>
              ))}
            </ul>
          </>
        ) : <p>{t("No substitute links supplied for this product.", "Tuotteelle ei ole ilmoitettu korvaavia tuotteita.")}</p>}
      </section>
      <p className="catalog-evidence-source">{t("Catalog source · ", "Tuoteluettelon lähde · ")}{source.label}</p>
    </div>
  );
}

export function CatalogEvidence({ id, onViewProduct, onCheckSku }: AlternativeActions & { id: string }) {
  const { t } = useI18n();
  const [retry, setRetry] = useState(0);
  const [data, setData] = useState<CatalogProductEvidence | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void getCatalogProductEvidence(id, controller.signal).then((details) => {
      if (!controller.signal.aborted) setData(details);
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : t("Product details could not be loaded.", "Tuotetietoja ei voitu ladata."));
      }
    });
    return () => controller.abort();
  }, [id, retry]);

  if (error) return (
    <div className="catalog-evidence-alert" role="alert">
      <CircleAlert size={17} aria-hidden="true" />
      <p>{error}</p>
      <Button variant="secondary" onClick={() => { setError(""); setRetry(retry + 1); }}>{t("Retry product details", "Lataa tuotetiedot uudelleen")}</Button>
    </div>
  );
  if (!data) return <p className="catalog-evidence-status" role="status">{t("Loading catalog evidence…", "Ladataan tuotetietoja…")}</p>;
  return <CatalogEvidenceDetails data={data} onViewProduct={onViewProduct} onCheckSku={onCheckSku} />;
}
