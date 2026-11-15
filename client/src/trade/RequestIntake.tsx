import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRight, X } from "lucide-react";
import milkPhoto from "../assets/monday-milk.jpg";
import { helsinkiDateTime, parseHelsinkiDateTime } from "../helsinkiTime";
import { useI18n } from "../i18n";
import { productRequirementLabel, productRequirementLabels } from "../productRequirements";
import type { ProductRequirement } from "../types";
import { tradeApi } from "./api";
import { tradeMessage } from "./tradeCopy";

const units = [
  ["kg", "Kilograms", "Kilogrammaa"], ["g", "Grams", "Grammaa"],
  ["L", "Litres", "Litraa"], ["ml", "Millilitres", "Millilitraa"],
  ["each", "Pieces", "Kappaletta"], ["case", "Cases", "Laatikkoa"],
] as const;

type CatalogMatch = { id: string; name: string };
type ProductSearch = { query: string; products: CatalogMatch[] } | { query: string; failed: true };

function nextMonday() {
  const day = helsinkiDateTime(Date.now()).slice(0, 10);
  const calendar = new Date(`${day}T12:00:00Z`);
  calendar.setUTCDate(calendar.getUTCDate() + ((8 - calendar.getUTCDay()) % 7 || 7));
  return calendar.toISOString().slice(0, 10);
}

