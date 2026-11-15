import { useI18n, type Locale, type Translate } from "../i18n";
import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { CalendarDays, ChevronDown, Clock3, CodeXml, CircleAlert, Euro, LoaderCircle, PackageOpen, Plus, Search, X } from "lucide-react";
import { formatEuro } from "../api";
import { catalogPackDescription } from "../catalogProduct";
import { CatalogSuggestions } from "../components/CatalogSuggestions";
import { ProductRequirementOptions } from "../components/ProductRequirementOptions";
import { Button } from "../components/ui";
import type { SupplierLookupDay, SupplierLookupResult } from "../supplierLookup";
import type { ProductRequirement } from "../types";
import "./purchasing-evidence.css";

const maxProducts = 12;
const unknownStockThreshold = 999_999;
const gtinLengths = new Set([8, 12, 13, 14]);
function lookupFormat(locale: Locale) {
  const tag = locale === "fi" ? "fi-FI" : "en-GB";
  return {
    instant: new Intl.DateTimeFormat(tag, { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Helsinki" }),
    day: new Intl.DateTimeFormat(tag, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }),
    supplierDay: new Intl.DateTimeFormat(tag, { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Helsinki" }),
    percent: new Intl.NumberFormat(tag, { style: "percent", maximumFractionDigits: 1 }),
    vatPercent: new Intl.NumberFormat(tag, { style: "percent", maximumFractionDigits: 3 }),
  };
}
const lookupFormats = { en: lookupFormat("en"), fi: lookupFormat("fi") };

const feedLabels = (t: Translate) => ({
  observed: t("Price and availability returned", "Hinta ja saatavuus saatu"),
  partial: t("Partial response", "Osittainen vastaus"),
  unavailable: t("Unavailable", "Ei saatavilla"),
});

const issues = (t: Translate): Record<string, string> => ({
  PRICE_UNUSABLE: t("No usable price for this date.", "Tälle päivälle ei saatu käyttökelpoista hintaa."),
  EMPTY_SCHEDULE: t("Supplier returned no delivery schedule.", "Toimittaja ei ilmoittanut toimitusaikataulua."),
  SALES_BLOCK: t("Sales are blocked.", "Tuotetta ei voi tilata."),
  CUTOFF_PASSED: t("Ordering cutoff has passed.", "Tilausaika on päättynyt."),
  CUTOFF_UNVERIFIED: t("Ordering cutoff is unverified.", "Tilausajan päättymistä ei ole vahvistettu."),
  STOCK_UNKNOWN: t("The supplier quantity is unverified.", "Toimittajan määrää ei ole vahvistettu."),
  STOCK_SHORT: t("Supplier reported zero units.", "Toimittaja ilmoitti varastosaldoksi nolla."),
  DELIVERY_CONFLICT: t("The supplier schedule could not confirm the requested date.", "Toimittajan aikataulu ei vahvistanut pyydettyä päivää."),
  UNIT_MISMATCH: t("The supplier's stock unit differs from the catalog sales unit.", "Toimittajan varastoyksikkö poikkeaa tuoteluettelon myyntiyksiköstä."),
});

function withColonOffset(value: string) {
  return value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
}

function formatInstant(value: string, locale: Locale, t: Translate) {
  const date = new Date(withColonOffset(value));
  return Number.isNaN(date.getTime()) ? null : t(`${lookupFormats[locale].instant.format(date)} Helsinki`, `${lookupFormats[locale].instant.format(date)} Helsingin aikaa`);
}

function dateLabel(value: string, locale: Locale) {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : lookupFormats[locale].day.format(date);
}

function SupplierDay({ value }: { value: string }) {
  const { t, locale } = useI18n();
  const iso = withColonOffset(value);
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return <>{t("Unverified", "Vahvistamaton")}</>;
  return <time dateTime={iso}>{lookupFormats[locale].supplierDay.format(date)}</time>;
}

function feedDescription(day: SupplierLookupDay, t: Translate): string | null {
  if (day.status === "unavailable") return t("No price or availability results.", "Hinta- tai saatavuustietoja ei saatu.");
  if (day.status !== "partial") return null;
  const endpoints = new Set(day.errors.map(({ endpoint }) => endpoint));
  const notes = [];
  if (endpoints.has("price")) notes.push(day.prices.length ? t("Some price records could not be used.", "Osaa hinnoista ei voitu käyttää.") : t("Pricing feed unavailable.", "Hintatietoja ei saatu."));
  if (endpoints.has("availability")) notes.push(day.availability.length ? t("Some availability records could not be used.", "Osaa saatavuustiedoista ei voitu käyttää.") : t("Availability feed unavailable.", "Saatavuustietoja ei saatu."));
  return notes.join(" ") || t("Some supplier data could not be retrieved.", "Osaa toimittajatiedoista ei saatu.");
}

function LookupDateCard({ day, id, salesUnit }: { day: SupplierLookupDay; id: string; salesUnit?: string }) {
  const { t, locale } = useI18n();
  const price = day.prices.find((row) => row.productId === id);
  const stock = day.availability.find((row) => row.productId === id);
  const perUnit = price?.usable ? price.salesUnitPriceExVat?.cents : undefined;
  const taxInclusive = price?.usable ? price.salesUnitPriceIncVat?.cents : undefined;
  const comparison = price?.usable ? price.comparisonPrice?.cents : undefined;
  const list = price?.usable ? price.listPriceExVat?.cents : undefined;
  const tax = price?.usable ? price.taxPerSalesUnitCents : undefined;
  const taxRate = price?.usable ? price.taxRatePercent : undefined;
  const returnedDate = stock?.availableDate;
  const dateDiffers = Boolean(returnedDate && returnedDate !== day.requestedDate);
  const availabilityOutage = !day.availability.length && day.errors.some(({ endpoint }) => endpoint === "availability");
  const priceOutage = !day.prices.length && day.errors.some(({ endpoint }) => endpoint === "price");
  const amount = stock?.availableSellUnits;
  const stockIssues = new Set(stock?.errors.map(({ code }) => code));
  const unitMismatch = stockIssues.has("UNIT_MISMATCH") || Boolean(stock?.salesUnit && salesUnit && stock.salesUnit !== salesUnit);
  const salesBlocked = stock?.salesBlock || stock?.scheduleSalesBlock || stockIssues.has("SALES_BLOCK");
  const cutoffPassed = stock?.cutoffPassed || stockIssues.has("CUTOFF_PASSED");
  const logistics = stock?.logisticModel?.trim();
  const terminal = logistics?.toLowerCase() === "terminal";
  const reliableQuantity = stock && returnedDate && !stock.stockUnknown && !terminal && !unitMismatch && stock.salesUnit
    && amount != null && Number.isFinite(amount) && amount >= 0 && amount < unknownStockThreshold;
  const reportedUnits = reliableQuantity ? `${amount.toLocaleString(locale)} ${stock.salesUnit}` : null;
  const cutoff = stock?.closingTime ? formatInstant(stock.closingTime, locale, t) : null;
  const orderStatus = !stock ? (availabilityOutage ? t("Feed unavailable", "Tietolähde ei saatavilla") : t("Not returned", "Ei ilmoitettu"))
    : salesBlocked ? t("Sales blocked", "Tilaaminen estetty")
      : stockIssues.has("EMPTY_SCHEDULE") ? t("No delivery schedule", "Ei toimitusaikataulua")
        : dateDiffers ? t("Different scheduled date", "Eri toimituspäivä")
          : cutoffPassed ? t("Cutoff passed", "Tilausaika päättynyt")
            : reliableQuantity && amount === 0 ? t("No stock reported", "Ei ilmoitettua varastosaldoa")
              : !returnedDate || !cutoff || stockIssues.has("CUTOFF_UNVERIFIED") || unitMismatch ? t("Unverified", "Vahvistamaton")
                : t("Cutoff open", "Tilausaikaa jäljellä");
  const issueLabels = issues(t);
  const notes = [...new Set([...(price?.errors ?? []), ...(stock?.errors ?? [])].flatMap(({ code, detail }) => {
    if ((code === "DELIVERY_CONFLICT" && dateDiffers) || (code === "STOCK_SHORT" && reportedUnits)
      || (code === "SALES_BLOCK" && salesBlocked) || (code === "CUTOFF_PASSED" && orderStatus === t("Cutoff passed", "Tilausaika päättynyt"))
      || (code === "EMPTY_SCHEDULE" && orderStatus === t("No delivery schedule", "Ei toimitusaikataulua"))) return [];
    if (code === "STOCK_UNKNOWN" && terminal) return [t("Valio does not report quantities for terminal products.", "Valio ei ilmoita terminaalituotteiden määriä.")];
    return [issueLabels[code] ?? detail];
  }))];

  return (
    <section className="lookup-date-card" data-state={day.status} aria-label={t(`Requested date ${dateLabel(day.requestedDate, locale)}`, `Pyydetty päivämäärä ${dateLabel(day.requestedDate, locale)}`)}>
      <header className="lookup-date-card-heading">
        <small>{t("Requested date", "Pyydetty päivämäärä")}</small>
        <h4><time dateTime={day.requestedDate}>{dateLabel(day.requestedDate, locale)}</time></h4>
      </header>
      {day.status === "unavailable" ? <p>{t("No observations for this date.", "Tälle päivälle ei saatu tietoja.")}</p> : (
        <>
          <dl className="lookup-primary-facts">
            <div><dt>{t("Price ex VAT", "Hinta, alv 0 %")}{salesUnit && ` / ${salesUnit}`}</dt><dd>{perUnit != null ? formatEuro(perUnit, locale) : priceOutage ? t("Feed unavailable", "Tietolähde ei saatavilla") : price ? t("Unverified", "Vahvistamaton") : t("Not returned", "Ei ilmoitettu")}</dd></div>
            <div><dt>{t("Reported stock on requested date", "Ilmoitettu varastosaldo pyydettynä päivänä")}</dt><dd>{availabilityOutage ? t("Feed unavailable", "Tietolähde ei saatavilla") : !stock ? t("Not returned", "Ei ilmoitettu") : !dateDiffers && reportedUnits ? reportedUnits : t("Unverified", "Vahvistamaton")}</dd></div>
          </dl>
          <dl className="lookup-secondary-facts">
            <div><dt>{t("Supplier schedule date", "Toimittajan ilmoittama toimituspäivä")}</dt><dd>{returnedDate ? <time dateTime={returnedDate}>{dateLabel(returnedDate, locale)}</time> : availabilityOutage ? t("Feed unavailable", "Tietolähde ei saatavilla") : t("Not returned", "Ei ilmoitettu")}</dd></div>
            {dateDiffers && reportedUnits && <div><dt>{t("Stock on schedule date", "Varastosaldo ilmoitettuna toimituspäivänä")}</dt><dd>{reportedUnits}</dd></div>}
            <div><dt>{t("Ordering status", "Tilattavuus")}</dt><dd className="lookup-order-status" data-alert={Boolean(salesBlocked || cutoffPassed)}>{orderStatus}</dd></div>
            <div><dt>{t("Ordering cutoff", "Tilausajan päättyminen")}</dt><dd>{cutoff && stock?.closingTime ? <time dateTime={withColonOffset(stock.closingTime)}>{cutoff}</time> : availabilityOutage ? t("Feed unavailable", "Tietolähde ei saatavilla") : t("Unverified", "Vahvistamaton")}</dd></div>
            {logistics && <div><dt>{t("Logistics model", "Logistiikkamalli")}</dt><dd>{terminal ? t("Terminal (supplier warehouse)", "Terminaali (toimittajan varasto)") : logistics}</dd></div>}
          </dl>
          {(dateDiffers || notes.length > 0) && (
            <ul className="lookup-date-notes" aria-label={t("Evidence gaps", "Puuttuvat tiedot")}>
              {dateDiffers && <li>{t("Supplier returned a different date.", "Toimittaja ilmoitti eri päivämäärän.")}</li>}
              {notes.map((note) => <li key={note}>{note}</li>)}
            </ul>
          )}
          {price?.usable && (
            <details className="lookup-price-details">
              <summary>{t("Price details", "Hintatiedot")}</summary>
              <dl className="lookup-secondary-facts">
                {taxInclusive != null && <div><dt>{t("Price incl. VAT", "Verollinen hinta")}</dt><dd>{formatEuro(taxInclusive, locale)}</dd></div>}
                {taxRate != null && <div><dt>{t("VAT rate", "ALV-kanta")}</dt><dd>{lookupFormats[locale].vatPercent.format(taxRate / 100)}</dd></div>}
                {tax != null && <div><dt>{t("VAT per sales unit", "ALV myyntiyksikköä kohden")}</dt><dd>{formatEuro(tax, locale)}</dd></div>}
                {comparison != null && price?.comparisonUnit && <div><dt>{t("Comparison price ex VAT", "Vertailuhinta, alv 0 %")}</dt><dd>{formatEuro(comparison, locale)} / {price.comparisonUnit === "KG" ? "kg" : "L"}</dd></div>}
                {list != null && list !== perUnit && <div><dt>{t("List price ex VAT", "Listahinta, alv 0 %")}</dt><dd>{formatEuro(list, locale)}</dd></div>}
                {price.pricingDate && <div><dt>{t("Supplier pricing date", "Toimittajan hinnoittelupäivä")}</dt><dd><SupplierDay value={price.pricingDate} /></dd></div>}
                {price.validFrom && <div><dt>{t("Unit price valid from", "Yksikköhinta voimassa alkaen")}</dt><dd><SupplierDay value={price.validFrom} /></dd></div>}
                {price.validTo && <div><dt>{t("Unit price valid through", "Yksikköhinta voimassa asti")}</dt><dd><SupplierDay value={price.validTo} /></dd></div>}
                <div><dt>{t("Challenge net price found", "Haasteen nettohinta löytyi")}</dt><dd>{price.netPriceFound ? t("Yes", "Kyllä") : t("No", "Ei")}</dd></div>
              </dl>
            </details>
          )}
        </>
      )}
    </section>
  );
}

export function LookupResults({ result }: { result: SupplierLookupResult }) {
  const { t, locale } = useI18n();
  const reducedMotion = useReducedMotion();
  return (
    <motion.section
      className="evidence-panel lookup-results"
      aria-labelledby="lookup-results-title"
      initial={reducedMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: reducedMotion ? 0 : .22 }}
    >
      <div className="evidence-panel-heading">
        <div>
          <h2 id="lookup-results-title" tabIndex={-1}>{t("Supplier results", "Toimittajan tulokset")}</h2>
          <p>{result.source === "FIXTURE_OBSERVATION" ? t("Sample observations.", "Esimerkkihavainnot.") : t("Valio Aimo challenge API.", "Valio Aimon haasterajapinta.")}{t(" Stock is unreserved and delivery times are unconfirmed.", " Tuotteita ei ole varattu eikä toimitusaikoja vahvistettu.")}</p>
        </div>
      </div>
      {result.error && <p className="evidence-note evidence-note--attention" role="alert"><CircleAlert size={17} aria-hidden="true" />{result.error}</p>}
      <ul className="lookup-date-grid lookup-feed-list" aria-label={t("Supplier feeds by requested date", "Toimittajan tiedot pyydetyille päiville")}>
        {result.days.map((day) => {
          const description = feedDescription(day, t);
          const checkedAt = formatInstant(day.source.observedAt, locale, t);
          const supplierClock = day.availability.find(({ timeNow }) => timeNow)?.timeNow;
          const supplierTime = supplierClock ? formatInstant(supplierClock, locale, t) : null;
          return (
            <li key={day.requestedDate} data-state={day.status}>
              <CalendarDays size={18} aria-hidden="true" />
              <div>
                <strong><time dateTime={day.requestedDate}>{dateLabel(day.requestedDate, locale)}</time></strong>
                <span className="lookup-feed-status">{feedLabels(t)[day.status]}</span>
                {description && <p>{description}</p>}
                {checkedAt && <small>{t("Checked ", "Tarkistettu ")}<time dateTime={day.source.observedAt}>{checkedAt}</time></small>}
                {supplierTime && supplierClock && <small>{t("Supplier response time ", "Toimittajan vastausaika ")}<time dateTime={withColonOffset(supplierClock)}>{supplierTime}</time></small>}
              </div>
            </li>
          );
        })}
      </ul>
      {!result.error && <ul className="lookup-result-list" aria-label={t("Products checked", "Tarkistetut tuotteet")}>
        {result.productIds.map((id) => {
          const product = result.shortlist.find(({ product }) => product.id === id)?.product;
          const name = product?.displayName ?? t(`SKU ${id}`, `Tuotenumero ${id}`);
          const signal = result.signals.find(({ productId }) => productId === id);
          const reliability = signal?.reliability.present ? signal.reliability.value : null;
          const carbon = signal?.carbonKgCo2ePerKg.present ? signal.carbonKgCo2ePerKg.value : null;
          const packLabel = product?.amountDimension && product.amountPerSellUnit !== undefined
            ? catalogPackDescription({ amountDimension: product.amountDimension, amountPerSellUnit: product.amountPerSellUnit }, locale) : null;
          return (
            <li key={id}>
              <div><h3>{name}</h3><small className="lookup-product-id">{t("SKU ", "Tuotenumero ")}{id}{packLabel && ` · ${packLabel}`}</small></div>
              {(reliability != null || carbon != null) && <dl className="lookup-history">
                {reliability != null && <div><dt>{t("Historical delivery reliability", "Aiempi toimitusvarmuus")}</dt><dd>{lookupFormats[locale].percent.format(reliability)}</dd></div>}
                {carbon != null && <div><dt>{t("Product group carbon estimate", "Tuoteryhmän arvioitu hiilijalanjälki")}</dt><dd>{carbon.toLocaleString(locale)} kg CO₂e/kg</dd></div>}
              </dl>}
              <div className="lookup-date-grid">
                {result.days.map((day) => <LookupDateCard key={day.requestedDate} day={day} id={id} salesUnit={product?.salesUnit} />)}
              </div>
            </li>
          );
        })}
      </ul>}
      <details className="lookup-response">
        <summary>
          <CodeXml size={17} aria-hidden="true" />
          <span>{t("Lookup evidence JSON", "Haun lähdetiedot (JSON)")}</span>
          <ChevronDown size={17} aria-hidden="true" />
        </summary>
        <pre tabIndex={0} aria-label={t("Lookup evidence JSON", "Haun lähdetiedot (JSON)")}>{JSON.stringify(result, null, 2)}</pre>
      </details>
    </motion.section>
  );
}

export function SupplierLookupScreen({ busy, date, result, initialSkus, onDate, onLookup }: {
  busy: boolean;
  date: string;
  result: SupplierLookupResult | null;
  initialSkus?: string[];
  onDate: (value: string) => void;
  onLookup: (productIds: string[], requestedDates: string[]) => void;
}) {
  const { t } = useI18n();
  const savedResultIds = result?.productIds;
  const [productIds, setProductIds] = useState(() =>
    savedResultIds ?? initialSkus ?? [],
  );
  const [additionalDates, setAdditionalDates] = useState<string[]>(() => result?.days.slice(1).map(({ requestedDate }) => requestedDate) ?? []);
  const [dateError, setDateError] = useState("");
  const dates = [date, ...additionalDates];
  const [skuText, setSkuText] = useState("");
  const [skuError, setSkuError] = useState("");
  const [requirements, setRequirements] = useState<ProductRequirement[]>([]);
  const [productNames, setProductNames] = useState<Record<string, string>>({});
  const input = skuText.trim();
  const enteredSkus = /^(?=.*\d)[\d\s,;]+$/.test(input) ? input.split(/[\s,;]+/).filter(Boolean) : [];
  const hasBarcode = enteredSkus.some((id) => gtinLengths.has(id.length));
  const needsCatalogMatch = requirements.length > 0 || hasBarcode;
  const directSkuEntry = enteredSkus.length > 0 && !needsCatalogMatch;
  const multipleCatalogCodes = needsCatalogMatch && enteredSkus.length > 1;
  const skuField = useRef<HTMLInputElement>(null);
  const dateFields = useRef(new Map<number, HTMLInputElement>());
  const resultLocation = useRef<HTMLDivElement>(null);
  const focusResults = useRef(false);
  const focusNewDate = useRef(false);
  const reducedMotion = useReducedMotion();
  const showingResult = result && savedResultIds?.join(",") === productIds.join(",") && !skuText.trim()
    && result.days.map(({ requestedDate }) => requestedDate).join(",") === dates.join(",");

  useEffect(() => {
    if (focusResults.current && showingResult) {
      resultLocation.current?.querySelector("h2")?.focus();
      focusResults.current = false;
    }
  }, [showingResult]);

  useEffect(() => {
    if (focusNewDate.current) {
      dateFields.current.get(additionalDates.length)?.focus();
      focusNewDate.current = false;
    }
  }, [additionalDates.length]);

  function collectIds() {
    const next = [...new Set([...productIds, ...enteredSkus])];
    if (enteredSkus.some((id) => id.length > 32)) {
      setSkuError(t("A product SKU can contain up to 32 digits.", "Tuotenumerossa voi olla enintään 32 numeroa."));
      skuField.current?.focus();
      return null;
    }
    if (next.length > maxProducts) {
      setSkuError(t(`Choose up to ${maxProducts} products per lookup.`, `Valitse enintään ${maxProducts} tuotetta hakua kohden.`));
      skuField.current?.focus();
      return null;
    }
    if (enteredSkus.every((id) => productIds.includes(id))) {
      setSkuError(t("Those SKUs are already selected.", "Nämä tuotteet on jo valittu."));
      skuField.current?.focus();
      return null;
    }
    setSkuError("");
    setSkuText("");
    setProductIds(next);
    return next;
  }

  return (
    <div className="view-enter evidence-view supplier-lookup-view">
      <header className="evidence-page-heading">
        <div>
          <h1>{t("Supplier lookup", "Toimittajahaku")}</h1>
          <p>{t("Check up to three delivery dates against Valio Aimo supplier data.", "Tarkista enintään kolmen toimituspäivän tiedot Valio Aimolta.")}</p>
        </div>
      </header>
      <div className="lookup-workbench" data-has-results={Boolean(showingResult)}>
        <form className="evidence-panel lookup-form" onSubmit={(event) => {
          event.preventDefault();
          if (dates.some((day) => !day) || busy) return;
          if (new Set(dates).size !== dates.length) {
            setDateError(t("Choose a different date for each check.", "Valitse jokaiselle tarkistukselle eri päivämäärä."));
            dateFields.current.get(dates.findIndex((day, index) => dates.indexOf(day) !== index))?.focus();
            return;
          }
          setDateError("");
          const ids = directSkuEntry ? collectIds() : productIds;
          if (ids?.length) {
            setSkuText("");
            setSkuError("");
            focusResults.current = true;
            onLookup(ids, dates);
          }
        }}>
          <div className="evidence-panel-heading">
            <h2>{t("Products and dates", "Tuotteet ja päivämäärät")}</h2>
            <span className="evidence-icon"><CalendarDays size={21} aria-hidden="true" /></span>
          </div>
          <div className="lookup-form-fields">
            <div className="lookup-products-field">
              <div className="lookup-sku-entry">
                <label className="request-field">
                  <span>{t("Find products by name, SKU or barcode", "Etsi tuotteita nimellä, tuotenumerolla tai viivakoodilla")}</span>
                  <input
                    ref={skuField}
                    type="text" autoComplete="off" maxLength={250}
                    value={skuText} disabled={busy}
                    placeholder={t("e.g. gluten-free bread or 463038", "esim. gluteeniton leipä tai 463038")}
                    aria-describedby={skuError ? "lookup-sku-hint lookup-sku-error" : "lookup-sku-hint"}
                    aria-invalid={skuError ? true : undefined}
                    onChange={(event) => { setSkuText(event.target.value); setSkuError(""); }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.nativeEvent.isComposing && input) {
                        event.preventDefault();
                        if (directSkuEntry) collectIds();
                      }
                    }}
                  />
                </label>
                {requirements.length === 0 && <Button variant="secondary" ariaLabel={t("Add SKU", "Lisää tuotenumero")} onClick={() => { collectIds(); skuField.current?.focus(); }} disabled={busy || !directSkuEntry}>
                  <Plus size={16} aria-hidden="true" /> <span>{t("Add SKU", "Lisää tuotenumero")}</span>
                </Button>}
              </div>
              <p id="lookup-sku-hint" className="lookup-sku-hint">{needsCatalogMatch
                ? t("Search by name, or enter one SKU or barcode at a time and choose a match.", "Hae nimellä tai syötä yksi tuotenumero tai viivakoodi kerrallaan ja valitse osuma.")
                : t(`Choose a product from the matches, or add up to ${maxProducts} SKUs separated by spaces or commas.`, `Valitse tuote hakutuloksista tai lisää enintään ${maxProducts} tuotenumeroa välilyönneillä tai pilkuilla erotettuina.`)}</p>
              <div className="lookup-requirements">
                <ProductRequirementOptions selected={requirements} disabled={busy} help={t("Search matches products with every selected declaration.", "Haku näyttää tuotteet, joilla on kaikki valitut merkinnät.")} onChange={(next) => {
                  setRequirements(next);
                  setSkuError("");
                }} />
              </div>
              {skuError && <div className="evidence-note evidence-note--attention" role="alert" id="lookup-sku-error"><CircleAlert size={16} aria-hidden="true" />{skuError}</div>}
              {multipleCatalogCodes && <p className="lookup-sku-hint" role="status">{t("Enter one SKU or barcode at a time to find matching catalog products.", "Syötä yksi tuotenumero tai viivakoodi kerrallaan löytääksesi vastaavat tuotteet.")}</p>}
              {!directSkuEntry && !multipleCatalogCodes && (input.length > 120 ? <p className="lookup-sku-hint" role="status">{t("Use up to 120 characters for a product name.", "Tuotteen nimessä voi olla enintään 120 merkkiä.")}</p>
                : <CatalogSuggestions query={enteredSkus[0] ?? input} requirements={requirements} excludedIds={productIds} disabled={busy || productIds.length >= maxProducts}
                    actionLabel="Add product" onSelect={(product) => {
                      setProductIds((previous) => [...previous, product.id]);
                      setProductNames((previous) => ({ ...previous, [product.id]: product.name }));
                      setSkuError("");
                      skuField.current?.focus();
                    }} />)}
              {productIds.length >= maxProducts && <p className="lookup-sku-hint" role="status">{t("You’ve added ", "Olet lisännyt ")}{maxProducts}{t(" products. Remove one to add another.", " tuotetta. Poista yksi lisätäksesi uuden.")}</p>}
              <ul className="lookup-items" aria-label={t("Selected products", "Valitut tuotteet")}>
                {productIds.map((id) => (
                  <motion.li
                    key={id} layout={reducedMotion ? undefined : "position"}
                    initial={reducedMotion ? false : { opacity: 0, scale: .9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: .18 }}
                  >
                    <strong>{productNames[id] ?? result?.shortlist.find(({ product }) => product.id === id)?.product.displayName ?? t(`SKU ${id}`, `Tuotenumero ${id}`)}
                      {(productNames[id] || result?.shortlist.some(({ product }) => product.id === id)) && <small className="lookup-product-id"> · {id}</small>}
                    </strong>
                    <button className="comparison-remove" type="button" aria-label={t(`Remove SKU ${id}`, `Poista tuotenumero ${id}`)} disabled={busy} onClick={() => {
                      setProductIds((previous) => previous.filter((item) => item !== id));
                      setSkuError("");
                      skuField.current?.focus();
                    }}><X size={15} aria-hidden="true" /></button>
                  </motion.li>
                ))}
              </ul>
            </div>
            <div className="lookup-date-fields">
              {dates.map((day, index) => (
                <motion.div className="lookup-date-field" key={index}
                  initial={reducedMotion || index === 0 ? false : { opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }} transition={{ duration: reducedMotion ? 0 : .22 }}>
                  <label className="request-field">
                    <span>{index === 0 ? t("Requested delivery date", "Pyydetty toimituspäivä") : t(`Additional date ${index}`, `Lisäpäivä ${index}`)}</span>
                    <input type="date" ref={(node) => { if (node) dateFields.current.set(index, node); else dateFields.current.delete(index); }}
                      value={day} aria-invalid={dateError ? true : undefined} aria-describedby={dateError ? "lookup-date-error" : undefined}
                      onChange={(event) => {
                      const value = event.target.value;
                      setDateError("");
                      if (index === 0) onDate(value);
                      else setAdditionalDates((current) => current.map((item, i) => i === index - 1 ? value : item));
                    }} disabled={busy} required />
                  </label>
                  {index > 0 && <Button variant="secondary" size="md" ariaLabel={t(`Remove additional date ${index}`, `Poista lisäpäivä ${index}`)} disabled={busy} onClick={() => {
                    setDateError("");
                    setAdditionalDates((current) => current.filter((_, i) => i !== index - 1));
                    dateFields.current.get(index - 1)?.focus();
                  }}><X size={16} aria-hidden="true" /></Button>}
                </motion.div>
              ))}
              {dateError && <p className="evidence-note evidence-note--attention" role="alert" id="lookup-date-error">{dateError}</p>}
              {dates.length < 3 && <Button variant="tertiary" size="md" disabled={busy} onClick={() => {
                focusNewDate.current = true;
                setAdditionalDates((current) => [...current, ""]);
              }}>
                <Plus size={16} aria-hidden="true" /> {t(" Compare another date ", " Vertaa toista päivää ")}
              </Button>}
            </div>
          </div>
          <div className="lookup-actions">
            <Button type="submit" size="md" disabled={busy || dates.some((day) => !day) || (!productIds.length && !directSkuEntry)}>
              {busy ? <LoaderCircle className="intake-spinner" size={16} aria-hidden="true" /> : <Search size={16} aria-hidden="true" />}
              {busy ? t("Checking…", "Tarkistetaan…") : t("Check supplier data", "Tarkista toimittajatiedot")}
            </Button>
          </div>
        </form>
        <div className="lookup-output" aria-busy={busy} ref={resultLocation}>
          {showingResult ? <LookupResults result={result} /> : busy ? (
            <div className="lookup-loading" aria-hidden="true"><span /><span /></div>
          ) : (
            <section className="evidence-panel lookup-empty" aria-labelledby="lookup-empty-title">
              <h2 id="lookup-empty-title">{t("Supplier results", "Toimittajan tulokset")}</h2>
              <p>{t("Results show the requested date alongside the date returned by the supplier.", "Tuloksissa näkyvät pyytämäsi ja toimittajan ilmoittama päivämäärä.")}</p>
              <ul className="lookup-empty-fields" aria-label={t("Result fields", "Tuloksen kentät")}>
                <li><Euro size={18} aria-hidden="true" />{t(" Price per sales unit", " Hinta myyntiyksikköä kohden")}</li>
                <li><PackageOpen size={18} aria-hidden="true" />{t(" Reported stock", " Ilmoitettu varastosaldo")}</li>
                <li><Clock3 size={18} aria-hidden="true" />{t(" Ordering cutoff", " Tilausajan päättyminen")}</li>
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
