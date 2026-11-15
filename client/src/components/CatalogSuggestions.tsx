import { useI18n } from "../i18n";
import { useEffect, useState } from "react";
import { getCatalogProducts } from "../api";
import { describeConversion, describeMismatch } from "../catalogMismatch";
import { catalogPackDescription } from "../catalogProduct";
import { formatAllergenRequirements, formatProductRequirements } from "../productRequirements";
import type { CatalogProduct, CatalogSearchResult, ProductRequirement } from "../types";
import { Button } from "./ui";
import "./catalog-suggestions.css";

const limit = 5;
const searchDelay = 230;

type SearchResponse = { key: string; data: CatalogSearchResult } | { key: string; data: null };
const noRequirements: ProductRequirement[] = [];
const noAllergens: string[] = [];

export function CatalogSuggestions({ query, requirements = noRequirements, freeFromAllergen = noAllergens, selectedId, excludedIds = [], disabled,
  actionLabel, onSelect, onUseSpelling }: {
  query: string;
  requirements?: ProductRequirement[];
  freeFromAllergen?: string[];
  selectedId?: string;
  excludedIds?: string[];
  disabled?: boolean;
  actionLabel: string;
  onSelect: (product: CatalogProduct, requirements: ProductRequirement[]) => void;
  /** Replaces the search with the spelling correction the catalog suggested. */
  onUseSpelling?: (query: string) => void;
}) {
  const { t, locale } = useI18n();
  const search = query.trim();
  const enabled = search.length >= 2 && !selectedId && !disabled;
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [attempt, setAttempt] = useState(0);
  const key = JSON.stringify([search, requirements, freeFromAllergen, attempt]);
  const current = response?.key === key ? response : null;

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const data = await getCatalogProducts(search, limit, { requirements, amountDimension: "", freeFromAllergen }, controller.signal, { closest: true });
        if (!controller.signal.aborted) setResponse({ key, data });
      } catch {
        if (!controller.signal.aborted) setResponse({ key, data: null });
      }
    }, searchDelay);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [enabled, search, requirements, freeFromAllergen, key]);

  if (search.length < 2 || selectedId) return null;
  const data = current?.data;
  const matches = data?.products.filter(({ id }) => !excludedIds.includes(id)) ?? [];
  const appliedRequirements = data?.requirements ?? requirements;
  const closestOnly = data?.exactMatch === false;
  const status = !current ? (disabled ? "" : t("Searching catalog…", "Haetaan tuoteluettelosta…"))
    : !data ? t("Catalog suggestions are unavailable.", "Tuoteluettelon ehdotuksia ei saatu.")
      : !matches.length ? (data.products.length ? t("These matches are already selected. Try a more specific name.", "Nämä tuotteet on jo valittu. Kokeile tarkempaa nimeä.") : t("No catalog matches. Try a shorter name, a Finnish name, or a SKU.", "Tuoteluettelosta ei löytynyt osumia. Kokeile lyhyempää nimeä, suomenkielistä nimeä tai tuotenumeroa."))
        : closestOnly ? t("No exact match. These are the best options available; check what's different before you use one.", "Tarkkaa osumaa ei löytynyt. Tarkista parhaiden vaihtoehtojen erot ennen kuin valitset tuotteen.")
          : t("Catalog matches", "Tuoteluettelon osumat");

  return (
    <div className="catalog-suggestions-inline">
      {data?.didYouMean && onUseSpelling && (
        <p className="catalog-did-you-mean">
          {t("Did you mean", "Tarkoititko")}{" "}
          <button type="button" disabled={disabled} onClick={() => onUseSpelling(data.didYouMean!)}>
            {data.didYouMean}
          </button>?
        </p>
      )}
      <p className="catalog-suggestions-status" role="status" data-closest={closestOnly && matches.length > 0 ? true : undefined}>
        {status}{data && appliedRequirements.length > 0 && <span>{t(" · Required: ", " · Vaatimus: ")}{formatProductRequirements(appliedRequirements, locale)}</span>}
        {data && freeFromAllergen.length > 0 && <span>{t(" · Declared free from ", " · Ilmoituksen mukaan ei sisällä ")}{formatAllergenRequirements(freeFromAllergen, locale)}</span>}
      </p>
      {current && !data && <Button variant="tertiary" disabled={disabled} onClick={() => setAttempt((value) => value + 1)}>{t("Retry suggestions", "Hae ehdotukset uudelleen")}</Button>}
      {matches.length > 0 && <ul aria-label={t("Matching catalog products", "Vastaavat tuotteet")}>
        {matches.map((product, position) => (
          <li key={product.id} data-best={closestOnly && position === 0 ? true : undefined}>
            <span className="catalog-suggestion-name">
              {closestOnly && position === 0 && <span className="catalog-best-badge">{t("Best available match", "Paras saatavilla oleva vaihtoehto")}</span>}
              <strong>{product.name}</strong>
              <small>{t("SKU ", "Tuotenumero ")}{product.id} · {catalogPackDescription(product, locale)}{product.requirements?.length > 0 && t(` · Declared: ${formatProductRequirements(product.requirements, locale)}`, ` · Merkinnät: ${formatProductRequirements(product.requirements, locale)}`)}</small>
              {product.conversion && <small className="catalog-suggestion-conversion">{describeConversion(product.conversion, locale)}</small>}
              {closestOnly && (product.mismatches?.length ?? 0) > 0 && (
                <ul className="catalog-suggestion-mismatches" aria-label={t(`How ${product.name} differs from your search`, `Miten ${product.name} poikkeaa haustasi`)}>
                  {product.mismatches!.map((mismatch, index) => {
                    const { text, risk } = describeMismatch(mismatch, locale);
                    return <li key={index} data-risk={risk ? "health" : undefined}>{risk ? "⚠ " : ""}{text}{risk && <strong> {risk}</strong>}</li>;
                  })}
                </ul>
              )}
            </span>
            <Button variant="secondary" disabled={disabled} ariaLabel={t(`${actionLabel}: ${product.name}, SKU ${product.id}`, `${actionLabel}: ${product.name}, tuotenumero ${product.id}`)}
              onClick={() => onSelect(product, appliedRequirements)}>{actionLabel}</Button>
          </li>
        ))}
      </ul>}
      {data?.hasMore && matches.length > 0 && <p>{t("Try a brand, pack size, or SKU to narrow the matches.", "Rajaa hakua tuotemerkillä, pakkauskoolla tai tuotenumerolla.")}</p>}
    </div>
  );
}
