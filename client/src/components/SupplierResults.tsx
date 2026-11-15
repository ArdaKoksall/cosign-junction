import { useI18n, type Locale, type Translate } from "../i18n";
import { useId, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowDownWideNarrow, ArrowUpRight, ChevronDown, CircleAlert, CircleCheck, ClipboardList, Columns2, Leaf, Plus, Truck, X } from "lucide-react";
import { formatEuro } from "../api";
import { describeMismatch } from "../catalogMismatch";
import { Button } from "./ui";
import { choiceFromClosest, choiceFromRunnerUp, describeChoice, describeUnresolved, type OptionChoice } from "../optionChoice";
import { formatAllergenRequirements, formatProductRequirements } from "../productRequirements";
import { formatQuantity } from "../quantity";
import { rankingLabel } from "../ranking";
import { supplierIssueLabel } from "../supplierIssues";
import type { CompareResponse, ProductRequirement, SupplierObservation } from "../types";
import "../screens/purchasing-evidence.css";

const decisionTitles = (t: Translate) => ({
  no_match: t("No eligible catalog match", "Tuoteluettelossa ei ole sopivaa tuotetta"),
  blocked: t("No product meets the full request", "Yksikään tuote ei täytä kaikkia vaatimuksia"),
  needs_confirmation: t("Supplier confirmation needed", "Tarvitaan toimittajan vahvistus"),
  evidence_complete: t("One or more products pass the available checks", "Vähintään yksi tuote läpäisee käytettävissä olevat tarkistukset"),
});

