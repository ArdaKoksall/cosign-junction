import { useI18n } from "../i18n";
import { useRef, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, Bot, CalendarDays, Check, ClipboardList, LoaderCircle } from "lucide-react";
import { formatEuro } from "../api";
import milkPhoto from "../assets/monday-milk.jpg";
import { CatalogSuggestions } from "../components/CatalogSuggestions";
import { AllergenOptions } from "../components/AllergenOptions";
import { ProductRequirementOptions } from "../components/ProductRequirementOptions";
import { Button } from "../components/ui";
import { quantityUnits } from "../quantity";
import { formatAllergenRequirements } from "../productRequirements";
import { rankingLabel, rankingLabels } from "../ranking";
import type { BudgetEstimate, CatalogProduct, CreateRequestBody, ProductRequirement, QuantityUnit, RankingObjective } from "../types";
import "./purchasing-evidence.css";
import "./request-form.css";

interface Props {
  busy: boolean;
  isSimulator: boolean;
  /** The POST /api/requests body this form produces, or null while required fields are missing. */
  agentRequest: CreateRequestBody | null;
  mondayMilk: boolean;
  productQuery: string;
  productId?: string;
  quantity: number;
  unit?: QuantityUnit;
  budgetEuros: number | null;
  budgetEstimate: BudgetEstimate | null;
  deadlineDate: string;
  deadlineTime: string;
  deadlineValid: boolean;
  requirements: ProductRequirement[];
  freeFromAllergen: string[];
  rankingObjective?: RankingObjective;
  onMondayMilk: () => void;
  onQuery: (value: string) => void;
  onSelectProduct: (product: CatalogProduct, requirements: ProductRequirement[]) => void;
  onQuantity: (value: number) => void;
  onUnit: (value: QuantityUnit | undefined) => void;
  onBudget: (value: number | null) => void;
  onDeadline: (date: string, time: string) => void;
  onRequirements: (value: ProductRequirement[]) => void;
  onFreeFromAllergen: (value: string[]) => void;
  onRankingObjective: (value: RankingObjective | undefined) => void;
  onBack: () => void;
  onSubmit: (event: FormEvent) => void;
}

