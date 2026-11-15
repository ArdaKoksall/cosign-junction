import { useI18n, type Locale } from "../i18n";
import { ArrowRight, ArrowUpRight, BookOpen, ClipboardList, FileCheck2, Package, Plus, ScanLine, Store } from "lucide-react";
import { Badge, Button } from "../components/ui";
import { formatEuro } from "../api";
import { kitchenBriefs, rehearsalMilkBudgetEuros, simulatorBrief, type KitchenBrief } from "../kitchenBriefs";
import { formatRequestQuantity } from "../quantity";
import cafeOrangePhoto from "../assets/cafe-orange.jpg";
import vegetableStockPhoto from "../assets/vegetable-stock.jpg";
import vanillaIceCreamPhoto from "../assets/vanilla-ice-cream.jpg";
import mondayMilkPhoto from "../assets/monday-milk.jpg";
import receivingPhoto from "../assets/aimo-market.webp";
import type { RecentOrder, SavedRequest } from "../types";
import "./dashboard.css";

interface DashboardProps {
  busy: boolean;
  isSimulator: boolean;
  connectedRehearsalEnabled?: boolean;
  canReadOrders?: boolean;
  currentRequest: (Pick<SavedRequest, "id" | "quantity" | "unit"> & { query: string; status: string; statusLabel?: string }) | null;
  savedRequests: SavedRequest[];
  recent: RecentOrder[];
  onNewRequest: () => void;
  onOpenCurrentRequest: () => void;
  onOpenExample: (brief: KitchenBrief) => void;
  onOpenCatalog: () => void;
  onOpenRequests: () => void;
  onOpenLookup: () => void;
  onOpenHistory: () => void;
  onRecover: (id: string) => void;
  onOpenRequest: (id: string) => void;
}

const activityDate = {
  en: new Intl.DateTimeFormat("en-FI", { day: "numeric", month: "short", timeZone: "Europe/Helsinki" }),
  fi: new Intl.DateTimeFormat("fi-FI", { day: "numeric", month: "short", timeZone: "Europe/Helsinki" }),
};
const briefPhotos: Record<string, string> = {
  juice: cafeOrangePhoto,
  stock: vegetableStockPhoto,
  "ice-cream": vanillaIceCreamPhoto,
  milk: mondayMilkPhoto,
};

const finnishBriefs: Record<string, Pick<KitchenBrief, "title" | "product" | "description">> = {
  juice: { title: "Kahvilan aamiainen", product: "Appelsiinimehu", description: "Täydennä aamiaispöytä täysappelsiinimehulla." },
  stock: { title: "Lounastarjoilu", product: "Kasvisliemi", description: "Valmista keittoa laktoosittomasta kasvisliemestä." },
  "ice-cream": { title: "Jälkiruokatarjoilu", product: "Vaniljajäätelö", description: "Etsi laktoositonta vaniljajäätelöä suurpakkauksissa." },
  milk: { title: "Maanantain täydennys", product: "Ruokamaito", description: "Suunnittele suuri toimitus laktoositonta maitoa." },
  rehearsal: { title: "Hinnanmuutoksen harjoittelu", product: "Testitilauksen maitokori", description: "Tarkista esimerkkikori, muuta hintaa ja hyväksy päivitetty summa." },
};

function briefCopy(brief: KitchenBrief, locale: Locale) {
  return locale === "fi" ? finnishBriefs[brief.id] ?? brief : brief;
}

function formatActivityDate(value: string, locale: Locale) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : activityDate[locale].format(date);
}