export function RequestIntake({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (runId: string) => void;
}) {
  const { t, locale } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const quantityInput = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);
  const retry = useRef<{ fingerprint: string; key: string }>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [selectedProduct, setSelectedProduct] = useState<CatalogMatch>();
  const [productSearch, setProductSearch] = useState<ProductSearch>();
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("kg");
  const [budget, setBudget] = useState("");
  const [date, setDate] = useState("");
  const [requirement, setRequirement] = useState("");
  const searchQuery = selectedProduct ? "" : query.trim();
  const searchResult = productSearch?.query === searchQuery ? productSearch : undefined;

  useEffect(() => {
    const node = dialog.current;
    const previous = document.activeElement as HTMLElement | null;
    if (node && !node.open) node.showModal();
    return () => {
      node?.close();
      previous?.focus();
    };
  }, []);

  useEffect(() => {
    if (searchQuery.length < 2) return;
    let active = true;
    const timer = setTimeout(() => {
      tradeApi<{ products: CatalogMatch[] }>("/tools/browse_catalog", { query: searchQuery, limit: 8 })
        .then(({ products }) => {
          if (active) setProductSearch({ query: searchQuery, products });
        })
        .catch(() => {
          if (active) setProductSearch({ query: searchQuery, failed: true });
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [searchQuery]);

  function useExample() {
    setSelectedProduct(undefined);
    setQuery(t("milk", "maito"));
    setQuantity("1000");
    setUnit("L");
    setBudget("1800");
    setDate(nextMonday());
    setRequirement("lactose-free");
    setError("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    const deadline = date ? parseHelsinkiDateTime(date, "23:59") : undefined;
    if (!query.trim() || !Number.isFinite(Number(quantity)) || Number(quantity) <= 0) {
      setError(t("Enter a product and a positive quantity.", "Lisää tuote ja nollaa suurempi määrä."));
      return;
    }
    if (date && (!deadline || Date.parse(deadline) <= Date.now())) {
      setError(t("Choose a delivery date in the future.", "Valitse tuleva toimituspäivä."));
      return;
    }
    const fields = {
      ...(selectedProduct ? { productId: selectedProduct.id } : { query: query.trim() }),
      quantity: Number(quantity), unit,
      ...(requirement && { requirements: [requirement] }),
      ...(budget !== "" && { budgetCents: Math.round(Number(budget) * 100) }),
      ...(deadline && { deadline, deliveryMode: "by" }),
    };
    const fingerprint = JSON.stringify(fields);
    if (retry.current?.fingerprint !== fingerprint) {
      retry.current = { fingerprint, key: crypto.randomUUID() };
    }
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await tradeApi<{ runId: string }>("/tools/create_request", {
        ...fields, idempotencyKey: retry.current.key,
      });
      onCreate(result.runId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Request failed");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      className="trade-intake"
      aria-labelledby="trade-intake-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!inFlight.current) onClose();
      }}
    >
      <header>
        <div>
          <h2 id="trade-intake-title">{t("New purchase request", "Uusi hankintapyyntö")}</h2>
          <p>{t("Enter what your kitchen needs before checking supplier offers.", "Kerro keittiösi tarve ennen toimittajan vaihtoehtojen tarkistamista.")}</p>
        </div>
        <button type="button" disabled={busy} onClick={onClose} aria-label={t("Close new request", "Sulje uusi pyyntö")}><X size={22} /></button>
      </header>
      <form onSubmit={(event) => void submit(event)}>
        <button type="button" className="trade-intake-example" onClick={useExample} disabled={busy}>
          <img src={milkPhoto} alt="" />
          <span>
            <strong>{t("Try the Monday milk example", "Kokeile maanantain maitopyyntöä")}</strong>
            <small>{t("1,000 L of lactose-free milk", "1 000 l laktoositonta maitoa")}</small>
          </span>
          <ArrowRight size={19} />
        </button>
        <fieldset disabled={busy}>
          <div className="trade-intake-product">
            <label>{t("Product", "Tuote")}
              <input
                required
                maxLength={120}
                value={query}
                onChange={(event) => {
                  setSelectedProduct(undefined);
                  setQuery(event.target.value);
                }}
                placeholder={t("Search by name or product code", "Hae nimellä tai tuotenumerolla")}
                autoComplete="off"
              />
            </label>
            {selectedProduct ? (
              <p role="status">{t("Product code", "Tuotenumero")} {selectedProduct.id}</p>
            ) : searchQuery.length >= 2 && (
              <>
                <p role="status">
                  {!searchResult ? t("Searching the catalog…", "Haetaan valikoimasta…")
                    : "failed" in searchResult ? t("Catalog search is unavailable. You can use the name you entered.", "Valikoimahaku ei ole käytettävissä. Voit käyttää antamaasi nimeä.")
                    : searchResult.products.length ? t("Choose a catalog product or keep the name you entered.", "Valitse tuote valikoimasta tai käytä antamaasi nimeä.")
                    : t("No catalog matches. You can use the name you entered.", "Valikoimasta ei löytynyt osumia. Voit käyttää antamaasi nimeä.")}
                </p>
                {searchResult && "products" in searchResult && searchResult.products.length > 0 && (
                  <ul className="trade-intake-matches" aria-label={t("Catalog matches", "Valikoimahaun osumat")}>
                    {searchResult.products.map((product) => (
                      <li key={product.id}>
                        <button type="button" onClick={() => {
                          setSelectedProduct(product);
                          setQuery(product.name.slice(0, 120));
                          quantityInput.current?.focus();
                        }}>
                          <span>{product.name}</span>
                          <small>{product.id}</small>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
          <div className="trade-intake-fields">
            <label>{t("Quantity", "Määrä")}
              <input ref={quantityInput} required type="number" min="0.001" max="1000000" step="any" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
            </label>
            <label>{t("Unit", "Yksikkö")}
              <select value={unit} onChange={(event) => setUnit(event.target.value)}>
                {units.map(([value, en, fi]) => <option key={value} value={value}>{t(en, fi)}</option>)}
              </select>
            </label>
            <label>{t("Needed by (Helsinki)", "Tarvitaan viimeistään (Helsinki)")}
              <input type="date" min={helsinkiDateTime(Date.now()).slice(0, 10)} value={date} onChange={(event) => setDate(event.target.value)} />
            </label>
            <label>{t("Budget cap (€ ex VAT)", "Budjettikatto (€ alv 0 %)")}
              <input type="number" min="0" max="1000000" step="0.01" value={budget} onChange={(event) => setBudget(event.target.value)} />
            </label>
          </div>
          <label>{t("Product requirement", "Tuotevaatimus")}
            <select value={requirement} onChange={(event) => setRequirement(event.target.value)}>
              <option value="">{t("Use account requirements", "Käytä tilin vaatimuksia")}</option>
              {(Object.keys(productRequirementLabels) as ProductRequirement[]).map((value) =>
                <option key={value} value={value}>{productRequirementLabel(value, locale)}</option>)}
            </select>
          </label>
        </fieldset>
        {error && <p className="trade-error" role="alert">{tradeMessage(error, t)}</p>}
        <button type="submit" className="work-chat-button trade-motion-button" disabled={busy}>
          {busy ? t("Saving request…", "Tallennetaan pyyntöä…") : t("Create request", "Luo pyyntö")}
          <ArrowRight size={18} />
        </button>
      </form>
    </dialog>
  );
}