export function RequestScreen({
  busy, isSimulator, agentRequest, mondayMilk, productQuery, productId, quantity, unit,
  budgetEuros, budgetEstimate, deadlineDate, deadlineTime, deadlineValid,
  requirements, freeFromAllergen, rankingObjective, onMondayMilk, onQuery, onQuantity,
  onSelectProduct, onUnit, onBudget, onDeadline, onRequirements, onFreeFromAllergen, onRankingObjective, onBack, onSubmit,
}: Props) {
  const { t, locale } = useI18n();
  const productField = useRef<HTMLInputElement>(null);
  const quantityField = useRef<HTMLInputElement>(null);
  const unitField = useRef<HTMLSelectElement>(null);
  const budgetField = useRef<HTMLInputElement>(null);
  const dateField = useRef<HTMLInputElement>(null);
  const timeField = useRef<HTMLInputElement>(null);
  const wholeQuantity = isSimulator || unit === "each" || unit === "case";
  const quantityStep = wholeQuantity ? 1 : 0.001;
  const completeQuantity = quantity >= quantityStep && quantity <= 1_000_000 && (!wholeQuantity || Number.isInteger(quantity));
  const fieldsComplete = [
    productQuery.trim(),
    completeQuantity && (isSimulator || unit),
    budgetEuros !== null && Number.isFinite(budgetEuros) && budgetEuros >= 0,
    deadlineValid,
  ].filter(Boolean).length;
  const ready = fieldsComplete === 4;

  function selectProduct(product: CatalogProduct, appliedRequirements: ProductRequirement[]) {
    onSelectProduct(product, appliedRequirements);
    productField.current?.focus();
  }

  function loadMondayMilk() {
    onMondayMilk();
    productField.current?.focus();
  }

  return (
    <form className="evidence-view request-view" data-simulator={isSimulator} onSubmit={(event) => {
      event.preventDefault();
      if (ready && !busy) onSubmit(event);
    }}>
      <header className="request-docket">
        <div>
          <h1>{t("New purchase request", "Uusi hankintapyyntö")}</h1>
          <p>{t("Set what you need and when it should arrive. Purchasing agents send the same fields as structured data.", "Määritä tarvittavat tuotteet ja toimitusaika. Hankinta-agentit lähettävät samat kentät rakenteisena tietona.")}</p>
        </div>
        <div className="request-completion" data-ready={ready}>
          <p className="request-progress-caption">
            {ready && <Check size={17} strokeWidth={2.5} aria-hidden="true" />}
            {ready ? t("Ready to compare", "Valmis vertailtavaksi") : t(`${fieldsComplete} of 4 fields complete`, `${fieldsComplete} / 4 kenttää täytetty`)}
          </p>
          <div className="request-progress" role="progressbar" aria-label={t("Request fields complete", "Täytetyt kentät")}
            aria-valuemin={0} aria-valuemax={4} aria-valuenow={fieldsComplete}
          >
            {[1, 2, 3, 4].map((step) => <span key={step} data-complete={step <= fieldsComplete} aria-hidden="true" />)}
          </div>
        </div>
      </header>
      <div className={!isSimulator ? "request-editor request-editor--with-tools" : "request-editor"}>
        <section className="evidence-panel request-requirements" aria-labelledby="request-requirements-title">
          <header className="request-sheet-heading">
            <div className="evidence-panel-heading">
              <span className="evidence-icon"><ClipboardList size={21} aria-hidden="true" /></span>
              <h2 id="request-requirements-title">{t("Kitchen requirements", "Keittiön vaatimukset")}</h2>
            </div>
          </header>
          <fieldset className="request-fields" aria-label={t("Request fields", "Pyynnön kentät")} disabled={busy}>
            <div className="request-field--wide">
              <div className="request-field">
                <label htmlFor="request-product">{t("Product", "Tuote")}</label>
                <input
                  ref={productField} id="request-product"
                  placeholder={isSimulator ? t("Milk", "Maito") : t("e.g. gluten-free bread or vegan soup", "esim. gluteeniton leipä tai vegaaninen keitto")}
                  value={productQuery} maxLength={120} onChange={(event) => onQuery(event.target.value)}
                  aria-describedby="product-search-hint" autoComplete="off" readOnly={isSimulator} required
                />
                <small id="product-search-hint">{isSimulator
                  ? t("The simulator uses a fixed set of milk offers.", "Simulaattori käyttää ennalta määritettyjä maitotarjouksia.")
                  : mondayMilk ? t("Uses four reviewed drinking-milk products. Edit this field to search the full catalog.", "Käytössä on neljä tarkistettua maitotuotetta. Muokkaa kenttää, jos haluat hakea koko tuoteluettelosta.")
                    : productId ? t(`Selected catalog SKU ${productId}. Edit this field to search for other products.`, `Valittu tuotenumero ${productId}. Muokkaa kenttää, jos haluat etsiä muita tuotteita.`)
                    : t("Type a product name or SKU. Select an exact product below, or keep the search to compare matches.", "Kirjoita tuotteen nimi tai tuotenumero. Valitse alta täsmällinen tuote tai vertaile kaikkia hakuosumia.")}</small>
              </div>
              {isSimulator ? <p className="request-rule">{t("Product requirement: Lactose-free", "Tuotevaatimus: laktoositon")}</p> : <ProductRequirementOptions
                selected={requirements} onChange={onRequirements} />}
              {!isSimulator && <details className="request-allergen-options">
                <summary>{t("Allergen declarations", "Allergeenimerkinnät")}{freeFromAllergen.length > 0 && t(` · Free from ${formatAllergenRequirements(freeFromAllergen, locale)}`, ` · Ei sisällä: ${formatAllergenRequirements(freeFromAllergen, locale)}`)}</summary>
                <AllergenOptions selected={freeFromAllergen} onChange={onFreeFromAllergen} />
              </details>}
              {!isSimulator && !mondayMilk && <CatalogSuggestions
                query={productQuery}
                requirements={requirements}
                freeFromAllergen={freeFromAllergen}
                selectedId={productId}
                disabled={busy}
                actionLabel="Use this SKU"
                onSelect={selectProduct}
                onUseSpelling={(corrected) => { onQuery(corrected); productField.current?.focus(); }}
              />}
            </div>
            <div className={isSimulator ? undefined : "request-quantity"}>
              <label className="request-field">
                <span>{t("Quantity ", "Määrä ")}{isSimulator && <small>{t("litres", "litraa")}</small>}</span>
                <input
                  ref={quantityField} type="number" min={quantityStep} max={1_000_000} step={quantityStep} value={quantity || ""}
                  onChange={(event) => onQuantity(Number(event.target.value))} required
                />
              </label>
              {!isSimulator && <div className="request-field">
                <label htmlFor="request-unit">{t("Unit", "Yksikkö")}</label>
                <select ref={unitField} id="request-unit" value={unit ?? ""} required
                  onChange={({ currentTarget }) => onUnit(currentTarget.value ? currentTarget.value as QuantityUnit : undefined)}>
                  <option value="">{t("Select a unit", "Valitse yksikkö")}</option>
                  {quantityUnits.map(({ value, label, finnish }) => <option key={value} value={value}>{t(label, finnish)}</option>)}
                </select>
              </div>}
            </div>
            <label className="request-field">
              <span>{t("Budget ", "Budjetti ")}<small>{t("EUR, ex VAT", "EUR, alv 0 %")}</small></span>
              <input
                ref={budgetField} type="number" min={0} step={0.01} value={budgetEuros ?? ""}
                onChange={(event) => onBudget(event.target.value === "" ? null : event.target.valueAsNumber)}
                aria-describedby={budgetEstimate ? "request-budget-estimate" : undefined}
                required
              />
              {budgetEstimate && <small id="request-budget-estimate">
                {t("Estimated ", "Arvio ")} {formatEuro(budgetEstimate.totalCents, locale)} · {budgetEstimate.label}{t(". Edit this amount to set your budget. ", ". Muokkaa summaa asettaaksesi budjetin. ")}
              </small>}
            </label>
            {isSimulator ? (
              <label className="request-field">
                <span>{t("Delivery deadline ", "Toimituksen määräaika ")}<small>{t("your local time", "paikallinen aika")}</small></span>
                <input type="datetime-local" value={deadlineDate && deadlineTime ? `${deadlineDate}T${deadlineTime}` : ""}
                  onChange={({ currentTarget }) => {
                    const [date, time = ""] = currentTarget.value.split("T");
                    onDeadline(date, time);
                  }} required />
              </label>
            ) : (
              <div className="request-deadline request-field--wide">
                <label className="request-field">
                  <span>{t("Delivery date", "Toimituspäivä")}</span>
                  <input ref={dateField} type="date" value={deadlineDate}
                    onChange={({ currentTarget }) => onDeadline(currentTarget.value, deadlineTime)} required />
                </label>
                <label className="request-field">
                  <span>{t("Delivery needed by ", "Toimitettava viimeistään ")}<small>{t("Helsinki time", "Helsingin aika")}</small></span>
                  <input ref={timeField} type="time" value={deadlineTime}
                    onChange={({ currentTarget }) => onDeadline(deadlineDate, currentTarget.value)} required />
                  {deadlineDate && deadlineTime && !deadlineValid && <small role="alert">{t("Choose an unambiguous Helsinki time.", "Valitse yksiselitteinen aika Helsingin aikavyöhykkeeltä.")}</small>}
                </label>
              </div>
            )}
            {!isSimulator && <div className="request-field request-field--wide">
              <label htmlFor="request-ranking">{t("Comparison priority", "Vertailun painotus")}</label>
              <select id="request-ranking" value={rankingObjective ?? ""} onChange={({ currentTarget }) =>
                onRankingObjective((currentTarget.value || undefined) as RankingObjective | undefined)}>
                <option value="">{t("No preference", "Ei painotusta")}</option>
                {(Object.keys(rankingLabels) as (keyof typeof rankingLabels)[]).map((value) => <option key={value} value={value}>{rankingLabel(value, locale)}</option>)}
              </select>
            </div>}
          </fieldset>
          <div className="evidence-actions">
            <Button variant="tertiary" onClick={onBack} disabled={busy}>
              <ArrowLeft size={16} aria-hidden="true" /> {t(" Back ", " Takaisin ")}
            </Button>
            <Button
              type="submit"
              size="md"
              disabled={busy || !ready}
            >
              {busy ? t("Finding offers…", "Etsitään tarjouksia…") : t("Find & compare offers", "Etsi ja vertaile tarjouksia")}
              {busy ? <LoaderCircle className="intake-spinner" size={16} aria-hidden="true" /> : <ArrowRight size={16} aria-hidden="true" />}
            </Button>
          </div>
        </section>
        {!isSimulator && <aside className="request-tools" aria-label={t("Draft tools", "Luonnostyökalut")}>
          <section className="evidence-panel agent-request-panel" aria-labelledby="agent-request-title">
            <div className="evidence-panel-heading">
              <span className="evidence-icon"><Bot size={19} aria-hidden="true" /></span>
              <h2 id="agent-request-title">{t("Agent request", "Agentin pyyntö")}</h2>
            </div>
            <p>{t("An external purchasing agent sends this to ", "Ulkoinen hankinta-agentti lähettää tiedot osoitteeseen ")}<code>POST /api/requests</code>{t(". The fields come from this form.", ". Kentät tulevat tästä lomakkeesta.")}</p>
            {agentRequest
              ? <pre className="agent-request-json" aria-label={t("Request body", "Pyynnön sisältö")}>{JSON.stringify(agentRequest, null, 2)}</pre>
              : <p className="agent-request-empty">{t("Add a product, quantity with unit, and delivery deadline to see the request body.", "Lisää tuote, määrä yksikköineen ja toimituksen määräaika, niin näet pyynnön sisällön.")}</p>}
            <a className="agent-request-link" href="/api/openapi.json" target="_blank" rel="noreferrer">
              {t("Open the API schema ", "Avaa rajapinnan kuvaus ")} <ArrowRight size={14} aria-hidden="true" />
            </a>
          </section>
          <section className="request-example" aria-labelledby="request-example-title">
            <img className="request-example-photo" src={milkPhoto} alt="" width="850" height="390" />
            <div className="request-example-body">
              <div className="evidence-panel-heading">
                <span className="evidence-icon"><CalendarDays size={19} aria-hidden="true" /></span>
                <h2 id="request-example-title">{t("Monday milk", "Maanantain maitotilaus")}</h2>
              </div>
              <p>{t("Start with an example for 1,000 litres of lactose-free milk.", "Aloita esimerkillä, jossa tarvitaan 1 000 litraa laktoositonta maitoa.")}</p>
              <Button variant="secondary" onClick={loadMondayMilk} disabled={busy}>
                {t("Load Monday milk example ", "Lataa maanantain maitotilauksen esimerkki ")} <ArrowRight size={15} aria-hidden="true" />
              </Button>
            </div>
          </section>
        </aside>}
      </div>
    </form>
  );
}