export function DashboardScreen({
  busy, isSimulator, connectedRehearsalEnabled, canReadOrders = isSimulator, currentRequest, savedRequests, recent, onNewRequest,
  onOpenCurrentRequest, onOpenExample, onOpenCatalog, onOpenRequests, onOpenLookup, onOpenHistory,
  onRecover, onOpenRequest,
}: DashboardProps) {
  const { t, locale } = useI18n();
  const featuredBrief = isSimulator ? simulatorBrief : kitchenBriefs[0];
  const rehearsalCopy = briefCopy(simulatorBrief, locale);
  const activity = [
    ...savedRequests.filter(({ id }) => id !== currentRequest?.id)
      .map((request) => ({ kind: "request" as const, date: request.createdAt, request })),
    ...recent.map((receipt) => ({ kind: "order" as const, date: receipt.savedAt, receipt })),
  ].sort((first, second) => second.date.localeCompare(first.date));

  return (
    <div className="dashboard-view">
      <section className="desk-hero" aria-labelledby="overview-title" data-simulator={isSimulator}>
        <div className="desk-intro">
          <h1 id="overview-title">
            {isSimulator ? <><span>{t("Rehearse", "Harjoittele")}</span> <span>{t("an order.", "tilaamista.")}</span></> : <><span>{t("The kitchen", "Keittiön")}</span> <span>{t("buying desk.", "hankintapöytä.")}</span></>}
          </h1>
          <p>{isSimulator
            ? t("Practice reviewing a basket, approving a revision, and issuing a test receipt.", "Harjoittele korin tarkistamista, version hyväksyntää ja testikuitin luomista.")
            : t("Compare Valio Aimo prices and reported stock for your kitchen’s next delivery.", "Vertaa Valio Aimon hintoja ja ilmoitettuja varastosaldoja seuraavaa toimitusta varten.")}</p>
          <div className="desk-actions">
            <Button size="lg" disabled={busy} onClick={onNewRequest}>
              <Plus size={19} aria-hidden="true" /> {t(" New request ", " Uusi pyyntö ")}
            </Button>
            {!isSimulator && <Button size="lg" variant="secondary" disabled={busy} onClick={onOpenCatalog}>
              {t("Browse catalog ", "Selaa tuoteluetteloa ")} <ArrowRight size={17} aria-hidden="true" />
            </Button>}
          </div>
        </div>
        <div className="desk-feature">
          <div className="desk-image">
            <img src={isSimulator ? mondayMilkPhoto : receivingPhoto} alt={isSimulator ? "" : t("Valio Aimo market staff handling produce", "Valio Aimon myymälän työntekijät lajittelevat kasviksia")} fetchPriority="high" />
          </div>
          <button className="feature-ticket" type="button" disabled={busy} onClick={() => onOpenExample(featuredBrief)}>
            <span className="feature-ticket-mark"><ScanLine size={22} aria-hidden="true" /></span>
            <span className="feature-ticket-content">
              <strong>{briefCopy(featuredBrief, locale).title}</strong>
              <small>{featuredBrief.quantityLiters.toLocaleString(locale)} L / {formatEuro(featuredBrief.budgetEuros * 100, locale)}</small>
            </span>
            <ArrowUpRight className="feature-ticket-arrow" size={19} aria-hidden="true" />
          </button>
        </div>
      </section>

      {isSimulator ? (
        <section className="desk-rehearsal" aria-labelledby="rehearsal-title">
          <div>
            <h2 id="rehearsal-title">{rehearsalCopy.title}</h2>
            <p>{rehearsalCopy.description}</p>
          </div>
          <dl>
            <div><dt>{t("Quantity", "Määrä")}</dt><dd>{simulatorBrief.quantityLiters.toLocaleString(locale)} L</dd></div>
            <div><dt>{t("Budget", "Budjetti")}</dt><dd>{formatEuro(simulatorBrief.budgetEuros * 100, locale)}</dd></div>
          </dl>
          <Button variant="secondary" size="md" disabled={busy} onClick={() => onOpenExample(simulatorBrief)}>
            {t("Use this brief ", "Käytä tätä esimerkkiä ")} <ArrowUpRight size={17} aria-hidden="true" />
          </Button>
        </section>
      ) : (
        <section className="brief-library" aria-labelledby="brief-library-title">
          <header className="desk-section-heading">
            <h2 id="brief-library-title">{t("Kitchen briefs", "Keittiön esimerkkipyynnöt")}</h2>
            <p>{t("Start with preset quantities and budgets.", "Aloita valmiilla määrillä ja budjeteilla.")}</p>
          </header>
          <ul className="brief-grid">
            {kitchenBriefs.map((brief) => (
              <li key={brief.id}>
                <button className="brief-card" type="button" disabled={busy} onClick={() => onOpenExample(brief)}>
                  <span className="brief-image"><img src={briefPhotos[brief.id]} alt="" decoding="async" loading="lazy" /></span>
                  <span className="brief-card-details">
                    <span className="brief-card-label">{briefCopy(brief, locale).title}</span>
                    <strong>{briefCopy(brief, locale).product}</strong>
                    <small>{brief.quantityLiters.toLocaleString(locale)} L <span aria-hidden="true">/</span> {formatEuro((brief.mondayMilk && connectedRehearsalEnabled ? rehearsalMilkBudgetEuros : brief.budgetEuros) * 100, locale)}{t(" budget", " budjetti")}</small>
                    <span className="brief-card-arrow"><ArrowUpRight size={19} aria-hidden="true" /></span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="desk-lower">
        <section className="desk-activity" aria-labelledby="activity-title">
          <header className="desk-section-heading">
            <h2 id="activity-title">{t("Recent activity", "Viimeisin toiminta")}</h2>
            <button className="text-action" type="button" onClick={onOpenRequests} disabled={busy}>
              {t("View requests ", "Näytä pyynnöt ")} <ArrowRight size={15} aria-hidden="true" />
            </button>
          </header>
          {!currentRequest && activity.length === 0 ? (
            <div className="activity-empty">
              <span className="stat-icon"><ClipboardList size={21} strokeWidth={1.6} aria-hidden="true" /></span>
              <div><h3>{t("No requests yet", "Ei vielä pyyntöjä")}</h3><p>{t("New purchase requests ", "Uudet hankintapyynnöt ")}{canReadOrders ? t("and simulated orders ", "ja testitilaukset ") : ""}{t("will appear here.", "näkyvät täällä.")}</p></div>
            </div>
          ) : (
            <ul className="activity-list">
              {currentRequest && (
                <li>
                  <button className="activity-row" type="button" disabled={busy} onClick={onOpenCurrentRequest}>
                    <span className="stat-icon"><Package size={18} aria-hidden="true" /></span>
                    <span className="activity-name">
                      <strong>{currentRequest.query}</strong>
                      <small>{formatRequestQuantity(currentRequest, locale)} / {t("Current request", "Nykyinen pyyntö")}</small>
                    </span>
                    <Badge color={currentRequest.status === "Simulated order placed" || currentRequest.status === "Approved" ? "success" : "default"}>
                      {currentRequest.statusLabel ?? currentRequest.status}
                    </Badge>
                    <ArrowUpRight className="activity-arrow" size={16} aria-hidden="true" />
                  </button>
                </li>
              )}
              {activity.slice(0, currentRequest ? 3 : 4).map((item) => item.kind === "order" ? (
                <li key={item.receipt.orderId}>
                  <button className="activity-row" type="button" disabled={busy} onClick={() => onRecover(item.receipt.orderId)}>
                    <span className="stat-icon mint"><FileCheck2 size={18} aria-hidden="true" /></span>
                    <span className="activity-name">
                      <strong>{t("Simulated order", "Testitilaus")}</strong>
                      <small>{formatActivityDate(item.date, locale) ?? item.receipt.orderId}</small>
                    </span>
                    <span className="activity-total">{formatEuro(item.receipt.totalCents, locale)}</span>
                    <ArrowUpRight className="activity-arrow" size={16} aria-hidden="true" />
                  </button>
                </li>
              ) : (
                <li key={item.request.id}>
                  <button className="activity-row" type="button" disabled={busy} onClick={() => onOpenRequest(item.request.id)}>
                    <span className="stat-icon"><Package size={18} aria-hidden="true" /></span>
                    <span className="activity-name">
                      <strong>{item.request.query ?? t("Milk", "Maito")}</strong>
                      <small>{[formatRequestQuantity(item.request, locale), formatActivityDate(item.date, locale)].filter(Boolean).join(" / ")}</small>
                    </span>
                    <ArrowUpRight className="activity-arrow" size={16} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {canReadOrders && recent.length > 0 && (
            <footer className="activity-footer">
              <button className="text-action" type="button" onClick={onOpenHistory} disabled={busy}>
                {t("Order history ", "Tilaushistoria ")} <ArrowRight size={15} aria-hidden="true" />
              </button>
            </footer>
          )}
        </section>
        <section className="desk-tools" aria-labelledby="desk-tools-title">
          <header><h2 id="desk-tools-title">{t("Supplier tools", "Toimittajatyökalut")}</h2></header>
          {!isSimulator && <button type="button" disabled={busy} onClick={onOpenCatalog}>
            <BookOpen size={19} aria-hidden="true" />
            <span><strong>{t("Product catalog", "Tuoteluettelo")}</strong><small>{t("Review pack sizes, allergen declarations and substitutes.", "Tarkasta pakkauskoot, allergeenimerkinnät ja korvaavat tuotteet.")}</small></span>
            <ArrowUpRight size={18} aria-hidden="true" />
          </button>}
          <button type="button" disabled={busy} onClick={onOpenLookup}>
            <Store size={19} aria-hidden="true" />
            <span><strong>{t("Supplier lookup", "Toimittajahaku")}</strong><small>{t("Compare prices, reported stock and cutoffs for up to three dates.", "Vertaa hintoja, ilmoitettuja varastosaldoja ja tilausaikoja enintään kolmelle päivälle.")}</small></span>
            <ArrowUpRight size={18} aria-hidden="true" />
          </button>
        </section>
      </div>
    </div>
  );
}
