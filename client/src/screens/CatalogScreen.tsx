import { useI18n, type Translate } from "../i18n";
import { useEffect, useRef, useState } from "react";
import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUpRight, ChevronDown, CircleAlert, CircleCheck, Droplets,
  PackageOpen, Search, SlidersHorizontal, Sparkles, TriangleAlert, X,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { getCatalogProducts } from "../api";
import { describeConversion, describeMismatch } from "../catalogMismatch";
import { catalogPackDescription } from "../catalogProduct";
import orangePhoto from "../assets/cafe-orange.jpg";
import stockPhoto from "../assets/vegetable-stock.jpg";
import iceCreamPhoto from "../assets/vanilla-ice-cream.jpg";
import { CatalogEvidence } from "../components/CatalogEvidence";
import { AllergenOptions } from "../components/AllergenOptions";
import { ProductRequirementOptions } from "../components/ProductRequirementOptions";
import { Button } from "../components/ui";
import { formatProductRequirements } from "../productRequirements";
import type { CatalogFilters, CatalogProduct, CatalogSearchResult, ProductRequirement } from "../types";
import "./catalog.css";

const PAGE_SIZE = 12;
const MAX_PRODUCTS = 48;

const shortcuts = (t: Translate) => [
  { label: t("Orange juice", "Appelsiinimehu"), query: "100% orange juice", photo: orangePhoto },
  { label: t("Vegetable stock", "Kasvisliemi"), query: "Puljonki vegetable bouillon", photo: stockPhoto },
  { label: t("Vanilla ice cream", "Vaniljajäätelö"), query: "vanilla 5l ice cream", photo: iceCreamPhoto },
  { label: t("Cooking cream", "Ruokakerma"), query: "cooking cream" },
];

type CatalogResults = CatalogSearchResult & { query: string; filters: CatalogFilters };

const noFilters: CatalogFilters = { requirements: [], amountDimension: "", freeFromAllergen: [] };
interface CatalogScreenProps {
  initialSku?: string;
  onUseProduct: (product: CatalogProduct, requirements: ProductRequirement[], freeFromAllergen: string[]) => void;
  onCheckSku: (sku: string) => void;
  onBackToComparison?: () => void;
}

