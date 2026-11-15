import { useI18n } from "../i18n";
import { ArrowRight, ClipboardList, Package, PencilLine, Plus, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { formatEuro, getSavedRequests } from "../api";
import { RequestDecisionTrail } from "../components/RequestDecisionTrail";
import { Badge, Button } from "../components/ui";
import { formatRequestQuantity } from "../quantity";
import type { SavedRequest, SavedRequestsPage } from "../types";
import "../purchase-redesign.css";

type CurrentRequest = Pick<SavedRequest, "id" | "quantity" | "unit" | "budgetCents" | "deadline" | "query" | "productId"> & {
  status: string;
  statusLabel?: string;
};

const deadlineFormats = {
  en: new Intl.DateTimeFormat("en-FI", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Helsinki" }),
  fi: new Intl.DateTimeFormat("fi-FI", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Helsinki" }),
};
const pageSize = 20;

export function RequestWorkspaceScreen({
  currentRequest, ready, busy, comparisonVersion, approvedVersion, onNewRequest, onCompare, onEditRequest, onOpenCurrent, onOpenRequest,
}: {
  currentRequest: CurrentRequest | null;
  ready: boolean;
  busy: boolean;
  comparisonVersion?: number;
  approvedVersion: number | null;
  onNewRequest: () => void;
  onCompare: () => void;
  onEditRequest: () => void;
  onOpenCurrent: () => void;
  onOpenRequest: (id: string) => void;
}) {
  const { t, locale } = useI18n();
  const [query, setQuery] = useState("");
  const search = query.trim();
  const [page, setPage] = useState<SavedRequestsPage | null>(null);
  const [cursor, setCursor] = useState<string>();
  const [retryCount, setRetryCount] = useState(0);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState("");
  const currentDeadline = currentRequest ? new Date(currentRequest.deadline) : null;
  const hasComparison = comparisonVersion !== undefined;
  const requests = page?.requests ?? [];
  const nextCursor = page?.nextCursor;

  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const result = await getSavedRequests({ query: search, cursor, limit: pageSize }, controller.signal);
        if (controller.signal.aborted) return;
        setPage((previous) => ({
          ...result,
          requests: cursor && previous ? [...previous.requests, ...result.requests] : result.requests,
        }));
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : t("Saved requests could not be loaded.", "Tallennettuja pyyntöjä ei voitu ladata."));
        }
      } finally {
        if (!controller.signal.aborted) setPending(false);
      }
    }, search && !cursor ? 200 : 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [ready, search, cursor, retryCount]);

  function updateSearch(value: string) {
    setQuery(value);
    if (value.trim() === search) return;
    setPending(true);
    setError("");
    setPage(null);
    setCursor(undefined);
  }

  return (
    <div className="purchase-view">
      <header className="purchase-heading">
        <div>
          <h1>{t("Purchase requests", "Hankintapyynnöt")}</h1>
          <p>{t("Find saved requests and reopen their supplier comparisons.", "Etsi tallennettuja pyyntöjä ja avaa niiden toimittajavertailut uudelleen.")}</p>
        </div>
        <Button size="md" onClick={onNewRequest} disabled={busy}>
          <Plus size={18} aria-hidden="true" /> {t(" New request ", " Uusi pyyntö ")}
        </Button>
      </header>

      <div className={currentRequest ? "purchase-layout purchase-request-layout" : undefined}>
        {currentRequest && (
          <section className="purchase-current" aria-labelledby="current-request-title">
            <div className="purchase-ribbon">
              <h2 id="current-request-title">{t("Current request", "Nykyinen pyyntö")}</h2>
              <Badge color={currentRequest.status === "Approved" || currentRequest.status === "Simulated order placed" ? "success" : "default"}>{currentRequest.statusLabel ?? currentRequest.status}</Badge>
            </div>
            <div className="purchase-current-body">
              <h3>{currentRequest.query ?? t("Milk", "Maito")}</h3>
              {currentRequest.productId && <p>{t("SKU ", "Tuotenumero ")}{currentRequest.productId}</p>}
              <dl className="purchase-current-facts">
                <div><dt>{t("Quantity", "Määrä")}</dt><dd>{formatRequestQuantity(currentRequest, locale)}</dd></div>
                <div><dt>{t("Budget, ex VAT", "Budjetti, alv 0 %")}</dt><dd>{formatEuro(currentRequest.budgetCents, locale)}</dd></div>
                {currentDeadline && !Number.isNaN(currentDeadline.getTime()) && (
                  <div><dt>{t("Delivery deadline · Helsinki", "Toimituksen määräaika · Helsingin aika")}</dt><dd><time dateTime={currentDeadline.toISOString()}>{deadlineFormats[locale].format(currentDeadline)}</time></dd></div>
                )}
              </dl>
              <div className="purchase-actions">
                <Button variant="secondary" disabled={busy} onClick={hasComparison ? onOpenCurrent : onCompare}>
                  {hasComparison ? t("Open comparison", "Avaa vertailu") : t("Compare products", "Vertaa tuotteita")} <ArrowRight size={16} aria-hidden="true" />
                </Button>
                {currentRequest.status === "Draft" && <Button variant="tertiary" disabled={busy} onClick={onEditRequest}>
                  <PencilLine size={15} aria-hidden="true" /> {t(" Edit request ", " Muokkaa pyyntöä ")}
                </Button>}
              </div>
              <RequestDecisionTrail key={currentRequest.id} requestId={currentRequest.id} revision={comparisonVersion} approvedVersion={approvedVersion} />
            </div>
          </section>
        )}

        <section className="purchase-section" aria-labelledby="request-register-title">
          <header className="purchase-section-heading">
            <h2 id="request-register-title">{t("Saved requests", "Tallennetut pyynnöt")}</h2>
            <label className="purchase-register-search">
              <Search size={17} aria-hidden="true" />
              <input type="search" aria-label={t("Search saved requests", "Hae tallennettuja pyyntöjä")} placeholder={t("Search requests", "Hae pyyntöjä")} maxLength={120}
                value={query} onChange={({ target }) => updateSearch(target.value)} />
            </label>
          </header>
          {!ready && <p className="purchase-note">{t("Connect to the workspace to load saved requests.", "Yhdistä työtilaan ladataksesi tallennetut pyynnöt.")}</p>}
          {ready && pending && <p className="purchase-note" role="status">{t("Loading saved requests…", "Ladataan tallennettuja pyyntöjä…")}</p>}
          {error && (
            <div className="purchase-actions">
              <p className="purchase-note" role="alert">{error}</p>
              <Button variant="secondary" disabled={busy} onClick={() => {
                setPending(true);
                setError("");
                setRetryCount((count) => count + 1);
              }}>{t("Retry", "Yritä uudelleen")}</Button>
            </div>
          )}
          {requests.length > 0 ? (
            <ul className="purchase-register-list purchase-request-list">
              {requests.map((request) => (
                <li key={request.id}>
                  <button type="button" disabled={busy} onClick={() => onOpenRequest(request.id)}>
                    <span className="purchase-icon"><Package size={18} aria-hidden="true" /></span>
                    <span className="purchase-order-details">
                      <strong>{request.query ?? t("Milk", "Maito")}</strong>
                      <small>{request.productId ? t(`SKU ${request.productId} · `, `Tuotenumero ${request.productId} · `) : ""}{formatRequestQuantity(request, locale)} · {formatEuro(request.budgetCents, locale)}{t(" ex VAT", " alv 0 %")}</small>
                    </span>
                    <ArrowRight className="purchase-order-arrow" size={16} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          ) : ready && !pending && !error && (
            <div className="purchase-empty">
              <span className="purchase-icon">
                {search ? <Search size={24} aria-hidden="true" /> : <ClipboardList size={24} aria-hidden="true" />}
              </span>
              <div>
                <h3>{search ? t("No matching requests", "Vastaavia pyyntöjä ei löytynyt") : t("No saved requests yet", "Ei vielä tallennettuja pyyntöjä")}</h3>
                <p>{search ? t("Try a different product name, SKU or request ID.", "Kokeile toista tuotenimeä, tuotenumeroa tai pyynnön tunnusta.") : t("Requests appear here after you submit them for comparison.", "Pyynnöt näkyvät täällä, kun olet lähettänyt ne vertailuun.")}</p>
              </div>
            </div>
          )}
          {nextCursor && !error && (
            <div className="purchase-actions">
              <Button variant="secondary" disabled={busy || pending} onClick={() => {
                setPending(true);
                setCursor(nextCursor);
              }}>{t("Load more requests", "Lataa lisää pyyntöjä")}</Button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
