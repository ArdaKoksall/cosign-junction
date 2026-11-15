import { useI18n } from "../i18n";
import { useState } from "react";
import { ArrowUpRight, Check, ChevronDown, Copy, Plus, ReceiptText, RefreshCw, SlidersHorizontal } from "lucide-react";
import { DecisionTimeline, isDecisionHighlight } from "../components/DecisionTimeline";
import { Button } from "../components/ui";
import { formatEuro } from "../api";
import { formatHelsinkiTime } from "../helsinkiTime";
import { formatQuantity } from "../quantity";
import type { OrderResponse } from "../types";
import "../purchase-redesign.css";

export function ReceiptScreen({ order, busy, canRetry, onRefresh, onNewRequest, onRetry, onComparison }: {
  order: OrderResponse;
  busy: boolean;
  canRetry: boolean;
  onRefresh: () => void;
  onNewRequest: () => void;
  onRetry: () => void;
  onComparison?: () => void;
}) {
  const { t, locale } = useI18n();
  const [trailView, setTrailView] = useState<"all" | "highlights">("all");
  const [copyResult, setCopyResult] = useState<{ id: string; status: "done" | "error" }>();
  const copyState = copyResult?.id === order.orderId ? copyResult.status : undefined;
  const [action, setAction] = useState<"retry" | "refresh">();
  const waiting = busy && action;
  const events = order.events ?? [];
  const highlights = events.filter(isDecisionHighlight);
  const canFilter = highlights.length > 0 && highlights.length < events.length;
  const displayedEvents = canFilter && trailView === "highlights" ? highlights : events;

  async function copyOrderReference() {
    try {
      await navigator.clipboard.writeText(order.orderId);
      setCopyResult({ id: order.orderId, status: "done" });
    } catch {
      setCopyResult({ id: order.orderId, status: "error" });
    }
  }

  return (
    <div className="purchase-view" key={order.orderId}>
      <header className="purchase-heading">
        <div>
          <h1>{t("Simulated order placed", "Testitilaus tehty")}</h1>
          <p>{order.rehearsal ? t("The test receipt was saved in order history.", "Testikuitti tallennettiin tilaushistoriaan.") : t("The receipt is available in order history.", "Kuitti on tilaushistoriassa.")}</p>
        </div>
        <span className="purchase-heading-meta purchase-heading-meta--success">
          <Check size={15} aria-hidden="true" />
          <span className="sr-only">{t("Order status ", "Tilauksen tila ")}</span>{order.status.replaceAll("_", " ").toLowerCase()}
        </span>
      </header>

      <div className="purchase-layout purchase-receipt-layout">
        <section className="purchase-ticket" aria-labelledby="receipt-amount">
          <header className="purchase-ribbon">
            <h2 id="receipt-amount">{t("Order receipt", "Tilauskuitti")}</h2>
            <ReceiptText size={19} aria-hidden="true" />
          </header>
          <dl className="purchase-metrics">
            <div className="purchase-metric-feature">
              <dt>{t("Order total", "Tilauksen kokonaishinta")}</dt>
              <dd>{formatEuro(order.totalCents, locale)} <small>{t("Ex VAT", "Alv 0 %")}</small></dd>
            </div>
            <div>
              <dt>{order.rehearsal ? t("Simulated order quantity", "Testitilauksen määrä") : t("Uncovered quantity", "Puuttuva määrä")}</dt>
              <dd>{order.rehearsal ? formatQuantity(order.rehearsal.quantity, order.rehearsal.unit, locale) : `${order.uncoveredLiters.toLocaleString(locale)} L`}</dd>
            </div>
            {order.rehearsal?.requestedDeadline && <div>
              <dt>{t("Requested delivery by", "Toivottu toimitusaika")}</dt>
              <dd>{formatHelsinkiTime(order.rehearsal.requestedDeadline, locale)}</dd>
            </div>}
          </dl>
          {order.rehearsal && <p className="purchase-note purchase-receipt-item">{order.rehearsal.name}{t(" · SKU ", " · Tuotenumero ")}{order.rehearsal.productId}</p>}

          <div className="purchase-reference">
            <dl>
              <dt>{t("Order reference", "Tilausviite")}</dt>
              <dd><code>{order.orderId}</code></dd>
            </dl>
            <Button variant="secondary" onClick={() => void copyOrderReference()} ariaLabel={t("Copy order reference", "Kopioi tilausviite")}>
              {copyState === "done" ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
              {copyState === "done" ? t("Copied", "Kopioitu") : t("Copy", "Kopioi")}
            </Button>
            <span className="sr-only" role="status">{copyState === "done" ? t("Order reference copied", "Tilausviite kopioitu") : ""}</span>
            {copyState === "error" && <p className="purchase-note" role="status">{t("Clipboard unavailable. Select the reference to copy it.", "Leikepöytä ei ole käytettävissä. Valitse viite ja kopioi se.")}</p>}
          </div>
        </section>

        <section className="purchase-section" aria-labelledby="receipt-trail">
          <div className="purchase-section-heading">
            <h2 id="receipt-trail">{t("Decision trail", "Päätösloki")}</h2>
            {canFilter && (
              <div className="purchase-toggle" role="group" aria-label={t("Decision trail filter", "Päätöslokin suodatin")}>
                <button type="button" aria-pressed={trailView === "all"} onClick={() => setTrailView("all")}>{t("All ", "Kaikki ")}<small>{events.length}</small></button>
                <button type="button" aria-pressed={trailView === "highlights"} onClick={() => setTrailView("highlights")}>{t("Highlights ", "Kohokohdat ")}<small>{highlights.length}</small></button>
              </div>
            )}
          </div>
          {displayedEvents.length > 0 ? (
            <DecisionTimeline key={trailView} events={displayedEvents} />
          ) : <p className="purchase-note">{t("There are no decision entries on this receipt.", "Tällä kuitilla ei ole päätösmerkintöjä.")}</p>}
        </section>
      </div>

      <div className="purchase-actions purchase-actions-split purchase-footer">
        <Button variant="secondary" onClick={() => { setAction("refresh"); onRefresh(); }} disabled={busy}>
          <RefreshCw className={waiting === "refresh" ? "purchase-spinner" : undefined} size={15} aria-hidden="true" />
          {waiting === "refresh" ? t("Refreshing receipt…", "Päivitetään kuittia…") : t("Refresh receipt", "Päivitä kuitti")}
        </Button>
        {onComparison && <Button variant="secondary" onClick={onComparison} disabled={busy}>{t("Open supplier comparison", "Avaa toimittajavertailu")}</Button>}
        <Button onClick={onNewRequest} disabled={busy}>
          <Plus size={17} aria-hidden="true" />
          {t("New request ", "Uusi pyyntö ")}
        </Button>
      </div>

      <details className="purchase-disclosure purchase-demo-tools">
        <summary>
          <SlidersHorizontal size={15} aria-hidden="true" />
          <span>{t("Retry test", "Yritä testiä uudelleen")}</span>
          <ChevronDown size={16} aria-hidden="true" />
        </summary>
        <div className="purchase-disclosure-content">
          <p>{t("Repeat checkout with the same key to recover the existing receipt.", "Toista tilaus samalla avaimella, niin saat aiemman kuitin.")}</p>
          <Button variant="secondary" onClick={() => { setAction("retry"); onRetry(); }} disabled={busy || !canRetry}>
            {waiting === "retry" ? t("Checking existing order…", "Tarkistetaan olemassa olevaa tilausta…") : t("Retry simulated checkout", "Yritä testitilausta uudelleen")}
            {waiting === "retry" ? <RefreshCw className="purchase-spinner" size={15} aria-hidden="true" /> : <ArrowUpRight size={15} aria-hidden="true" />}
          </Button>
        </div>
      </details>
    </div>
  );
}