export function CatalogScreen({ initialSku, onUseProduct, onCheckSku, onBackToComparison }: CatalogScreenProps) {
  const { t, locale } = useI18n();
  const [query, setQuery] = useState(initialSku ?? "");
  const [filters, setFilters] = useState(noFilters);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [requestedAgain, setRequestedAgain] = useState(0);
  const [result, setResult] = useState<CatalogResults | null>(null);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState("");
  const [expandedProduct, setExpandedProduct] = useState<string | null>(initialSku ?? null);
  const searchField = useRef<HTMLInputElement>(null);
  const resultsHeading = useRef<HTMLHeadingElement>(null);
  const focusProduct = useRef<string | null>(initialSku ?? null);
  const reduceMotion = useReducedMotion();
  const search = query.trim();
  const displayed = result?.query === search && result.filters === filters ? result : null;
  const advancedFilterCount = Number(Boolean(filters.amountDimension)) + filters.freeFromAllergen.length;
  const activeFilterCount = filters.requirements.length + advancedFilterCount;
  const effectiveRequirements = displayed?.requirements ?? [];
  const closestOnly = displayed?.exactMatch === false && displayed.products.length > 0;

  useEffect(() => {
    const controller = new AbortController();
    const searchTimer = window.setTimeout(async () => {
      try {
        const data = await getCatalogProducts(search, limit, filters, controller.signal, { closest: true });
        if (!controller.signal.aborted) setResult({ ...data, query: search, filters });
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : t("The product catalog could not be loaded.", "Tuoteluetteloa ei voitu ladata."));
        }
      } finally {
        if (!controller.signal.aborted) setPending(false);
      }
    }, search ? 210 : 0);
    return () => {
      window.clearTimeout(searchTimer);
      controller.abort();
    };
  }, [search, limit, requestedAgain, filters]);

  useEffect(() => {
    if (focusProduct.current && displayed?.products.some(({ id }) => id === focusProduct.current)) {
      document.getElementById(`catalog-trigger-${focusProduct.current}`)?.focus();
      focusProduct.current = null;
    }
  }, [displayed]);

  function resetView() {
    setLimit(PAGE_SIZE);
    setError("");
    setPending(true);
    setExpandedProduct(null);
    focusProduct.current = null;
  }

  function updateQuery(next: string) {
    if (next.trim() !== search) resetView();
    setQuery(next);
  }

  function updateFilters(next: CatalogFilters) {
    resetView();
    setFilters(next);
  }

  function loadMore() {
    setError("");
    setPending(true);
    setLimit((current) => Math.min(current + PAGE_SIZE, MAX_PRODUCTS));
  }

  function retry() {
    setError("");
    setPending(true);
    setRequestedAgain((current) => current + 1);
  }

  function openLinkedProduct(id: string) {
    if (id === search && !activeFilterCount && limit === PAGE_SIZE) {
      focusProduct.current = id;
      setExpandedProduct(id);
      if (displayed?.products.some((product) => product.id === id)) {
        document.getElementById(`catalog-trigger-${id}`)?.focus();
        focusProduct.current = null;
      }
      return;
    }
    resetView();
    focusProduct.current = id;
    setQuery(id);
    setFilters(noFilters);
    setExpandedProduct(id);
    resultsHeading.current?.focus({ preventScroll: true });
  }

  return (
    <div className="catalog-view">
      <header className="catalog-header">
        <div>
          {onBackToComparison && <button type="button" className="text-action catalog-back" onClick={onBackToComparison}>
            <ArrowLeft size={15} aria-hidden="true" /> {t(" Back to comparison ", " Takaisin vertailuun ")}
          </button>}
          <h1>{t("Product catalog", "Tuoteluettelo")}</h1>
          <p className="catalog-description">{t("Find ingredients, compare pack sizes, and review supplier declarations.", "Etsi raaka-aineita, vertaile pakkauskokoja ja tarkista toimittajan tuotemerkinnät.")}</p>
        </div>
      </header>

      <div className="catalog-tools">
        <section className="catalog-search-panel" role="search" aria-label={t("Find products", "Etsi tuotteita")}>
          <label className="catalog-search-title" htmlFor="catalog-query">{t("Find an ingredient", "Etsi raaka-ainetta")}</label>
          <div className="catalog-search">
            <Search aria-hidden="true" size={20} strokeWidth={1.7} />
            <input
              id="catalog-query"
              type="search"
              ref={searchField}
              placeholder={t("Product name or SKU, e.g. gluten-free bread", "Tuotteen nimi tai tuotenumero, esim. gluteeniton leipä")}
              value={query}
              maxLength={120}
              autoComplete="off"
              onChange={({ target }) => updateQuery(target.value)}
            />
            {query && (
              <button type="button" aria-label={t("Clear search", "Tyhjennä haku")} onClick={() => { updateQuery(""); searchField.current?.focus(); }}>
                <X size={18} aria-hidden="true" />
              </button>
            )}
          </div>
          <ProductRequirementOptions selected={filters.requirements}
            onChange={(requirements) => updateFilters({ ...filters, requirements })} />
          <details className="catalog-filter-tools">
            <summary><SlidersHorizontal size={16} aria-hidden="true" />{t(" More filters ", " Lisää suodattimia ")}{advancedFilterCount > 0 && <span>{advancedFilterCount}{t(" active", " käytössä")}</span>}<ChevronDown size={15} aria-hidden="true" /></summary>
            <label className="catalog-filter-field">
              {t("Pack measurement ", "Pakkauksen mittayksikkö ")}
              <select value={filters.amountDimension} onChange={({ target }) => updateFilters({ ...filters, amountDimension: target.value as CatalogFilters["amountDimension"] })}>
                <option value="">{t("Any pack measurement", "Kaikki pakkausmitat")}</option>
                <option value="ml">{t("Volume in the catalog", "Tilavuus tuoteluettelossa")}</option>
                <option value="g">{t("Weight in the catalog", "Paino tuoteluettelossa")}</option>
                <option value="unmapped">{t("No catalog volume or weight", "Ei ilmoitettua tilavuutta tai painoa")}</option>
              </select>
            </label>
            <AllergenOptions selected={filters.freeFromAllergen} onChange={(freeFromAllergen) => updateFilters({ ...filters, freeFromAllergen })} />
          </details>
          {activeFilterCount > 0 && <button className="catalog-clear-filters" type="button" onClick={() => updateFilters(noFilters)}>{t("Clear filters", "Tyhjennä suodattimet")}</button>}
        </section>

        <section className="catalog-suggestions" aria-labelledby="catalog-suggestion-title">
          <h2 id="catalog-suggestion-title">{t("Suggested searches", "Hakuehdotukset")}</h2>
          <div className="catalog-shortcuts">
            {shortcuts(t).map(({ label, query: preset, photo }) => (
              <motion.button
                key={preset}
                type="button"
                aria-pressed={search === preset}
                onClick={() => updateQuery(search === preset ? "" : preset)}
                whileTap={reduceMotion ? undefined : { scale: 0.975 }}
              >
                <span className="catalog-shortcut-visual" aria-hidden="true">
                  {photo ? <img src={photo} alt="" decoding="async" /> : <Droplets size={29} strokeWidth={1.2} />}
                  <span className="catalog-shortcut-arrow"><ArrowUpRight size={13} /></span>
                </span>
                <span className="catalog-shortcut-label">{label}</span>
              </motion.button>
            ))}
          </div>
        </section>
      </div>

      <section className="catalog-results" aria-labelledby="catalog-results-heading">
        <header className="catalog-results-heading">
          <h2 id="catalog-results-heading" ref={resultsHeading} tabIndex={-1}>{search ? t("Search results", "Hakutulokset") : t("Browse products", "Selaa tuotteita")}</h2>
          <p aria-live="polite" role="status">
            {pending ? t("Searching catalog…", "Haetaan tuoteluettelosta…") : closestOnly
              ? t(`No exact match · ${displayed?.products.length} closest ${displayed?.products.length === 1 ? "option" : "options"}`, `Ei tarkkaa osumaa · ${displayed?.products.length} lähintä vaihtoehtoa`)
              : displayed
              ? `${displayed.hasMore ? t("Showing first ", "Näytetään ensin ") : ""}${displayed.products.length} ${t(displayed.products.length === 1 ? "product" : "products", displayed.products.length === 1 ? "tuote" : "tuotetta")}${effectiveRequirements.length ? t(` · Required: ${formatProductRequirements(effectiveRequirements, locale)}`, ` · Vaatimus: ${formatProductRequirements(effectiveRequirements, locale)}`) : ""}`
              : ""}
          </p>
        </header>
        {error && (
          <div className="catalog-alert" role="alert">
            <CircleAlert size={18} aria-hidden="true" />
            <span>{error}</span>
            <Button variant="secondary" onClick={retry}>{t("Retry search", "Hae uudelleen")}</Button>
          </div>
        )}
        <div className="catalog-result-content" aria-busy={pending}>
          {pending && !displayed && <div className="catalog-skeleton" aria-hidden="true"><span /><span /><span /></div>}
          {displayed?.products.length === 0 && (
            <div className="catalog-empty">
              <PackageOpen size={30} strokeWidth={1.5} aria-hidden="true" />
              <h3>{t("No products found", "Tuotteita ei löytynyt")}</h3>
              <p>{activeFilterCount ? t("No products match every selected filter. Clear filters or try a different search.", "Yksikään tuote ei vastaa kaikkia valittuja suodattimia. Tyhjennä suodattimet tai kokeile toista hakua.")
                : effectiveRequirements.length ? t("No matching products have declarations for all requirements in your search. Try a shorter ingredient name or another product.", "Yhdelläkään tuotteella ei ole merkintöjä kaikista hakusi vaatimuksista. Kokeile lyhyempää nimeä tai toista tuotetta.")
                  : t("Try a shorter name, a Finnish product name, or a SKU.", "Kokeile lyhyempää nimeä, suomenkielistä tuotenimeä tai tuotenumeroa.")}</p>
              {activeFilterCount > 0 && <Button variant="secondary" onClick={() => updateFilters(noFilters)}>{t("Clear catalog filters", "Tyhjennä tuoteluettelon suodattimet")}</Button>}
              {query && <Button variant="secondary" onClick={() => { updateQuery(""); searchField.current?.focus(); }}>{t("Clear search", "Tyhjennä haku")}</Button>}
            </div>
          )}
          {closestOnly && (
            <div className="catalog-closest-banner" role="note">
              <CircleAlert size={20} aria-hidden="true" />
              <div>
                <strong>{t("No exact match", "Ei tarkkaa osumaa")}{search ? t(` for “${search}”`, ` haulle ”${search}”`) : ""}</strong>
                <p>{t("These are the best options available. Each one lists what's different, so check it before you use it.", "Nämä ovat parhaat saatavilla olevat vaihtoehdot. Tarkista tuotteen erot ennen käyttöä.")}</p>
              </div>
            </div>
          )}
          {displayed && displayed.products.length > 0 && (
            <motion.ul
              key={`${displayed.query}:${JSON.stringify(displayed.filters)}`}
              initial={reduceMotion ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: reduceMotion ? 0 : 0.18 }}
              className="catalog-list"
            >
              {displayed.products.map((product, position) => {
                const expanded = expandedProduct === product.id;
                const productDetails = `catalog-details-${product.id}`;
                const best = closestOnly && position === 0;
                const differences = closestOnly ? product.mismatches ?? [] : [];
                return (
                  <li key={product.id} className="catalog-product" data-expanded={expanded} data-best={best || undefined}>
                    <button
                      className="catalog-product-trigger"
                      id={`catalog-trigger-${product.id}`}
                      type="button"
                      aria-expanded={expanded}
                      aria-controls={expanded ? productDetails : undefined}
                      onClick={() => setExpandedProduct(expanded ? null : product.id)}
                    >
                      <span className="catalog-product-name">
                        {best && <span className="catalog-best-badge"><Sparkles size={13} aria-hidden="true" />{t(" Best available match", " Paras saatavilla oleva vaihtoehto")}</span>}
                        <strong>{product.name}</strong>
                        <small>{t("SKU ", "Tuotenumero ")}{product.id}{product.supplier && ` · ${product.supplier}`}</small>
                      </span>
                      <span className="catalog-pack">
                        {catalogPackDescription(product, locale)}
                        {product.conversion && <small className="catalog-conversion">{describeConversion(product.conversion, locale)}</small>}
                      </span>
                      <span className="catalog-product-disclosure" aria-hidden="true">
                        <ChevronDown size={18} />
                      </span>
                    </button>
                    {differences.length > 0 && (
                      <ul className="catalog-mismatches" aria-label={t(`How ${product.name} differs from your search`, `Miten ${product.name} poikkeaa haustasi`)}>
                        {differences.map((mismatch, index) => {
                          const { text, risk } = describeMismatch(mismatch, locale);
                          return (
                            <li key={index} data-risk={risk ? "health" : undefined}>
                              {risk ? <TriangleAlert size={15} aria-hidden="true" /> : <CircleAlert size={15} aria-hidden="true" />}
                              <span>{text}{risk && <strong> {risk}</strong>}</span>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    <AnimatePresence initial={false}>
                      {expanded && (
                        <motion.div
                          key={productDetails}
                          id={productDetails}
                          initial={reduceMotion ? false : { height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={reduceMotion ? { opacity: 1 } : { height: 0, opacity: 0 }}
                          transition={{ duration: reduceMotion ? 0 : 0.28, ease: [.22, 1, .36, 1] }}
                        >
                          <div className="catalog-product-details">
                            <div>
                              {product.requirements.length > 0 && <strong className="catalog-claim"><CircleCheck size={16} aria-hidden="true" />{t(" Declared: ", " Merkinnät: ")}{formatProductRequirements(product.requirements, locale)}</strong>}
                              {product.finnishName && product.finnishName !== product.name && <p lang="fi">{product.finnishName}</p>}
                              <p>{t("Sales unit ", "Myyntiyksikkö ")}{product.salesUnit} · {catalogPackDescription(product, locale)}</p>
                            </div>
                            <div className="catalog-product-actions">
                              <Button variant="secondary" onClick={() => onCheckSku(product.id)}>{t("Check price and stock", "Tarkista hinta ja varastosaldo")}</Button>
                              <Button onClick={() => onUseProduct(product, effectiveRequirements, displayed.filters.freeFromAllergen)}>{t("Use in request ", "Käytä pyynnössä ")}<ArrowRight size={16} aria-hidden="true" /></Button>
                            </div>
                          </div>
                          <CatalogEvidence key={product.id} id={product.id} onViewProduct={openLinkedProduct} onCheckSku={onCheckSku} />
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </li>
                );
              })}
            </motion.ul>
          )}
          {displayed?.hasMore && (
            <div className="catalog-more">
              {limit < MAX_PRODUCTS
                ? <Button disabled={pending} variant="secondary" onClick={loadMore}>
                    {pending ? t("Loading products…", "Ladataan tuotteita…") : t("Show more products", "Näytä lisää tuotteita")} <ArrowDown size={16} aria-hidden="true" />
                  </Button>
                : <p>{t("Narrow your search to find more specific results.", "Rajaa hakua saadaksesi tarkempia tuloksia.")}</p>}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
