import { useI18n } from "../i18n";
import { useState } from "react";
import { ArrowRight, CalendarDays, Info, LoaderCircle, PencilLine, RefreshCw, Search } from "lucide-react";
import { formatEuro } from "../api";
import { SimulatorTokenForm } from "../components/SimulatorAccess";
import { Button } from "../components/ui";
import { SupplierDecision, SupplierResults } from "../components/SupplierResults";
import { formatAllergenRequirements, formatProductRequirements } from "../productRequirements";
import type { OptionChoice } from "../optionChoice";
import { formatQuantity } from "../quantity";
import type { CompareResponse, ProductRequirement, QuantityUnit } from "../types";
import "./purchasing-evidence.css";
import "./supplier-comparison.css";

const helsinkiTime = {
  en: new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Helsinki" }),
  fi: new Intl.DateTimeFormat("fi-FI", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Helsinki" }),
};

function ComparisonTime({ value }: { value?: string }) {
  const { t, locale } = useI18n();
  const date = value ? new Date(value) : undefined;
  return date && Number.isFinite(date.getTime()) ? <time dateTime={value}>{helsinkiTime[locale].format(date)}</time> : <>{t("Unknown", "Ei tiedossa")}</>;
}

type RehearsalActions = {
  signedIn: boolean;
  quote: CompareResponse | null;
  hasOrder: boolean;
  onSignIn: () => void;
  onCreate: (sku: string) => void;
  onReview: () => void;
  onReceipt: () => void;
};

function RehearsalSection({ proposal, actions, busy }: { proposal: CompareResponse; actions: RehearsalActions; busy: boolean }) {
  const { t, locale } = useI18n();
  const [chosenId, setChosenId] = useState<string>();
  const { signedIn, quote, hasOrder } = actions;
  const candidates = (proposal.observations ?? []).filter(({ productId }) => proposal.rehearsalCandidates?.includes(productId));
  const defaultId = quote?.rehearsal?.productId ?? proposal.decision?.ranking?.preferred?.productId ?? proposal.decision?.bestWithinBudget?.productId;
  const selected = candidates.find(({ productId }) => productId === chosenId)
    ?? candidates.find(({ productId }) => productId === defaultId) ?? candidates[0];
  const mayCreate = selected && (selected.productId !== quote?.rehearsal?.productId
    || proposal.version !== quote?.rehearsal?.supplierComparisonVersion);

  return (
    <section className="evidence-panel comparison-rehearsal" aria-labelledby="comparison-rehearsal-title">
      <div>
        <h2 id="comparison-rehearsal-title">{t("Simulated checkout", "Testitilaus")}</h2>
        <p>{t("Use a Valio price observation to create a fixed-price test quote. The test order is saved locally.", "Luo kiinteähintainen testitarjous Valion ilmoittamasta hinnasta. Testitilaus tallennetaan paikallisesti.")}</p>
      </div>
      {!selected && !quote && !busy && (
        <p>{t("No product in this comparison qualifies for a simulated quote. Edit the request or check another delivery date.", "Yhdestäkään vertailun tuotteesta ei voi tehdä testitarjousta. Muokkaa pyyntöä tai tarkista toinen toimituspäivä.")}</p>
      )}
      {!signedIn ? (
        <details className="comparison-rehearsal-access">
          <summary>{t("Sign in to rehearse checkout", "Kirjaudu sisään harjoitellaksesi tilaamista")}</summary>
          <SimulatorTokenForm embedded onConnect={actions.onSignIn} />
        </details>
      ) : hasOrder ? (
        <Button variant="secondary" onClick={actions.onReceipt} disabled={busy}>{t("Open simulated receipt ", "Avaa testikuitti ")}<ArrowRight size={16} aria-hidden="true" /></Button>
      ) : (
        <>
          {quote && <Button variant="secondary" onClick={actions.onReview} disabled={busy}>
            {t("Open simulated quote ", "Avaa testitarjous ")} <ArrowRight size={16} aria-hidden="true" />
          </Button>}
          {selected ? (
            <form className="comparison-rehearsal-selection" onSubmit={(event) => {
              event.preventDefault();
              if (mayCreate && !busy) actions.onCreate(selected.productId);
            }}>
              <div className="request-field">
                <label htmlFor="rehearsal-product">{t("Product for the simulated quote", "Testitarjouksen tuote")}</label>
                <select id="rehearsal-product" value={selected.productId} onChange={({ target }) => setChosenId(target.value)} disabled={busy}>
                  {candidates.map(({ name, productId, estimate }) => <option value={productId} key={productId}>
                    {name} · {productId}{estimate?.totalCents != null && ` · ${formatEuro(estimate.totalCents, locale)}`}
                  </option>)}
                </select>
              </div>
              <Button type="submit" disabled={busy || !mayCreate}>{quote ? t("Replace simulated quote", "Korvaa testitarjous") : t("Create simulated quote", "Luo testitarjous")} <ArrowRight size={16} aria-hidden="true" /></Button>
              {quote && mayCreate && <p className="comparison-rehearsal-hint">{t("Replacing the quote requires a new approval.", "Tarjouksen korvaaminen vaatii uuden hyväksynnän.")}</p>}
            </form>
          ) : null}
        </>
      )}
    </section>
  );
}

export function SupplierComparisonScreen({
  proposal, mondayMilk, productQuery, quantity, unit, requirements, freeFromAllergen = [], budgetCents, deadline, deadlineDate = "", exactProductId, busy, onEdit, onRefresh, onCheckDates, onInspectProduct, onChooseOption, rehearsal,
}: {
  proposal: CompareResponse;
  mondayMilk: boolean;
  productQuery: string;
  quantity: number;
  unit: QuantityUnit;
  requirements: ProductRequirement[];
  freeFromAllergen?: string[];
  budgetCents: number;
  deadline: string;
  exactProductId?: string;
  busy: boolean;
  onEdit: () => void;
  onRefresh: () => void;
  onCheckDates: () => void;
  onInspectProduct: (sku: string) => void;
  /** Helsinki calendar date of the requested delivery. */
  deadlineDate?: string;
  /** Applies a chosen runner-up to the request, then compares it or opens the form. */
  onChooseOption?: (choice: OptionChoice, compareNow: boolean) => void;
  rehearsal?: RehearsalActions;
}) {
  const { t, locale } = useI18n();
  const observations = proposal.observations ?? [];
  const reportsFullStock = observations.some(({ estimate }) => estimate?.stockFit === "reported_sufficient");
  const bestPartial = reportsFullStock ? undefined : observations.flatMap((product) => {
    const coverage = product.observedCoverage;
    return coverage && coverage.coveredQuantity > 0 && coverage.uncoveredQuantity > 0 ? [{ product, coverage }] : [];
  }).sort((a, b) => b.coverage.coveredQuantity - a.coverage.coveredQuantity)[0];
  return (
    <div className="view-enter evidence-view supplier-comparison-view">
      <header className="evidence-page-heading">
        <h1>{t("Supplier comparison", "Toimittajavertailu")}</h1>
        <div className="comparison-request-context">
          <p>{mondayMilk ? t("Monday milk request", "Maanantain maitopyyntö") : productQuery}</p>
          {(requirements.length > 0 || exactProductId) && <ul className="comparison-context">
            {exactProductId && <li>{t("SKU ", "Tuotenumero ")}{exactProductId}</li>}
            {requirements.length > 0 && <li>{formatProductRequirements(requirements, locale)}</li>}
          </ul>}
        </div>
        <div className="evidence-heading-actions">
          {!observations.length && exactProductId && <Button variant="secondary" onClick={() => onInspectProduct(exactProductId)}>
            <Search size={15} aria-hidden="true" /> {t(" Review selected SKU ", " Tarkista valittu tuote ")}
          </Button>}
          {!!observations.length && <Button variant="secondary" onClick={onCheckDates} disabled={busy}>
            <CalendarDays size={15} aria-hidden="true" /> {t(" Check other delivery dates ", " Tarkista muut toimituspäivät ")}
          </Button>}
          <Button variant="tertiary" onClick={onEdit} disabled={busy}>
            <PencilLine size={15} aria-hidden="true" /> {t(" Edit request ", " Muokkaa pyyntöä ")}
          </Button>
          <Button onClick={onRefresh} disabled={busy}>
            {busy ? <LoaderCircle className="intake-spinner" size={15} aria-hidden="true" /> : <RefreshCw size={15} aria-hidden="true" />}
            {busy ? t("Checking supplier data…", "Tarkistetaan toimittajatietoja…") : t("Refresh supplier data", "Päivitä toimittajatiedot")}
          </Button>
        </div>
      </header>
      <div className={proposal.decision ? "comparison-overview comparison-overview--with-decision" : "comparison-overview"}>
        <section className="evidence-panel comparison-summary" aria-labelledby="comparison-summary-title">
          <h2 id="comparison-summary-title">{t("Request at a glance", "Pyynnön yhteenveto")}</h2>
          <dl className="evidence-metrics evidence-metrics--summary">
            <div><dt>{t("Required quantity", "Tarvittava määrä")}</dt><dd>{formatQuantity(quantity, unit, locale)}</dd></div>
            <div><dt>{t("Budget, ex VAT", "Budjetti, alv 0 %")}</dt><dd>{formatEuro(budgetCents, locale)}</dd></div>
            <div className="comparison-summary-detail"><dt>{t("Requested by (Helsinki)", "Toimitettava viimeistään (Helsinki)")}</dt><dd><ComparisonTime value={deadline} /></dd></div>
            <div className="comparison-summary-detail"><dt>{t("Last checked (Helsinki)", "Viimeksi tarkistettu (Helsinki)")}</dt><dd><ComparisonTime value={proposal.observedAt} /></dd></div>
            {freeFromAllergen.length > 0 && <div className="comparison-summary-detail comparison-summary-detail--wide"><dt>{t("Declared free from", "Ilmoituksen mukaan ei sisällä")}</dt><dd>{formatAllergenRequirements(freeFromAllergen, locale)}</dd></div>}
          </dl>
          <div className="evidence-note evidence-summary-note">
            <Info size={17} aria-hidden="true" />
            <p>{t("Confirm stock and delivery time with Valio.", "Vahvista varastosaldo ja toimitusaika Valiolta.")}</p>
          </div>
        </section>
        {proposal.decision && <SupplierDecision decision={proposal.decision} exactProductId={exactProductId} requirements={requirements}
          freeFromAllergen={freeFromAllergen} bestPartial={bestPartial} closestProducts={proposal.closestProducts} budgetCents={budgetCents}
          observations={observations} deadlineDate={deadlineDate} busy={busy} onChoose={onChooseOption} />}
      </div>
      {rehearsal && <RehearsalSection key={`rehearsal:${proposal.requestId}`} proposal={proposal} actions={rehearsal} busy={busy} />}
      <p className="sr-only" role="status">{busy ? t("Refreshing supplier data.", "Päivitetään toimittajatietoja.") : t(`${observations.length} products checked.`, `${observations.length} tuotetta tarkistettu.`)}</p>
      {(observations.length > 0 || !proposal.decision) && <SupplierResults
        key={`observations:${proposal.requestId}`} observations={observations} onInspectProduct={onInspectProduct} />}
    </div>
  );
}
