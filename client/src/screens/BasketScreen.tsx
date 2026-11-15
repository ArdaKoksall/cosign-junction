import { useI18n } from "../i18n";
import { useState } from "react";
import { ArrowRight, CircleAlert, RefreshCw, Wallet } from "lucide-react";
import { formatEuro } from "../api";
import { OfferTable } from "../components/OfferTable";
import { Button } from "../components/ui";
import type { CompareResponse } from "../types";
import "../purchase-redesign.css";

export function BasketScreen({
  proposal, quantityLiters, budgetCents, eligible, rejected, overBudget, busy, onRefresh, onReview,
}: {
  proposal: CompareResponse;
  quantityLiters: number;
  budgetCents: number;
  eligible: CompareResponse["offers"];
  rejected: CompareResponse["offers"];
  overBudget: boolean;
  busy: boolean;
  onRefresh: () => void;
  onReview: () => void;
}) {
  const { t, locale } = useI18n();
  const canReview = !overBudget && proposal.uncoveredLiters === 0 && proposal.status !== "placed" && eligible.length > 0;
  const [showAlternatives, setShowAlternatives] = useState(false);
  const showExcluded = showAlternatives && rejected.length > 0;
  const uncoveredLiters = proposal.uncoveredLiters ?? quantityLiters;
  const coveredLiters = Math.max(0, quantityLiters - uncoveredLiters);
  const budgetBalance = budgetCents - proposal.totalCents;
  const usedBudget = budgetCents > 0 ? Math.min(100, 100 * proposal.totalCents / budgetCents) : proposal.totalCents > 0 ? 100 : 0;

  return (
    <div className="purchase-view">
      <header className="purchase-heading">
        <div>
          <h1>{t("Review the basket", "Tarkista kori")}</h1>
          <p>{quantityLiters.toLocaleString()}{t(" L requested · Simulated prices", " l pyydetty · Testihinnat")}</p>
        </div>
        <span className="purchase-heading-meta">{t("Revision ", "Versio ")}{proposal.version}</span>
      </header>

      {overBudget && (
        <div className="purchase-notice" role="alert">
          <Wallet size={19} aria-hidden="true" />
          <div>
            <strong>{t("Over the ", "Ylittää ")}{formatEuro(budgetCents, locale)}{t(" budget", " budjetin")}</strong>
            <p>{t("Create a request with a higher budget to continue with this basket.", "Jatka tämän korin kanssa luomalla pyyntö, jossa on suurempi budjetti.")}</p>
          </div>
        </div>
      )}
      {uncoveredLiters > 0 && (
        <div className="purchase-notice" role="alert">
          <CircleAlert size={19} aria-hidden="true" />
          <p>{t("Only ", "Vain ")}{coveredLiters.toLocaleString()}{t(" L are covered. The complete quantity is required for approval.", " l on saatavilla. Koko määrä tarvitaan hyväksyntään.")}</p>
        </div>
      )}

      <div className="purchase-layout">
        <section className="purchase-section" aria-labelledby="basket-products">
          <div className="purchase-section-heading">
            <h2 id="basket-products">{showExcluded ? t("Excluded alternatives", "Hylätyt vaihtoehdot") : t("Proposed products", "Ehdotetut tuotteet")}</h2>
            {rejected.length > 0 && (
              <div className="purchase-toggle" role="group" aria-label={t("Basket products", "Korin tuotteet")}>
                <button type="button" aria-pressed={!showExcluded} onClick={() => setShowAlternatives(false)}>{t("Proposed ", "Ehdotetut ")}<small>{eligible.length}</small></button>
                <button type="button" aria-pressed={showExcluded} onClick={() => setShowAlternatives(true)}>{t("Excluded ", "Hylätyt ")}<small>{rejected.length}</small></button>
              </div>
            )}
          </div>
          <div className="purchase-offer-selection" key={String(showExcluded)}>
            <OfferTable offers={showExcluded ? rejected : eligible} empty={showExcluded ? t("No excluded products.", "Ei hylättyjä tuotteita.") : t("No eligible offers in this revision.", "Tämä versio ei sisällä vaatimukset täyttäviä tarjouksia.")} />
          </div>
          <p className="purchase-note">{t("Reliability reflects past performance. Carbon figures are reported at product-group level.", "Luotettavuus perustuu aiempiin toimituksiin. Hiilijalanjälki ilmoitetaan tuoteryhmittäin.")}</p>
        </section>

        <aside className="purchase-basket-summary" aria-labelledby="basket-summary">
          <h2 className="purchase-ribbon" id="basket-summary">{t("Basket summary", "Korin yhteenveto")}</h2>
          <div key={proposal.version}>
            <div className="purchase-readiness-card" data-warning={overBudget}>
              <div className="purchase-readiness-label">
                <span>{t("Basket total", "Korin kokonaishinta")}</span>
                <small>{formatEuro(budgetCents, locale)}{t(" budget", " budjetin")}</small>
              </div>
              <strong>{formatEuro(proposal.totalCents, locale)}</strong>
              <div className="purchase-meter" role="meter" aria-label={t("Budget used", "Käytetty budjetti")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(usedBudget)} aria-valuetext={t(`${formatEuro(proposal.totalCents, locale)} of ${formatEuro(budgetCents, locale)}`, `${formatEuro(proposal.totalCents, locale)} / ${formatEuro(budgetCents, locale)}`)}>
                <span style={{ width: `${usedBudget}%` }} />
              </div>
              <p>{budgetBalance === 0 ? t("At budget", "Budjetin mukainen") : `${formatEuro(Math.abs(budgetBalance), locale)} ${overBudget ? t("over budget", "yli budjetin") : t("under budget", "alle budjetin")}`}{t(" · Ex VAT", " · Alv 0 %")}</p>
            </div>
            <div className="purchase-readiness-card" data-warning={uncoveredLiters > 0}>
              <div className="purchase-readiness-label">
                <span>{t("Quantity covered", "Katettu määrä")}</span>
                <small>{quantityLiters.toLocaleString()}{t(" L requested", " l pyydetty")}</small>
              </div>
              <strong>{coveredLiters.toLocaleString()} L</strong>
              <div className="purchase-meter" role="meter" aria-label={t("Quantity covered", "Katettu määrä")} aria-valuemin={0} aria-valuemax={Math.max(1, quantityLiters)} aria-valuenow={Math.min(coveredLiters, quantityLiters)} aria-valuetext={t(`${coveredLiters} of ${quantityLiters} litres`, `${coveredLiters} / ${quantityLiters} litraa`)}>
                <span style={{ width: `${quantityLiters ? Math.min(100, 100 * coveredLiters / quantityLiters) : 0}%` }} />
              </div>
              <p>{uncoveredLiters > 0 ? t(`${uncoveredLiters.toLocaleString()} L uncovered`, `${uncoveredLiters.toLocaleString()} l puuttuu`) : t(`${eligible.length} eligible ${eligible.length === 1 ? "product" : "products"}`, `${eligible.length} sopivaa tarjousta`)}</p>
            </div>
          </div>
          <div className="purchase-actions purchase-basket-actions">
            <Button size="md" onClick={onReview} disabled={busy || !canReview}>
              {t("Review for approval ", "Tarkista hyväksyttäväksi ")} <ArrowRight size={17} aria-hidden="true" />
            </Button>
            <Button variant="tertiary" onClick={onRefresh} disabled={busy}>
              <RefreshCw className={busy ? "purchase-spinner" : undefined} size={15} aria-hidden="true" />
              {busy ? t("Refreshing comparison…", "Päivitetään vertailua…") : t("Refresh comparison", "Päivitä vertailu")}
            </Button>
          </div>
        </aside>
      </div>
    </div>
  );
}
