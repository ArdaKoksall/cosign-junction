import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  ArrowRight,
  ArrowUpRight,
  Bot,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FilePlus,
  Link2,
  MessageCircle,
  Minus,
  Package,
  Plus,
  Search,
  ShoppingBasket,
  X,
} from "lucide-react";
import { tradeApi, type Run, type TradeEvent } from "./api";
import { PurchaseCard } from "./PurchaseCard";
import { AgentCharacter } from "./AgentExperience";
import deliveryPhoto from "../assets/kitchen-delivery.jpg";
import { CosignName } from "../components/CoSignBrand";
import { useI18n } from "../i18n";
import { ProfileRecommendations, usePreferredCatalogQuery } from "../onboarding/Onboarding";
import { activityLabel, agentClientLabel, agentClients, runStatusLabel, type AgentClient } from "./tradeCopy";

type Product = {
  id: string;
  name: string;
  salesUnit: string;
  imageUrl?: string;
  brand?: string;
};
type BasketItem = Product & { quantity: number };
const maxRequestItems = 10;
type CatalogPage = { products: Product[]; hasMore: boolean; offset: number };
export function BrandIcon({ brand }: { brand: AgentClient }) {
  if (brand === "custom") return <Bot className="brand-icon brand-custom" aria-hidden="true" />;
  const logo = brand === "claude" || brand === "claude-code" ? "claude" : "openai";
  return (
    <img
      className={`brand-icon brand-${logo}`}
      src={`/brands/${logo}.svg`}
      alt=""
    />
  );
}
export function CatalogPhoto({
  product,
}: {
  product: Pick<Product, "name" | "imageUrl">;
}) {
  const { t } = useI18n();
  const [failedUrl, setFailedUrl] = useState<string>();
  return product.imageUrl && failedUrl !== product.imageUrl ? (
    <img
      src={product.imageUrl}
      alt={product.name}
      loading="lazy"
      onError={() => setFailedUrl(product.imageUrl)}
    />
  ) : (
    <span className="product-photo-missing">
      <Package size={32} />
      <small>{t("Photo unavailable", "Kuvaa ei ole saatavilla")}</small>
    </span>
  );
}
function Pagination({
  page,
  hasMore,
  onPage,
  label,
  disabled = false,
}: {
  page: number;
  hasMore: boolean;
  onPage: (page: number) => void;
  label: string;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  return (
    <nav className="work-pagination" aria-label={label}>
      <button disabled={!page || disabled} onClick={() => onPage(page - 1)}>
        <ChevronLeft size={17} />
        {t("Previous", "Edellinen")}
      </button>
      <span aria-live="polite">{t(`Page ${page + 1}`, `Sivu ${page + 1}`)}</span>
      <button disabled={!hasMore || disabled} onClick={() => onPage(page + 1)}>
        {t("Next", "Seuraava")}
        <ChevronRight size={17} />
      </button>
    </nav>
  );
}
const categories = [
  ["All products", "Kaikki tuotteet", ""],
  ["Milk", "Maito", "milk"],
  ["Tomatoes", "Tomaatit", "tomato"],
  ["Bread", "Leipä", "bread"],
  ["Rice", "Riisi", "rice"],
  ["Juice", "Mehu", "juice"],
] as const;
export function Workbench({
  page,
  onPage,
  accountId,
  runs,
  events,
  query,
  onQuery,
  onOpenRun,
  onNewRequest,
  orderRehearsalAvailable,
  valioStubMode,
  initialRequestFilter,
  onAsk,
  onRefresh,
  onConnect,
}: {
  page: string;
  onPage: (page: string, filter?: string) => void;
  accountId: string;
  runs: Run[];
  events: TradeEvent[];
  query: string;
  onQuery: (query: string) => void;
  onOpenRun: (id: string) => void;
  onNewRequest: () => void;
  orderRehearsalAvailable?: boolean;
  valioStubMode?: boolean;
  initialRequestFilter: string;
  onAsk: (instruction?: string) => void;
  onRefresh: () => void;
  onConnect: (client: AgentClient) => void;
}) {
  const { t, locale } = useI18n();
  const preferredCatalogQuery = usePreferredCatalogQuery();
  const reduced = useReducedMotion();
  const [products, setProducts] = useState<Product[]>([]);
  const [catalogPosition, setCatalogPosition] = useState({ query, page: 0 });
  const catalogPage = catalogPosition.query === query ? catalogPosition.page : 0;
  const setCatalogPage = (page: number) => setCatalogPosition({ query, page });
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [requestedPage, setTaskPage] = useState(0);
  const [filter, setFilter] = useState(initialRequestFilter);
  const basketKey = `cosign:basket:${accountId}`;
  const previousBasketKey = `orderguard:basket:${accountId}`;
  const [basket, setBasket] = useState<BasketItem[]>(() => {
    try {
      const saved = JSON.parse(
        localStorage.getItem(basketKey) ?? localStorage.getItem(previousBasketKey) ?? "[]",
      );
      return Array.isArray(saved)
        ? saved
            .filter(
              (p) =>
                p && typeof p.id === "string" &&
                typeof p.name === "string" &&
                Number.isInteger(p.quantity) &&
                p.quantity > 0,
            )
            .slice(0, 24)
        : [];
    } catch {
      return [];
    }
  });
  const [basketOpen, setBasketOpen] = useState(false);
  const basketPanel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!basketOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    basketPanel.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setBasketOpen(false);
      if (e.key !== "Tab") return;
      const items = Array.from(
        basketPanel.current?.querySelectorAll<HTMLButtonElement>(
          "button:not(:disabled)",
        ) ?? [],
      );
      const first = items[0],
        last = items.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      }
      if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, [basketOpen]);
  const [added, setAdded] = useState("");
  useEffect(() => {
    try {
      localStorage.setItem(basketKey, JSON.stringify(basket));
      localStorage.removeItem(previousBasketKey);
    } catch { /* Browser privacy settings can disable storage. */ }
  }, [basketKey, previousBasketKey, basket]);
  useEffect(() => {
    if (!added) return;
    const timer = setTimeout(() => setAdded(""), 1800);
    return () => clearTimeout(timer);
  }, [added]);
  const catalogQuery = page === "workspace" ? preferredCatalogQuery ?? "milk" : query;
  const offset = page === "workspace" ? 0 : catalogPage * 12;
  useEffect(() => {
    let current = true;
    if (page !== "workspace" && page !== "products") return;
    setLoading(true);
    setError("");
    tradeApi<CatalogPage>("/tools/browse_catalog", {
      query: catalogQuery,
      limit: page === "workspace" ? 6 : 12,
      offset,
    })
      .then((result) => {
        if (current) {
          setProducts(result.products);
          setHasMore(result.hasMore);
        }
      })
      .catch((e) => {
        if (current) setError(e.message);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [page, catalogQuery, offset]);
  const add = (product: Product) => {
    setBasket((old) =>
      old.some((p) => p.id === product.id)
        ? old.map((p) =>
            p.id === product.id ? { ...p, quantity: p.quantity + 1 } : p,
          )
        : [...old, { ...product, quantity: 1 }],
    );
    setAdded(product.id);
  };
  const changeQuantity = (id: string, delta: number) =>
    setBasket((old) =>
      old
        .map((p) => (p.id === id ? { ...p, quantity: p.quantity + delta } : p))
        .filter((p) => p.quantity > 0),
    );
  const pending = runs.filter(
    (r) => r.draft && r.status === "awaiting_approval",
  );
  const active = runs.filter((r) =>
    ["active", "queued", "running"].includes(r.status),
  );
  const filtered = runs.filter(
    (r) =>
      filter === "all" ||
      (filter === "active"
        ? ["active", "queued", "running"].includes(r.status)
        : r.status === filter),
  );
  const taskPage = Math.min(requestedPage, Math.max(0, Math.ceil(filtered.length / 6) - 1));
  const visibleRuns =
    page === "workspace"
      ? runs.slice(0, 4)
      : filtered.slice(taskPage * 6, taskPage * 6 + 6);
  const title =
    page === "products"
      ? t("Product catalog", "Tuotevalikoima")
      : page === "requests"
        ? t("Purchasing requests", "Hankintapyynnöt")
        : t("Purchasing overview", "Hankintojen yleiskatsaus");
  return (
    <>
      <div className={page === "workspace" ? "work-heading work-heading--overview" : "work-heading"}>
        <div className="work-heading-content">
          <div>
            {page === "workspace" && orderRehearsalAvailable && (
              <span className="work-rehearsal-label">{valioStubMode
                ? t("Rehearsal · simulated prices and stock", "Harjoitus · simuloidut hinnat ja varastosaldot")
                : t("Order rehearsal enabled", "Tilausharjoitus käytössä")}</span>
            )}
            <h1>{title}</h1>
            <p>
              {page === "products"
                ? t("Find products and build your next purchase.", "Etsi tuotteita ja suunnittele seuraava hankintasi.")
                : page === "requests"
                  ? t("Follow every request, from search to your decision.", "Seuraa pyyntöjä tuotehausta päätökseen asti.")
                  : t("Review approvals and plan your next kitchen purchase.", "Käsittele hyväksynnät ja suunnittele keittiösi seuraava hankinta.")}
            </p>
          </div>
          <div className="work-heading-actions">
            {page === "products" ? (
              <button className="work-chat-button trade-motion-button" onClick={() => onAsk()}>
                <MessageCircle size={19} />
                {t("Chat with assistant", "Keskustele avustajan kanssa")}
              </button>
            ) : (
              <button className="work-chat-button work-new-request trade-motion-button" onClick={onNewRequest}>
                <FilePlus size={19} />
                {t("New request", "Uusi pyyntö")}
              </button>
            )}
            <button
              className="work-basket-button trade-motion-button"
              onClick={() => setBasketOpen(true)}
            >
              <ShoppingBasket size={19} />
              {t("Basket", "Ostoskori")}{" "}
              <motion.b
                key={basket.reduce((n, p) => n + p.quantity, 0)}
                initial={reduced ? false : { scale: 1.35 }}
                animate={{ scale: 1 }}
              >
                {basket.reduce((n, p) => n + p.quantity, 0)}
              </motion.b>
            </button>
          </div>
        </div>
        {page === "workspace" && (
          <div className="work-heading-image" aria-hidden="true">
            <img className="work-heading-photo" src={deliveryPhoto} alt="" fetchPriority="high" />
          </div>
        )}
      </div>
      {page === "workspace" && (
        <>
          <div className="work-overview-grid">
            <section className="work-today">
              <div className="work-section-heading">
                <h2>{t("Needs your attention", "Odottaa päätöstäsi")}</h2>
                <span>
                  {t(
                    `${pending.length} approval${pending.length === 1 ? "" : "s"}`,
                    `${pending.length} odottaa hyväksyntää`,
                  )}
                </span>
              </div>
              {pending.length ? (
                <PurchaseCard snapshot={pending[0]} onChange={onRefresh} orderRehearsalAvailable={orderRehearsalAvailable} />
              ) : (
                <div className="work-all-clear">
                  <Check size={28} />
                  <h3>{t("You’re all caught up", "Ei odottavia pyyntöjä")}</h3>
                  <p>
                    {t("Purchase requests that need your decision will appear here.", "Näet tässä hankintapyynnöt, jotka odottavat päätöstäsi.")}
                  </p>
                </div>
              )}
              {pending.length > 1 && (
                <button
                  className="work-text-button"
                  onClick={() => onPage("requests", "awaiting_approval")}
                >
                  {t("Review all approvals", "Katso kaikki hyväksyttävät pyynnöt")}
                  <ArrowRight size={16} />
                </button>
              )}
            </section>
            <section className="work-connect">
              <h2>{t("Connect your agent", "Yhdistä avustajasi")}</h2>
              <p>{t("Connect your preferred assistant to this account.", "Yhdistä haluamasi avustaja tähän tiliin.")}</p>
              <div className="work-connect-clients">
                {(Object.keys(agentClients) as AgentClient[]).map((client) => (
                  <button key={client} className={client === "custom" ? "work-connect-custom" : undefined} onClick={() => onConnect(client)}>
                    <BrandIcon brand={client} />
                    <span>
                      {agentClientLabel(client, t)}
                      <small>{t("Installation guide", "Yhdistämisohje")}</small>
                    </span>
                    <ArrowUpRight size={18} />
                  </button>
                ))}
              </div>
              <button
                className="work-text-button"
                onClick={() => onPage("connections")}
              >
                <Link2 size={15} />
                {t("All MCP connections", "Kaikki MCP-yhteydet")}
              </button>
            </section>
          </div>
          {active.length > 0 && (
            <section className="work-active">
              <AgentCharacter size="small" status="running" />
              <div>
                <strong>
                  {t(
                    `${active.length} request${active.length === 1 ? "" : "s"} in progress`,
                    `${active.length} käsittelyssä`,
                  )}
                </strong>
                <p>
                  {active[0].status === "running"
                    ? activityLabel(
                        t, events.filter((e) => e.run_id === active[0].id).at(-1),
                      )
                    : active[0].title}
                </p>
              </div>
              <button onClick={() => onOpenRun(active[0].id)}>
                {t("Follow task", "Seuraa tehtävää")}
                <ArrowRight size={17} />
              </button>
            </section>
          )}
          <ProfileRecommendations
            onSearch={(value) => {
              onQuery(value);
              onPage("products");
            }}
            onAsk={onAsk}
          />
        </>
      )}
      {(page === "workspace" || page === "products") && (
        <section className="work-catalog">
          <div className="work-section-heading">
            <div>
              <h2>
                {page === "workspace"
                  ? t("Products for your kitchen", "Tuotteita keittiöösi")
                  : query
                    ? t(`Results for “${query}”`, `Hakutulokset haulle ”${query}”`)
                    : t("Browse the catalog", "Selaa tuotevalikoimaa")}
              </h2>
              <p>
                {t(
                  "Official catalog · prices and availability checked when you prepare a request",
                  "Virallinen tuotevalikoima. Hinnat ja saatavuus tarkistetaan pyynnön yhteydessä.",
                )}
              </p>
            </div>
            {page === "workspace" && (
              <button
                className="work-text-button"
                onClick={() => {
                  onQuery("");
                  onPage("products");
                }}
              >
                {t("All products", "Kaikki tuotteet")}
                <ArrowRight size={17} />
              </button>
            )}
          </div>
          {page === "products" && (
            <div className="work-categories">
              {categories.map(([name, finnish, q]) => (
                <button
                  key={name}
                  aria-pressed={query === q}
                  onClick={() => {
                    setCatalogPage(0);
                    onQuery(q);
                  }}
                >
                  {t(name, finnish)}
                </button>
              ))}
            </div>
          )}
          {error ? (
            <p role="alert">{error}</p>
          ) : loading ? (
            <div className="work-product-grid" aria-label={t("Loading products", "Ladataan tuotteita")}>
              {Array.from({ length: 6 }, (_, i) => (
                <div className="product-skeleton" key={i} />
              ))}
            </div>
          ) : (
            <motion.div
              className="work-product-grid"
              key={`${catalogQuery}:${catalogPage}`}
              initial={reduced ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
            >
              {products.map((product) => (
                <article className="work-product-card" key={product.id}>
                  <div className="work-product-photo">
                    <CatalogPhoto product={product} />
                    <motion.button
                      whileTap={reduced ? undefined : { scale: 0.88 }}
                      className={added === product.id ? "product-added" : ""}
                      onClick={() => add(product)}
                      aria-label={t(`Add ${product.name} to basket`, `Lisää koriin: ${product.name}`)}
                    >
                      {added === product.id ? (
                        <Check size={18} />
                      ) : (
                        <Plus size={18} />
                      )}
                      <span>{added === product.id ? t("Added", "Lisätty") : t("Add", "Lisää")}</span>
                    </motion.button>
                  </div>
                  <small>{product.brand ?? t("Valio Aimo catalog", "Valio Aimon valikoima")}</small>
                  <h3>{product.name}</h3>
                  <p>{product.salesUnit}</p>
                </article>
              ))}
            </motion.div>
          )}
          {!loading && !error && !products.length && (
            <div className="work-empty">
              <Search size={30} />
              <h3>{t("No matching products", "Hakua vastaavia tuotteita ei löytynyt")}</h3>
              <p>{t("Try another product name or category.", "Kokeile toista tuotenimeä tai tuoteryhmää.")}</p>
            </div>
          )}
          {page === "products" && (
            <Pagination
              page={catalogPage}
              hasMore={hasMore}
              onPage={setCatalogPage}
              label={t("Product pages", "Tuotesivut")}
              disabled={loading}
            />
          )}
        </section>
      )}
      {(page === "workspace" || page === "requests") && (
        <section className="work-requests">
          <div className="work-section-heading">
            <h2>
              {page === "workspace" ? t("Recent requests", "Viimeisimmät pyynnöt") : t("Your requests", "Omat pyyntösi")}
            </h2>
            {page === "workspace" ? (
              <button
                className="work-text-button"
                onClick={() => onPage("requests")}
              >
                {t("View all", "Näytä kaikki")}
                <ArrowRight size={16} />
              </button>
            ) : (
              <span>{t(`${filtered.length} recent requests`, `Pyyntöjä: ${filtered.length}`)}</span>
            )}
          </div>
          {page === "requests" && (
            <div className="work-categories">
              {[
                ["all", t("All requests", "Kaikki pyynnöt")],
                ["awaiting_approval", t("Needs approval", "Odottaa hyväksyntää")],
                ["active", t("In progress", "Käsittelyssä")],
                ["completed", t("Completed", "Valmis")],
              ].map(([value, name]) => (
                <button
                  key={value}
                  aria-pressed={filter === value}
                  onClick={() => {
                    setFilter(value);
                    setTaskPage(0);
                  }}
                >
                  {name}
                </button>
              ))}
            </div>
          )}
          <div className="work-request-grid">
            {visibleRuns.map((run) => (
              <button
                className="work-request"
                key={run.id}
                onClick={() => onOpenRun(run.id)}
              >
                <span className={`request-symbol status-${run.status}`}>
                  {run.status === "completed" ? (
                    <Check size={20} />
                  ) : run.status === "awaiting_approval" ? (
                    <ShoppingBasket size={20} />
                  ) : (
                    <Clock3 size={20} />
                  )}
                </span>
                <div>
                  <strong>{run.title}</strong>
                  <p>
                    {run.source === "web" ? t("Workspace", "Työtila") : run.source === "nemotron"
                      ? <><CosignName />{t(" assistant", "-avustaja")}</>
                      : t("Connected agent", "Yhdistetty avustaja")}{" "}
                    ·{" "}
                    {new Date(run.created_at).toLocaleDateString(locale === "fi" ? "fi-FI" : "en-GB", {
                      timeZone: "Europe/Helsinki",
                      day: "numeric",
                      month: "short",
                    })}
                  </p>
                </div>
                <span className={`trade-status status-${run.status}`}>
                  {run.receipt ? t("Rehearsed", "Harjoiteltu") : runStatusLabel(run.status, t)}
                </span>
                <ArrowUpRight size={18} />
              </button>
            ))}
          </div>
          {!visibleRuns.length && (
            <p className="work-empty">{t("No requests in this view yet.", "Tässä näkymässä ei ole vielä pyyntöjä.")}</p>
          )}
          {page === "requests" && (
            <Pagination
              page={taskPage}
              hasMore={(taskPage + 1) * 6 < filtered.length}
              onPage={setTaskPage}
              label={t("Request pages", "Pyyntösivut")}
            />
          )}
        </section>
      )}
      <AnimatePresence>
        {basketOpen && (
          <motion.div
            className="work-basket-layer"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduced ? 0 : 0.2 }}
          >
            <button
              className="work-basket-scrim"
              aria-label={t("Close basket", "Sulje ostoskori")}
              onClick={() => setBasketOpen(false)}
            />
            <motion.section
              ref={basketPanel}
              className="work-basket-panel"
              role="dialog"
              aria-modal="true"
              aria-label={t("Planning basket", "Ostoskori")}
              initial={reduced ? false : { x: 40 }}
              animate={{ x: 0 }}
              exit={{ x: 40 }}
            >
              <header>
                <div>
                  <h2>{t("Your basket", "Ostoskorisi")}</h2>
                  <p>{t(`${basket.length} products · saved on this device`, `Tuotteita: ${basket.length} · tallennettu tälle laitteelle`)}</p>
                </div>
                <button
                  aria-label={t("Close basket panel", "Sulje ostoskoripaneeli")}
                  onClick={() => setBasketOpen(false)}
                >
                  <X />
                </button>
              </header>
              <div className="work-basket-items">
                {basket.map((product) => (
                  <article key={product.id}>
                    <CatalogPhoto product={product} />
                    <div>
                      <strong>{product.name}</strong>
                      <small>{product.salesUnit}</small>
                      <div className="work-quantity">
                        <button
                          aria-label={t(`Remove one ${product.name}`, `Vähennä yksi: ${product.name}`)}
                          onClick={() => changeQuantity(product.id, -1)}
                        >
                          <Minus size={15} />
                        </button>
                        <span>{product.quantity}</span>
                        <button
                          aria-label={t(`Add one ${product.name}`, `Lisää yksi: ${product.name}`)}
                          onClick={() => changeQuantity(product.id, 1)}
                        >
                          <Plus size={15} />
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
                {!basket.length && (
                  <div className="work-empty">
                    <ShoppingBasket size={35} />
                    <h3>{t("Your basket is empty", "Ostoskorisi on tyhjä")}</h3>
                    <p>{t("Add products to start planning a purchase.", "Aloita hankinnan suunnittelu lisäämällä tuotteita.")}</p>
                  </div>
                )}
              </div>
              <footer>
                <p>
                  {basket.length > maxRequestItems
                    ? t(`Remove items to prepare a request with up to ${maxRequestItems} products.`, `Poista tuotteita. Pyynnössä voi olla enintään ${maxRequestItems} tuotetta.`)
                    : t("The assistant will check quantities, prices and availability before preparing a draft.", "Avustaja tarkistaa määrät, hinnat ja saatavuuden ennen luonnoksen valmistelua.")}
                </p>
                <button
                  disabled={!basket.length || basket.length > maxRequestItems}
                  onClick={() => {
                    const items = basket.map(({ id, name, quantity }) => ({
                      productId: id,
                      query: name,
                      quantity,
                      unit: "sales_unit",
                    }));
                    setBasketOpen(false);
                    onAsk(
                      t(
                        "Help me prepare a draft with these exact catalog items. Check the next available offers with any budget or delivery preferences I provide. Use these product IDs, quantities and sales units. Check pack quantities, prices and availability, then show me what can be included in the draft.",
                        "Auta valmistelemaan luonnos näillä valikoiman tuotteilla. Tarkista seuraavat saatavilla olevat vaihtoehdot ja huomioi antamani budjetti- ja toimitustoiveet. Käytä näitä tuotetunnuksia, määriä ja myyntiyksiköitä. Tarkista pakkauskoot, hinnat ja saatavuus ja kerro, mitkä tuotteet voidaan sisällyttää luonnokseen.",
                      ) + `\n\n${JSON.stringify({ items }, null, 2)}`,
                    );
                  }}
                >
                  {t("Prepare with assistant", "Valmistele avustajan kanssa")}
                  <ArrowRight size={18} />
                </button>
              </footer>
            </motion.section>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="trade-sr" role="status">
        {added ? t("Product added to your planning basket", "Tuote lisättiin ostoskoriisi") : ""}
      </div>
    </>
  );
}