const percent = {
  en: new Intl.NumberFormat("en-GB", { style: "percent", maximumFractionDigits: 1 }),
  fi: new Intl.NumberFormat("fi-FI", { style: "percent", maximumFractionDigits: 1 }),
};
const decimal = {
  en: new Intl.NumberFormat("en-GB", { maximumSignificantDigits: 4 }),
  fi: new Intl.NumberFormat("fi-FI", { maximumSignificantDigits: 4 }),
};
const helsinkiTime = {
  en: new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Helsinki" }),
  fi: new Intl.DateTimeFormat("fi-FI", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Helsinki" }),
};
const rankingMetrics = (t: Translate) => ({
  cost: t("usable price estimate", "käyttökelpoinen hinta-arvio"),
  reliability: t("historical reliability value", "aiempi toimitusvarmuusarvo"),
  carbon: t("product group carbon estimate", "tuoteryhmän hiilijalanjälkiarvio"),
});

function cutoffLabel(value: string | null, t: Translate, locale: Locale) {
  const date = value ? new Date(value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2")) : undefined;
  return date && Number.isFinite(date.getTime()) ? helsinkiTime[locale].format(date) : t("Unknown", "Ei tiedossa");
}

function estimateLabel(issues: string[], t: Translate, includeTaxBasis = false) {
  const label = issues.includes("DEPOSIT_CHARGES_UNVERIFIED") ? t("Product subtotal", "Tuotteiden välisumma")
    : issues.includes("VARIABLE_WEIGHT") ? t("Estimated product cost", "Tuotteen hinta-arvio") : t("Estimated total", "Arvioitu kokonaishinta");
  return includeTaxBasis ? t(`${label}, ex VAT`, `${label}, alv 0 %`) : label;
}

type PartialCandidate = { product: SupplierObservation; coverage: NonNullable<SupplierObservation["observedCoverage"]> };

/** Confirms what choosing a runner-up changes in the request, then compares it or opens the form. */
function ChooseOption({ choice, busy, onChoose }: {
  choice: OptionChoice; busy?: boolean; onChoose: (choice: OptionChoice, compareNow: boolean) => void;
}) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const titleId = useId();
  const needsAcknowledgement = choice.healthRisks.length > 0;
  const blocked = busy || (needsAcknowledgement && !accepted);
  const unresolved = describeUnresolved(choice, locale);
  if (!open) {
    return (
      <div className="decision-choose">
        <Button variant="secondary" disabled={busy} ariaLabel={t(`Choose ${choice.name}, SKU ${choice.productId}`, `Valitse ${choice.name}, tuotenumero ${choice.productId}`)} onClick={() => setOpen(true)}>
          {t("Choose this option ", "Valitse tämä vaihtoehto ")}
        </Button>
      </div>
    );
  }
  return (
    <div className="decision-choose decision-choose--open" role="group" aria-labelledby={titleId}>
      <strong id={titleId}>{t("Choosing this changes your request:", "Valinta muuttaa pyyntöäsi:")}</strong>
      <ul>{describeChoice(choice, locale).map((change) => <li key={change}>{change}</li>)}</ul>
      {unresolved.length > 0 && (
        <div className="decision-choose-warning">
          <strong>{t("Still not fully qualified after this:", "Seuraavat vaatimukset jäävät täyttymättä:")}</strong>
          <ul>{unresolved.map((item) => <li key={item}>{item}</li>)}</ul>
        </div>
      )}
      {needsAcknowledgement && (
        <label className="decision-choose-ack">
          <input type="checkbox" checked={accepted} onChange={({ target }) => setAccepted(target.checked)} />
          <span>{t("I understand this product isn't declared ", "Ymmärrän, ettei tuotteella ole seuraavaa merkintää: ")}{choice.healthRisks.map((risk) => risk.toLowerCase()).join(t(" or ", " tai "))}{t(", so it may not be safe for people who need that.", ". Tuote ei välttämättä sovi kaikille ruokailijoille.")}</span>
        </label>
      )}
      <div className="decision-choose-actions">
        <Button disabled={blocked} onClick={() => onChoose(choice, true)}>{t("Use this and compare", "Käytä tätä ja vertaile")}</Button>
        <Button variant="secondary" disabled={blocked} onClick={() => onChoose(choice, false)}>{t("Edit request first", "Muokkaa ensin pyyntöä")}</Button>
        <Button variant="tertiary" disabled={busy} onClick={() => { setOpen(false); setAccepted(false); }}>{t("Cancel", "Peruuta")}</Button>
      </div>
    </div>
  );
}

export function SupplierDecision({ decision, exactProductId, requirements = [], freeFromAllergen = [], bestPartial, closestProducts = [], budgetCents,
  observations = [], deadlineDate = "", busy, onChoose }: {
  decision: NonNullable<CompareResponse["decision"]>; exactProductId?: string; requirements?: ProductRequirement[];
  freeFromAllergen?: string[]; bestPartial?: PartialCandidate; closestProducts?: NonNullable<CompareResponse["closestProducts"]>;
  budgetCents?: number; observations?: SupplierObservation[]; deadlineDate?: string; busy?: boolean;
  onChoose?: (choice: OptionChoice, compareNow: boolean) => void;
}) {
  const { t, locale } = useI18n();
  const { ranking, bestWithinBudget } = decision;
  const preferred = ranking?.status === "ranked" ? ranking.preferred : undefined;
  const runnersUp = decision.outcome === "blocked" ? decision.runnersUp ?? [] : [];
  const nearestCatalog = decision.outcome === "no_match" ? closestProducts : [];
  // A ranked list of runner-ups replaces the single product card.
  const product = runnersUp.length ? undefined : preferred ?? bestWithinBudget;
  const lowerPriced = preferred?.totalCents != null && bestWithinBudget?.totalCents != null
    && preferred.productId !== bestWithinBudget.productId && bestWithinBudget.blockers.length === 0
    && preferred.totalCents > bestWithinBudget.totalCents
    ? { productId: bestWithinBudget.productId, differenceCents: preferred.totalCents - bestWithinBudget.totalCents } : undefined;
  const rankingMetric = ranking?.objective === "reliability" && preferred?.reliability != null
    ? { value: percent[locale].format(preferred.reliability), label: t("Historical reliability", "Aiempi toimitusvarmuus") }
    : ranking?.objective === "carbon" && preferred?.carbon != null
      ? { value: `${decimal[locale].format(preferred.carbon)} kg CO₂e/kg`, label: t("Product group carbon estimate", "Tuoteryhmän arvioitu hiilijalanjälki") } : undefined;
  const followUp = decision.outcome === "blocked" || decision.outcome === "needs_confirmation";
  const DecisionIcon = followUp ? CircleAlert : decision.outcome === "no_match" ? ClipboardList : CircleCheck;
  const declarations = [
    requirements.length ? formatProductRequirements(requirements, locale) : null,
    freeFromAllergen.length ? t(`free from ${formatAllergenRequirements(freeFromAllergen, locale)}`, `ilman ainetta ${formatAllergenRequirements(freeFromAllergen, locale)}`) : null,
  ].filter(Boolean).join(t(" and ", " ja "));

  return (
    <section className={followUp ? "evidence-panel decision-panel decision-panel--attention" : "evidence-panel decision-panel"} aria-labelledby="supplier-decision-title">
      <div className="evidence-panel-heading">
        <span className="evidence-icon"><DecisionIcon size={19} aria-hidden="true" /></span>
        <div>
          <p className="decision-label">{t("Supplier assessment", "Toimittaja-arvio")}</p>
          <h2 id="supplier-decision-title">{decisionTitles(t)[decision.outcome]}</h2>
          {decision.outcome !== "no_match" && (
            <p>{decision.withinBudgetCount
              ? t(`${decision.withinBudgetCount} ${decision.withinBudgetCount === 1 ? "estimate is" : "estimates are"} within budget for the full quantity. Stock and delivery are assessed separately.`, `${decision.withinBudgetCount} ${decision.withinBudgetCount === 1 ? "arvio pysyy" : "arviota pysyy"} koko määrän budjetissa. Varastosaldo ja toimitus arvioidaan erikseen.`)
              : t("No full-quantity estimate is known to be within budget.", "Yksikään tiedossa oleva koko määrän arvio ei mahdu budjettiin.")}</p>
          )}
          {decision.outcome === "no_match" && <p>{declarations
            ? t(`No ${exactProductId ? "match for this SKU" : "matching product"} had every required catalog declaration (${declarations}). Review the product or edit the request.`, `Yhdelläkään hakusi tuotteella ei ole kaikkia vaadittuja merkintöjä (${declarations}). Tarkista tuote tai muokkaa pyyntöä.`)
            : t("Review the product or search term and try again.", "Tarkista tuote tai hakusana ja yritä uudelleen.")}</p>}
        </div>
      </div>
      {ranking && (
        <div className="decision-priority">
          <strong>{rankingLabel(ranking.objective, locale)}</strong>
          <p>{ranking.status === "ranked"
            ? t(`Compared ${ranking.measuredCount} of ${ranking.candidateCount} candidates with a ${rankingMetrics(t)[ranking.objective]}.`, `Vertailtu ${ranking.measuredCount} / ${ranking.candidateCount} vaihtoehtoa. Vertailuperuste: ${rankingMetrics(t)[ranking.objective]}.`)
            : ranking.candidateCount > 0
              ? t(`No candidate had a ${rankingMetrics(t)[ranking.objective]}.`, `Yhdelläkään vaihtoehdolla ei ole vertailutietoa: ${rankingMetrics(t)[ranking.objective]}.`)
              : t("No candidate qualified for ranking.", "Yksikään vaihtoehto ei soveltunut vertailuun.")}</p>
        </div>
      )}
      {product && (
        <div className="decision-product">
          <div>
            {preferred && <span className="decision-ranked-label">{t("First candidate to check", "Tarkista ensin tämä vaihtoehto")}</span>}
            <strong>{product.name}</strong>
            <span>{t("SKU ", "Tuotenumero ")}{product.productId}</span>
            {rankingMetric && <span className="decision-ranking-metric">{rankingMetric.label} <strong>{rankingMetric.value}</strong></span>}
          </div>
          <div className="decision-estimate"><strong>{product.totalCents == null ? t("Price unknown", "Hinta ei tiedossa") : formatEuro(product.totalCents, locale)}</strong><span>{t("Estimate, ex VAT", "Arvio, alv 0 %")}</span></div>
          {(product.blockers.length > 0 || product.openQuestions.length > 0) && (
            <dl>
              {product.blockers.length > 0 && <div><dt>{t("Blocked", "Estetty")}</dt><dd>{product.blockers.map((issue) => supplierIssueLabel(issue, locale)).join(" · ")}</dd></div>}
              {product.openQuestions.length > 0 && <div><dt>{t("Still unverified", "Vielä vahvistamatta")}</dt><dd>{product.openQuestions.map((issue) => supplierIssueLabel(issue, locale)).join(" · ")}</dd></div>}
            </dl>
          )}
          {lowerPriced && <p className="decision-price-tradeoff">{t("Estimated cost is ", "Arvioitu hinta on ")}{formatEuro(lowerPriced.differenceCents, locale)}{t(" higher than SKU ", " enemmän kuin tuotteella ")}{lowerPriced.productId}.</p>}
        </div>
      )}
      {runnersUp.length > 0 && (
        <div className="decision-runners-up">
          <h3>{t("Best available options", "Parhaat saatavilla olevat vaihtoehdot")}</h3>
          <p>{t("None of these meets the full request. They're ranked by how close they come, with what stops each one.", "Yksikään vaihtoehdoista ei täytä kaikkia vaatimuksia. Näet, miten hyvin kukin vaihtoehto vastaa pyyntöä ja mikä estää sen valinnan.")}</p>
          <ol>
            {runnersUp.map((option, position) => {
              const overBudget = option.blockers.includes("OVER_BUDGET") && option.totalCents != null && budgetCents != null
                ? option.totalCents - budgetCents : null;
              return (
                <li key={option.productId} data-best={position === 0 || undefined}>
                  <div>
                    {position === 0 && <span className="decision-best-badge">{t("Best available option", "Paras saatavilla oleva vaihtoehto")}</span>}
                    <strong>{option.name}</strong>
                    <span>{t("SKU ", "Tuotenumero ")}{option.productId}</span>
                  </div>
                  <div className="decision-estimate"><strong>{option.totalCents == null ? t("Price unknown", "Hinta ei tiedossa") : formatEuro(option.totalCents, locale)}</strong><span>{t("Estimate, ex VAT", "Arvio, alv 0 %")}</span></div>
                  <dl>
                    <div><dt>{t("Why it doesn't fully qualify", "Mitä vaatimuksia tuote ei täytä")}</dt><dd>{option.blockers.map((blocker) => blocker === "OVER_BUDGET" && overBudget != null && overBudget > 0
                      ? t(`${supplierIssueLabel(blocker, locale)} by ${formatEuro(overBudget, locale)}`, `${supplierIssueLabel(blocker, locale)}: ${formatEuro(overBudget, locale)}`) : supplierIssueLabel(blocker, locale)).join(" · ")}</dd></div>
                    {option.openQuestions.length > 0 && <div><dt>{t("Still unverified", "Vielä vahvistamatta")}</dt><dd>{option.openQuestions.map((issue) => supplierIssueLabel(issue, locale)).join(" · ")}</dd></div>}
                  </dl>
                  {onChoose && <ChooseOption busy={busy} onChoose={onChoose} choice={choiceFromRunnerUp(option,
                    observations.find(({ productId }) => productId === option.productId), { budgetCents: budgetCents ?? 0, deadlineDate })} />}
                </li>
              );
            })}
          </ol>
        </div>
      )}
      {nearestCatalog.length > 0 && (
        <div className="decision-runners-up">
          <h3>{t("Closest catalog products", "Lähimmät tuotteet tuoteluettelosta")}</h3>
          <p>{t("None of these has every required declaration, so they weren't priced. Each one lists what's different. Choose one to compare it.", "Kaikista vaihtoehdoista puuttuu vaadittuja merkintöjä, joten niille ei laskettu hintaa. Tarkista erot ja valitse tuote vertailuun.")}</p>
          <ol>
            {nearestCatalog.map((option, position) => (
              <li key={option.productId} data-best={position === 0 || undefined}>
                <div>
                  {position === 0 && <span className="decision-best-badge">{t("Best available option", "Paras saatavilla oleva vaihtoehto")}</span>}
                  <strong>{option.name}</strong>
                  <span>{t("SKU ", "Tuotenumero ")}{option.productId}</span>
                </div>
                <ul className="decision-mismatches" aria-label={t(`How ${option.name} differs from the request`, `Miten ${option.name} poikkeaa pyynnöstä`)}>
                  {option.mismatches.map((mismatch, index) => {
                    const { text, risk } = describeMismatch(mismatch, locale);
                    return <li key={index} data-risk={risk ? "health" : undefined}>{risk ? "⚠ " : ""}{text}{risk && <strong> {risk}</strong>}</li>;
                  })}
                </ul>
                {onChoose && <ChooseOption busy={busy} onChoose={onChoose} choice={choiceFromClosest(option, locale)} />}
              </li>
            ))}
          </ol>
        </div>
      )}
      {bestPartial && <p className="decision-partial">
        <strong>{t("Largest reported partial quantity:", "Suurin ilmoitettu osamäärä:")}</strong> {formatQuantity(bestPartial.coverage.coveredQuantity, bestPartial.coverage.unit, locale)}{t(" from ", " tuotteesta ")}{bestPartial.product.name}. {formatQuantity(bestPartial.coverage.uncoveredQuantity, bestPartial.coverage.unit, locale)} {t(" still needed. ", " puuttuu vielä. ")}
      </p>}
      {decision.outcome === "blocked" && <p className="decision-next">{t("Review the blockers below, check another delivery date, or try a different product.", "Tarkista alla olevat esteet tai kokeile toista toimituspäivää tai tuotetta.")}</p>}
    </section>
  );
}

const budgetFitLabels = (t: Translate) => ({
  within_budget: t("Within budget", "Budjetin sisällä"),
  over_budget: t("Over budget", "Yli budjetin"),
  unknown: t("Budget fit unknown", "Suhde budjettiin ei tiedossa"),
});

const stockFitLabels = (t: Translate) => ({
  reported_sufficient: t("Enough units reported", "Ilmoitettu määrä riittää"),
  reported_insufficient: t("Too few units reported", "Ilmoitettu määrä ei riitä"),
  unverified: t("Stock fit unverified", "Varastosaldon riittävyyttä ei ole vahvistettu"),
});

const resultFilters = (t: Translate) => ([
  { id: "all", label: t("All products", "Kaikki tuotteet"), matches: () => true },
  { id: "budget", label: t("Estimate within budget", "Arvio budjetin sisällä"), matches: (item: SupplierObservation) => item.estimate?.budgetFit === "within_budget" },
  { id: "stock", label: t("Full stock reported", "Koko määrä varastossa"), matches: (item: SupplierObservation) => item.estimate?.stockFit === "reported_sufficient" },
  { id: "partial", label: t("Partial stock reported", "Osa määrästä varastossa"), matches: (item: SupplierObservation) => !!item.observedCoverage && item.observedCoverage.coveredQuantity > 0 && item.observedCoverage.uncoveredQuantity > 0 },
] as const);

function StockCoverage({ coverage, salesUnit }: { coverage: NonNullable<SupplierObservation["observedCoverage"]>; salesUnit: string }) {
  const { t, locale } = useI18n();
  const total = coverage.coveredQuantity + coverage.uncoveredQuantity;
  const ratio = total > 0 ? coverage.coveredQuantity / total : 0;
  return (
    <section className="supplier-coverage" aria-label={t("Reported stock coverage", "Ilmoitetun varastosaldon kattavuus")}>
      <div className="supplier-coverage-heading"><strong>{t("Reported stock coverage", "Ilmoitetun varastosaldon kattavuus")}</strong><span>{percent[locale].format(ratio)}{t(" of request", " pyydetystä määrästä")}</span></div>
      <meter min={0} max={total} value={coverage.coveredQuantity} aria-label={t("Reported stock coverage", "Ilmoitetun varastosaldon kattavuus")} aria-valuetext={t(`${formatQuantity(coverage.coveredQuantity, coverage.unit, locale)} of ${formatQuantity(total, coverage.unit, locale)}`, `${formatQuantity(coverage.coveredQuantity, coverage.unit, locale)} / ${formatQuantity(total, coverage.unit, locale)}`)} />
      <dl className="evidence-metrics">
        <div><dt>{t("Could cover", "Saatavilla arviolta")}</dt><dd>{formatQuantity(coverage.coveredQuantity, coverage.unit, locale)}</dd></div>
        <div><dt>{t("Still needed", "Puuttuu vielä")}</dt><dd>{formatQuantity(coverage.uncoveredQuantity, coverage.unit, locale)}</dd></div>
        <div><dt>{t("Product subtotal, ex VAT", "Tuotteiden välisumma, alv 0 %")}</dt><dd>{coverage.salesUnits === 0 ? "—" : coverage.productSubtotalCents == null ? t("Unknown", "Ei tiedossa") : formatEuro(coverage.productSubtotalCents, locale)}</dd></div>
      </dl>
      <p>{coverage.salesUnits > 0 ? t(`${coverage.salesUnits.toLocaleString(locale)} ${salesUnit} · ${formatQuantity(coverage.quantity, coverage.unit, locale)} after rounding to order increments.`, `${coverage.salesUnits.toLocaleString(locale)} ${salesUnit} · ${formatQuantity(coverage.quantity, coverage.unit, locale)} tilauseriin pyöristettynä.`) : t("No orderable quantity from the reported stock.", "Ilmoitettu varastosaldo ei riitä tilattavaan erään.")}{t(" Delivery time remains unconfirmed.", " Toimitusaikaa ei ole vahvistettu.")}</p>
    </section>
  );
}

function ComparisonTray({ items, onRemove, onClear }: {
  items: SupplierObservation[];
  onRemove: (id: string) => void;
  onClear: () => void;
}) {
  const { t, locale } = useI18n();
  const reducedMotion = useReducedMotion();
  return (
    <motion.section
      className="comparison-tray" aria-labelledby="comparison-tray-title"
      initial={reducedMotion ? false : { opacity: 0, clipPath: "inset(0 0 100% 0 round 10px)" }}
      animate={{ opacity: 1, clipPath: "inset(0 0 0% 0 round 10px)" }}
      transition={{ duration: reducedMotion ? 0 : .33, ease: [.22, 1, .36, 1] }}
    >
      <header className="comparison-tray-heading">
        <div>
          <h3 id="comparison-tray-title"><Columns2 size={18} aria-hidden="true" />{t(" Side-by-side comparison", " Rinnakkaisvertailu")}</h3>
          <p>{items.length === 1 ? t("Pin one more product to compare.", "Kiinnitä toinen tuote vertailuun.") : t("Estimated totals exclude VAT.", "Hinta-arviot eivät sisällä arvonlisäveroa.")}</p>
        </div>
        <button className="text-action" type="button" onClick={onClear}>{t("Clear selection", "Tyhjennä valinta")}</button>
      </header>
      <ul className="comparison-tray-items">
        {items.map((item) => (
          <li key={item.productId}>
            <div className="comparison-tray-product">
              <strong>{item.name}</strong>
              <button type="button" className="comparison-remove" aria-label={t(`Remove ${item.name} from comparison`, `Poista ${item.name} vertailusta`)} onClick={() => onRemove(item.productId)}><X size={16} aria-hidden="true" /></button>
            </div>
            <dl>
              <div><dt>{estimateLabel(item.issues, t)}</dt><dd>{item.estimate?.totalCents == null ? t("Unknown", "Ei tiedossa") : formatEuro(item.estimate.totalCents, locale)}</dd></div>
              <div><dt>{t("Stock fit", "Varastosaldon riittävyys")}</dt><dd>{item.estimate ? stockFitLabels(t)[item.estimate.stockFit] : t("Unverified", "Vahvistamaton")}</dd></div>
              <div><dt>{t("Supplier schedule date", "Toimittajan ilmoittama toimituspäivä")}</dt><dd>{item.availableDate ?? t("Unknown", "Ei tiedossa")}</dd></div>
            </dl>
          </li>
        ))}
      </ul>
    </motion.section>
  );
}

export function SupplierResults({ observations, onInspectProduct }: { observations: SupplierObservation[]; onInspectProduct?: (sku: string) => void }) {
  const { t, locale } = useI18n();
  const filters = resultFilters(t);
  const [filter, setFilter] = useState<typeof filters[number]["id"]>("all");
  const [sort, setSort] = useState("default");
  const [selection, setSelection] = useState<string[]>([]);
  const filterGroup = useRef<HTMLDivElement>(null);
  const pinButtons = useRef(new Map<string, HTMLButtonElement>());
  const reducedMotion = useReducedMotion();
  const selectedProducts = selection.flatMap((id) => observations.find((item) => item.productId === id) ?? []);
  const currentFilter = filters.find(({ id }) => id === filter) ?? filters[0];
  const visible = observations.length < 2 ? [...observations] : observations.filter(currentFilter.matches);

  if (sort === "total") {
    const estimate = (item: SupplierObservation) => item.estimate?.totalCents ?? Infinity;
    visible.sort((first, second) => estimate(first) - estimate(second));
  } else if (sort === "delivery") {
    visible.sort((first, second) => {
      if (!first.availableDate) return Number(Boolean(second.availableDate));
      if (!second.availableDate) return -1;
      return first.availableDate.localeCompare(second.availableDate);
    });
  }

  function toggleProduct(id: string) {
    if (selection.includes(id)) {
      setSelection(selection.filter((selected) => selected !== id));
    } else if (selectedProducts.length < 2) {
      setSelection([...selectedProducts.map((item) => item.productId), id]);
    }
  }

  function focusPin(id: string) {
    const pin = pinButtons.current.get(id);
    (pin ?? filterGroup.current?.querySelector("button"))?.focus({ preventScroll: true });
  }

  if (!observations.length) {
    return <p className="muted">{t("Try another product name or SKU to find matching products.", "Kokeile toista tuotenimeä tai tuotenumeroa.")}</p>;
  }
  return (
    <section className="evidence-offer-list" aria-labelledby="supplier-results-title">
      <div className="evidence-section-heading">
        <h2 id="supplier-results-title">{observations.length} {observations.length === 1 ? t("product checked", "tuote tarkistettu") : t("products checked", "tuotetta tarkistettu")}</h2>
        {observations.some(({ estimate }) => estimate) && (
          <p>{t("Full-quantity estimates use catalog order increments and observed prices. Reported stock is shown separately. Delivery remains unconfirmed.", "Koko määrän arviot perustuvat tuoteluettelon tilauseriin ja havaittuihin hintoihin. Varastosaldo näytetään erikseen. Toimitusta ei ole vahvistettu.")}</p>
        )}
      </div>
      {observations.length > 1 && (
        <div className="comparison-toolbar">
          <div className="comparison-filters" role="group" aria-label={t("Filter products", "Suodata tuotteita")} ref={filterGroup}>
            {filters.map(({ id, label, matches }) => (
              <button type="button" key={id} aria-pressed={filter === id} onClick={() => setFilter(id)}>
                {label} <span>{observations.filter(matches).length}</span>
              </button>
            ))}
          </div>
          <label className="comparison-sort">
            <ArrowDownWideNarrow size={17} aria-hidden="true" />
            <select aria-label={t("Sort products", "Lajittele tuotteet")} value={sort} onChange={({ target }) => setSort(target.value)}>
              <option value="default">{t("Shortlist order", "Suositusjärjestys")}</option>
              <option value="total">{t("Lowest estimate", "Pienin hinta-arvio")}</option>
              <option value="delivery">{t("Earliest schedule date", "Aikaisin toimituspäivä")}</option>
            </select>
          </label>
          <p className="sr-only" role="status">{visible.length}{t(" of ", " / ")}{observations.length}{t(" products shown. ", " tuotetta näkyvissä. ")}{selectedProducts.length}{t(" pinned for comparison.", " kiinnitetty vertailuun.")}</p>
        </div>
      )}
      {selectedProducts.length > 0 && (
        <ComparisonTray items={selectedProducts} onRemove={(id) => { focusPin(id); toggleProduct(id); }} onClear={() => {
          focusPin(selectedProducts[0].productId);
          setSelection([]);
        }} />
      )}
      {visible.length === 0 && (
        <div className="evidence-panel comparison-empty">
          <p>{t("No products match this filter.", "Yksikään tuote ei vastaa suodatinta.")}</p>
          <button className="text-action" type="button" onClick={() => setFilter("all")}>{t("Show all products", "Näytä kaikki tuotteet")}</button>
        </div>
      )}
      <div className="comparison-results">
        <AnimatePresence mode="popLayout">
          {visible.map((item) => {
            const pinned = selection.includes(item.productId);
            const packAmount = item.amountPerSellUnit ?? item.litersPerSellUnit;
            const packUnit = item.amountUnit ?? "L";
            const roundedAmount = item.estimate?.quantity ?? item.estimate?.liters;
            const roundedUnit = item.estimate?.unit ?? "L";
            return (
              <motion.article
                className="evidence-offer supplier-product" data-pinned={pinned} key={item.productId}
                layout={reducedMotion ? undefined : "position"}
                initial={reducedMotion ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={reducedMotion ? undefined : { opacity: 0, transition: { duration: .14 } }}
                transition={{ duration: reducedMotion ? 0 : .3, ease: [.22, 1, .36, 1] }}
              >
                <div className="evidence-offer-heading evidence-offer-heading--supplier">
                  <div>
                    <h3>{item.name}</h3>
                    <p>{t("SKU ", "Tuotenumero ")}{item.productId} · {item.salesUnit} · {packAmount == null ? t("Pack size unknown", "Pakkauskokoa ei ole ilmoitettu") : t(`${formatQuantity(packAmount, packUnit, locale)} per sales unit`, `${formatQuantity(packAmount, packUnit, locale)} myyntiyksikköä kohden`)}</p>
                  </div>
                  <div className="evidence-offer-price">
                    <strong>{item.salesUnitPriceCents == null ? t("Price unknown", "Hinta ei tiedossa") : formatEuro(item.salesUnitPriceCents, locale)}</strong>
                    <small>{t("Per sales unit, ex VAT", "Myyntiyksikköä kohden, alv 0 %")}</small>
                  </div>
                </div>
                <div className="supplier-product-facts">
                  {item.estimate && (
                    <dl className="evidence-metrics evidence-metrics--estimate">
                      <div>
                        <dt>{t("Estimated quantity", "Arvioitu määrä")}</dt>
                        <dd>{item.estimate.salesUnits.toLocaleString(locale)} {item.salesUnit}</dd>
                        {roundedAmount != null && <dd><small>{formatQuantity(roundedAmount, roundedUnit, locale)}{t(" after rounding to order increments", " tilauseriin pyöristettynä")}</small></dd>}
                      </div>
                      <div>
                        <dt>{estimateLabel(item.issues, t, true)}</dt>
                        <dd>{item.estimate.totalCents == null ? t("Unknown", "Ei tiedossa") : formatEuro(item.estimate.totalCents, locale)}</dd>
                        <dd><small>{budgetFitLabels(t)[item.estimate.budgetFit]}</small></dd>
                      </div>
                      <div>
                        <dt>{t("Stock fit", "Varastosaldon riittävyys")}</dt>
                        <dd>{stockFitLabels(t)[item.estimate.stockFit]}</dd>
                      </div>
                    </dl>
                  )}
                  <dl className="evidence-metrics evidence-metrics--availability">
                    <div><dt>{t("Reported stock", "Ilmoitettu varastosaldo")}</dt><dd>{item.stockUnknown || item.availableSellUnits == null ? t("Unverified", "Vahvistamaton") : `${item.availableSellUnits} ${item.salesUnit}`}</dd></div>
                    <div><dt>{t("Supplier schedule date", "Toimittajan ilmoittama toimituspäivä")}</dt><dd>{item.availableDate ? <time dateTime={item.availableDate}>{item.availableDate}</time> : t("Unknown", "Ei tiedossa")}</dd></div>
                    <div><dt>{t("Cutoff · Helsinki", "Tilausajan päättyminen · Helsingin aika")}</dt><dd>{cutoffLabel(item.closingTime, t, locale)}</dd></div>
                  </dl>
                  {item.observedCoverage && <StockCoverage coverage={item.observedCoverage} salesUnit={item.salesUnit} />}
                  {!item.estimate && <p className="evidence-offer-source">{t("Pack quantity and cost estimates are unavailable.", "Pakkausmäärää tai hinta-arviota ei ole saatavilla.")}</p>}
                  {item.issues.length > 0 && (
                    <ul className="evidence-issues" aria-label={t("Checks needing attention", "Tarkistettavat tiedot")}>
                      {item.issues.map((issue) => <li key={issue}><CircleAlert size={14} aria-hidden="true" />{supplierIssueLabel(issue, locale)}</li>)}
                    </ul>
                  )}
                </div>
                <div className="supplier-product-actions">
                  <details className="evidence-offer-details">
                    <summary><ChevronDown size={15} aria-hidden="true" />{t(" Supplier data and sources", " Toimittajan tiedot ja lähteet")}</summary>
                    <div className="evidence-offer-reveal">
                      <div className="evidence-offer-signals">
                        <span><Truck size={15} aria-hidden="true" />{t(" Historical reliability ", " Aiempi toimitusvarmuus ")}<strong>{item.reliability == null ? t("Unknown", "Ei tiedossa") : percent[locale].format(item.reliability)}</strong></span>
                        <span><Leaf size={15} aria-hidden="true" />{t(" Product group carbon estimate ", " Tuoteryhmän arvioitu hiilijalanjälki ")}<strong>{item.carbon == null ? t("Unknown", "Ei tiedossa") : `${item.carbon} kg CO₂e/kg`}</strong></span>
                      </div>
                      <p>{t("Price and availability · Valio challenge API. Historical signals · Valio challenge data files.", "Hinta ja saatavuus: Valion haasterajapinta. Aiemmat tiedot: Valion haasteaineisto.")}</p>
                      {item.packAmountSource ? <p>{t("Pack size source · ", "Pakkauskoon lähde · ")}{item.packAmountSource}</p>
                        : item.packVolumeSource && <p>{t("Pack volume source · ", "Pakkaustilavuuden lähde · ")}{item.packVolumeSource}</p>}
                    </div>
                  </details>
                  {onInspectProduct && <button className="comparison-pin" type="button" onClick={() => onInspectProduct(item.productId)}
                    aria-label={t(`Review catalog evidence for ${item.name}`, `Tarkista tuotteen ${item.name} tiedot`)}><ArrowUpRight size={15} aria-hidden="true" />{t(" Review catalog evidence", " Tarkista tuotetiedot")}</button>}
                  {observations.length > 1 && (
                    <button
                      className="comparison-pin" type="button" aria-pressed={pinned}
                      aria-disabled={!pinned && selectedProducts.length === 2 ? true : undefined}
                      aria-label={t(`Pin ${item.name} for comparison`, `Kiinnitä ${item.name} vertailuun`)}
                      ref={(node) => { if (node) pinButtons.current.set(item.productId, node); else pinButtons.current.delete(item.productId); }}
                      onClick={() => toggleProduct(item.productId)}
                    >
                      {pinned ? <CircleCheck size={16} aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />} {pinned ? t("Pinned", "Kiinnitetty") : selectedProducts.length === 2 ? t("Two products pinned", "Kaksi tuotetta kiinnitetty") : t("Pin to compare", "Kiinnitä vertailuun")}
                    </button>
                  )}
                </div>
              </motion.article>
            );
          })}
        </AnimatePresence>
      </div>
    </section>
  );
}
