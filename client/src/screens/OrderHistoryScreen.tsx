import { useI18n, type Locale } from "../i18n";
import { useState } from "react";
import { ArrowRight, FileCheck2, History, LoaderCircle, Plus, Search } from "lucide-react";
import { formatEuro } from "../api";
import { Button } from "../components/ui";
import type { RecentOrder } from "../types";
import "../purchase-redesign.css";

function savedDate(savedAt: string, locale: Locale) {
  const instant = new Date(savedAt);
  if (Number.isNaN(instant.getTime())) return null;
  return new Intl.DateTimeFormat(locale === "fi" ? "fi-FI" : "en-GB", { timeZone: "Europe/Helsinki", dateStyle: "medium" }).format(instant);
}

export function OrderHistoryScreen({ isSimulator, busy, recent, recoverId, onReference, onRecover, onNewRequest }: {
  isSimulator: boolean;
  busy: boolean;
  recent: RecentOrder[];
  recoverId: string;
  onReference: (value: string) => void;
  onRecover: (id?: string) => void;
  onNewRequest: () => void;
}) {
  const { t, locale } = useI18n();
  const [opening, setOpening] = useState<string>();
  const pendingOrder = busy ? opening : undefined;

  return (
    <div className="purchase-view">
      <header className="purchase-heading">
        <div>
          <h1>{t("Order history", "Tilaushistoria")}</h1>
          <p>{isSimulator ? t("Receipts for simulated orders.", "Testitilausten kuitit.") : t("Supplier checkout is unavailable in the connected workspace.", "Toimittajalta tilaaminen ei ole käytettävissä yhdistetyssä työtilassa.")}</p>
        </div>
        <span className="purchase-heading-meta">{recent.length} {recent.length === 1 ? "receipt" : "receipts"}</span>
      </header>

      <div className={isSimulator ? "purchase-layout" : undefined}>
        {recent.length === 0 ? (
          <section className="purchase-empty" aria-labelledby="orders-empty">
            <span className="purchase-icon"><History size={24} strokeWidth={1.6} aria-hidden="true" /></span>
            <div>
              <h2 id="orders-empty">{t("No orders yet", "Ei vielä tilauksia")}</h2>
              {isSimulator && <p>{t("Place a simulated order to save your first receipt.", "Tee testitilaus, niin ensimmäinen kuitti tallentuu.")}</p>}
            </div>
            {isSimulator && (
              <Button variant="secondary" onClick={onNewRequest} disabled={busy}>
                <Plus size={16} aria-hidden="true" />
                {t("Start a request ", "Aloita pyyntö ")}
              </Button>
            )}
          </section>
        ) : (
          <section className="purchase-section" aria-labelledby="recent-orders">
            <div className="purchase-section-heading">
              <h2 id="recent-orders">{t("Recent orders", "Viimeisimmät tilaukset")}</h2>
            </div>
            <ul className="purchase-register-list purchase-order-list">
              {recent.map((item) => {
                const date = savedDate(item.savedAt, locale);
                return (
                  <li key={item.orderId}>
                    <button type="button" disabled={busy} onClick={() => { setOpening(item.orderId); onRecover(item.orderId); }}>
                      <span className="purchase-icon"><FileCheck2 size={20} aria-hidden="true" /></span>
                      <span className="purchase-order-details">
                        <strong>{t("Simulated order", "Testitilaus")}</strong>
                        <code>{item.orderId}</code>
                      </span>
                      <span className="purchase-order-meta">
                        <strong>{formatEuro(item.totalCents, locale)}</strong>
                        {date && <time dateTime={item.savedAt}>{date}</time>}
                      </span>
                      {pendingOrder === item.orderId
                        ? <LoaderCircle className="purchase-order-arrow purchase-spinner" size={17} aria-hidden="true" />
                        : <ArrowRight className="purchase-order-arrow" size={17} aria-hidden="true" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {isSimulator && (
          <form
            className="purchase-recover"
            onSubmit={(event) => {
              event.preventDefault();
              setOpening(recoverId.trim());
              onRecover();
            }}
          >
            <h2 className="purchase-ribbon">{t("Find a receipt", "Etsi kuitti")}</h2>
            <div className="purchase-recover-body">
              <label htmlFor="order-reference">{t("Order reference", "Tilausviite")}</label>
              <input
                id="order-reference"
                value={recoverId}
                onChange={(event) => onReference(event.target.value)}
                placeholder="ord_…"
                autoComplete="off"
                required
              />
              <Button type="submit" variant="secondary" disabled={busy || !recoverId.trim()}>
                {pendingOrder && pendingOrder === recoverId.trim()
                  ? <><LoaderCircle className="purchase-spinner" size={16} aria-hidden="true" />{t(" Finding order…", " Etsitään tilausta…")}</>
                  : <><Search size={16} aria-hidden="true" />{t(" Find order", " Etsi tilaus")}</>}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
