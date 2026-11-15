import { useI18n } from "../i18n";
import { useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, ChevronDown, CircleAlert, LoaderCircle, ShieldCheck, SlidersHorizontal, Wallet } from "lucide-react";
import { formatEuro } from "../api";
import { OfferTable } from "../components/OfferTable";
import { Button } from "../components/ui";
import { formatHelsinkiTime } from "../helsinkiTime";
import { formatQuantity } from "../quantity";
import { supplierIssueLabel } from "../supplierIssues";
import type { CompareResponse } from "../types";
import "../purchase-redesign.css";

interface Props {
  proposal: CompareResponse;
  eligible: CompareResponse["offers"];
  busy: boolean;
  hasOrder: boolean;
  approved: boolean;
  approvedVersion: number | null;
  overBudget: boolean;
  previousProposal: CompareResponse | null;
  priceDrift: boolean;
  deltaCents: number | null;
  onApprove: () => void;
  onCommit: () => void;
  onPriceChange?: () => void;
  onComparison?: () => void;
}

function PriceRevision({ previous, current, deltaCents }: {
  previous: CompareResponse;
  current: CompareResponse;
  deltaCents: number | null;
}) {
  const { t, locale } = useI18n();
  const previousPrices = new Map(previous.offers.map(({ id, priceCents }) => [id, priceCents]));
  const changedOffers = current.offers.flatMap((offer) => {
    const previousCents = previousPrices.get(offer.id);
    return offer.eligible && previousCents !== undefined && previousCents !== offer.priceCents
      ? [{ ...offer, previousCents }]
      : [];
  });

  return (
    <section className="price-revision" aria-labelledby="price-revision-title">
      <div className="purchase-revision-heading" role="status">
        <CircleAlert size={22} aria-hidden="true" />
        <div>
          <h2 id="price-revision-title">{t("Price changed. Review again.", "Hinta muuttui. Tarkista tilaus uudelleen.")}</h2>
          <p>{t("Approve the updated total before checkout.", "Hyväksy uusi kokonaishinta ennen tilaamista.")}</p>
        </div>
      </div>
      <dl className="purchase-price-diff" aria-label={t("Change in basket total", "Korin kokonaishinnan muutos")}>
        <div>
          <dt>{t("Revision ", "Versio ")}{previous.version}</dt>
          <dd>{formatEuro(previous.totalCents, locale)}</dd>
        </div>
        <div className="purchase-price-current">
          <ArrowRight className="purchase-price-arrow" size={18} aria-hidden="true" />
          <dt>{t("Revision ", "Versio ")}{current.version}</dt>
          <dd>{formatEuro(current.totalCents, locale)}</dd>
        </div>
        {deltaCents !== null && (
          <div className="purchase-price-delta">
            <dt className="sr-only">{t("Price difference", "Hintaero")}</dt>
            <dd>{deltaCents > 0 ? "+" : ""}{formatEuro(deltaCents, locale)}</dd>
          </div>
        )}
      </dl>
      {changedOffers.length > 0 && (
        <details className="purchase-disclosure purchase-revision-lines">
          <summary>
            <span>{changedOffers.length === 1
              ? t("See 1 changed price", "Näytä 1 muuttunut hinta")
              : t(`See ${changedOffers.length} changed prices`, `Näytä ${changedOffers.length} muuttunutta hintaa`)}</span>
            <ChevronDown size={16} aria-hidden="true" />
          </summary>
          <div className="purchase-disclosure-content">
            <ul className="purchase-price-lines">
              {changedOffers.map(({ id, name, priceCents, previousCents }) => (
                <li key={id}>
                  <strong>{name}</strong>
                  <span>
                    <span className="sr-only">{t("Previous line price ", "Aiempi rivihinta ")}</span>
                    <del>{formatEuro(previousCents, locale)}</del>
                    <ArrowRight size={14} aria-hidden="true" />
                    <span className="sr-only">{t("Current line price ", "Nykyinen rivihinta ")}</span>
                    <b>{formatEuro(priceCents, locale)}</b>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </details>
      )}
    </section>
  );
}

export function ApprovalScreen({
  proposal, eligible, busy, hasOrder, approved, approvedVersion, overBudget, previousProposal,
  priceDrift, deltaCents, onApprove, onCommit, onPriceChange, onComparison,
}: Props) {
  const { t, locale } = useI18n();
  const uncoveredQuantity = proposal.uncoveredLiters?.toLocaleString(locale) ?? t("Unknown", "Ei tiedossa");
  const placed = hasOrder || proposal.status === "placed";
  const { rehearsal } = proposal;
  const cutoffPassed = !!rehearsal && Date.parse(rehearsal.closingTime) <= Date.now();
  const complete = rehearsal ? Boolean(rehearsal.salesUnits) : proposal.uncoveredLiters === 0 && eligible.length > 0;
  const canApprove = !approved && !overBudget && complete && !placed;
  const revisedPrice = priceDrift && previousProposal && previousProposal.version !== proposal.version;
  const actionArea = useRef<HTMLDivElement>(null);
  const restoreActionFocus = useRef(false);
  const [action, setAction] = useState<"approve" | "place" | "reprice">();
  const waiting = busy && action;

  useLayoutEffect(() => {
    if (busy || !restoreActionFocus.current) return;
    restoreActionFocus.current = false;
    if (document.activeElement === document.body) {
      actionArea.current?.querySelector("button")?.focus();
    }
  }, [approved, busy]);

  return (
    <div className="purchase-view">
      <header className="purchase-heading">
        <div>
          <h1>{rehearsal ? t("Review the simulated quote", "Tarkista testitarjous") : t("Approve the basket", "Hyväksy kori")}</h1>
          <p>{rehearsal
            ? t("This fixed price is for the rehearsal. Checkout creates a test receipt.", "Kiinteä hinta koskee harjoittelua. Tilaamisesta syntyy testikuitti.")
            : t("Check the products and total before placing the simulated order.", "Tarkista tuotteet ja kokonaishinta ennen testitilausta.")}</p>
        </div>
        <span className="purchase-heading-meta">{t("Revision ", "Versio ")}{proposal.version}</span>
      </header>

      {revisedPrice && previousProposal && <PriceRevision key={proposal.version} previous={previousProposal} current={proposal} deltaCents={deltaCents} />}
      {cutoffPassed && !placed && (
        <div className="purchase-notice" role="alert">
          <CircleAlert size={19} aria-hidden="true" />
          <p>{t("The supplier cutoff has passed. Refresh the comparison before creating a new simulated quote.", "Toimittajan tilausaika on päättynyt. Päivitä vertailu ennen uuden testitarjouksen luomista.")}</p>
        </div>
      )}
      {overBudget && (
        <div className="purchase-notice" role="alert">
          <Wallet size={19} aria-hidden="true" />
          <div>
            <strong>{t("Basket exceeds the budget", "Kori ylittää budjetin")}</strong>
            <p>{t("Create a request with a higher budget to continue.", "Jatka luomalla pyyntö, jossa on suurempi budjetti.")}</p>
          </div>
        </div>
      )}

      <div className="purchase-layout">
        <section className="purchase-section" aria-labelledby="approval-products">
          <div className="purchase-section-heading">
            <h2 id="approval-products">{rehearsal ? t("Product from Valio comparison", "Tuote Valion vertailusta") : t("Products in this revision", "Tämän version tuotteet")}</h2>
          </div>
          {rehearsal ? (
            <div className="purchase-rehearsal-details">
              <div><h3>{rehearsal.name}</h3><p>{t("SKU ", "Tuotenumero ")}{rehearsal.productId}</p></div>
              <dl>
                <div><dt>{t("Requested quantity", "Pyydetty määrä")}</dt><dd>{formatQuantity(rehearsal.requestedQuantity, rehearsal.unit, locale)}</dd></div>
                <div><dt>{t("Quoted quantity", "Tarjottu määrä")}</dt><dd>{formatQuantity(rehearsal.quantity, rehearsal.unit, locale)} · {rehearsal.salesUnits.toLocaleString(locale)} {rehearsal.salesUnit}</dd></div>
                {rehearsal.requestedDeadline && <div><dt>{t("Requested delivery by", "Toivottu toimitusaika")}</dt><dd>{formatHelsinkiTime(rehearsal.requestedDeadline, locale)}</dd></div>}
                <div><dt>{t("Observed price per sales unit, ex VAT", "Havaittu hinta myyntiyksikköä kohden, alv 0 %")}</dt><dd>{formatEuro(rehearsal.salesUnitPriceCents, locale)}</dd></div>
                <div><dt>{t("Valio observation", "Valion ilmoittamat tiedot")}</dt><dd>{t("Revision ", "Versio ")}{rehearsal.supplierComparisonVersion} · {formatHelsinkiTime(rehearsal.observedAt, locale)}</dd></div>
                <div><dt>{t("Supplier cutoff", "Toimittajan tilausajan päättyminen")}</dt><dd>{formatHelsinkiTime(rehearsal.closingTime, locale)}</dd></div>
              </dl>
              {rehearsal.caveats.length > 0 && (
                <div className="purchase-rehearsal-caveats">
                  <h3>{t("Supplier evidence to verify", "Tarkistettavat toimittajatiedot")}</h3>
                  <ul>{rehearsal.caveats.map((issue) => <li key={issue}>{supplierIssueLabel(issue, locale)}</li>)}</ul>
                </div>
              )}
            </div>
          ) : <OfferTable offers={eligible} empty={t("No lines to approve.", "Ei hyväksyttäviä rivejä.")} />}
        </section>
        <aside className="purchase-approval" aria-labelledby="approval-summary">
          <div className="purchase-approval-total">
            <h2 className="purchase-caption" id="approval-summary">{rehearsal ? t("Fixed rehearsal total", "Testitarjouksen kiinteä kokonaishinta") : t("Basket total", "Korin kokonaishinta")}</h2>
            <strong key={proposal.version} className="purchase-total-number">{formatEuro(proposal.totalCents, locale)}</strong>
            <p>{rehearsal ? t("Ex VAT · Simulation only", "Alv 0 % · Testitilaus") : t(`Ex VAT · ${uncoveredQuantity} L uncovered`, `Alv 0 % · Puuttuu ${uncoveredQuantity} l`)}</p>
          </div>
          <div className="purchase-approval-body" ref={actionArea}>
            <div className="purchase-approval-state" data-approved={approved || placed} role="status">
              <span className="purchase-icon" key={String(approved || placed)}>
                {approved || placed ? <Check size={19} aria-hidden="true" /> : <ShieldCheck size={19} aria-hidden="true" />}
              </span>
              <div>
                <strong>{placed ? t("Simulated order placed", "Testitilaus tehty") : approved ? t("Revision approved", "Versio hyväksytty") : t("Awaiting buyer approval", "Odottaa ostajan hyväksyntää")}</strong>
                {approved && !placed && <p>{t("Approval recorded for revision ", "Hyväksytty versio ")}{approvedVersion}.</p>}
              </div>
            </div>
            {!placed && (
              <Button
                size="md"
                disabled={busy || cutoffPassed || (approved ? overBudget : !canApprove)}
                onClick={() => {
                  if (approved) {
                    setAction("place");
                    onCommit();
                  } else {
                    setAction("approve");
                    restoreActionFocus.current = true;
                    onApprove();
                  }
                }}
              >
                {waiting === "approve" || waiting === "place" ? (
                  <><LoaderCircle className="purchase-spinner" size={17} aria-hidden="true" /> {waiting === "approve" ? t("Recording approval…", "Tallennetaan hyväksyntää…") : t("Placing order…", "Tehdään tilausta…")}</>
                ) : approved ? (
                  <>{t("Place simulated order ", "Tee testitilaus ")}<ArrowRight size={16} aria-hidden="true" /></>
                ) : (
                  <><Check size={17} aria-hidden="true" />{t(" Approve this revision", " Hyväksy tämä versio")}</>
                )}
              </Button>
            )}
          </div>
        </aside>
      </div>

      {onPriceChange && <details className="purchase-disclosure purchase-demo-tools">
        <summary>
          <SlidersHorizontal size={15} aria-hidden="true" />
          <span>{t("Demo controls", "Demon toiminnot")}</span>
          <ChevronDown size={16} aria-hidden="true" />
        </summary>
        <div className="purchase-disclosure-content">
          <p>{t("Change the test price to trigger a new approval request.", "Muuta testihintaa, niin saat uuden hyväksyntäpyynnön.")}</p>
          <Button variant="secondary" onClick={() => { setAction("reprice"); onPriceChange(); }} disabled={busy || placed}>
            {waiting === "reprice" ? <><LoaderCircle className="purchase-spinner" size={16} aria-hidden="true" />{t(" Repricing basket…", " Päivitetään korin hintaa…")}</> : t("Simulate price change", "Simuloi hinnanmuutosta")}
          </Button>
        </div>
      </details>}
      {onComparison && <div className="purchase-actions purchase-footer">
        <Button variant="secondary" onClick={onComparison} disabled={busy}>
          <ArrowLeft size={16} aria-hidden="true" /> {t(" Back to supplier comparison ", " Takaisin toimittajavertailuun ")}
        </Button>
      </div>}
    </div>
  );
}
