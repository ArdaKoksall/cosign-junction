import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowRight,
  Check,
  ChevronDown,
  CircleAlert,
  Clock3,
  ListChecks,
  Package,
  Search,
  ShieldCheck,
} from "lucide-react";
import { BloubAvatar } from "../components/BloubAvatar";
import { useI18n, type Locale, type Translate } from "../i18n";
import { allergenLabel, productRequirementLabel } from "../productRequirements";
import type { ProductRequirement } from "../types";
import { DeliverySummary, ProductDeliveryEstimate, PurchaseCard } from "./PurchaseCard";
import { motion, useReducedMotion } from "motion/react";
import { isDeliveryMode, type Run, type TradeEvent } from "./api";
import { activityLabel, runStatusLabel, tradeMessage } from "./tradeCopy";
import { formatHelsinkiTime } from "../helsinkiTime";

const readable = (value: unknown) =>
  typeof value === "string" ? value.replaceAll("_", " ") : "";
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const rows = (value: unknown) =>
  Array.isArray(value) ? value.map(record) : [];
const comparedProducts = (value: unknown) => {
  const comparison = record(value);
  return Array.isArray(comparison.items)
    ? rows(comparison.items).flatMap((item) => rows(item.observations))
    : rows(comparison.observations);
};
const euro = (value: unknown, locale: Locale, t: Translate) =>
  typeof value === "number"
    ? new Intl.NumberFormat(locale === "fi" ? "fi-FI" : "en-FI", {
        style: "currency",
        currency: "EUR",
      }).format(value / 100)
    : t("Not checked", "Ei tarkistettu");
const toolNames: Record<string, [string, string]> = {
  get_account_context: ["Purchase permissions", "Ostovaltuudet"],
  list_requests: ["Your tasks", "Omat tehtävät"],
  get_activity: ["Task history", "Tehtävähistoria"],
  browse_catalog: ["Product search", "Tuotehaku"],
  get_product_details: ["Product details", "Tuotetiedot"],
  create_request: ["Purchase request", "Hankintapyyntö"],
  amend_request: ["Updated item", "Päivitetty tuote"],
  remove_request_items: ["Removed items", "Poistetut tuotteet"],
  update_request_preferences: ["Updated preferences", "Päivitetyt toiveet"],
  search_products: ["Product search", "Tuotehaku"],
  compare_products: ["Price & stock", "Hinta ja saatavuus"],
  prepare_order: ["Purchase draft", "Tilausluonnos"],
  get_request_status: ["Request status", "Pyynnön tila"],
  place_order: ["Supplier submission", "Lähetys toimittajalle"],
};

function toolName(value: unknown, t: Translate) {
  const key = String(value);
  return Object.hasOwn(toolNames, key) ? t(...toolNames[key]) : readable(value);
}

export function AgentMarkdown({ content }: { content: string }) {
  const { t } = useI18n();
  return (
    <div className="agent-markdown">
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          table: ({ children }) => (
            <div
              className="agent-table-scroll"
              tabIndex={0}
              role="region"
              aria-label={t("Assistant result table", "Avustajan tulostaulukko")}
            >
              <table>{children}</table>
            </div>
          ),
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          img: ({ alt }) => <span>{alt}</span>,
        }}
      >
        {content}
      </Markdown>
    </div>
  );
}

type CharacterMood = {
  state: import("../vendor/bloub/states").StateId;
  expression: import("../vendor/bloub/expressions").ExpressionId;
  tone: string;
};

// Only observed events drive reactions; a cheerful face never implies an order succeeded.
export function agentMood(status?: string, event?: TradeEvent): CharacterMood {
  if (
    status === "failed" ||
    status === "needs_attention" ||
    event?.status === "failed" ||
    event?.data.error
  )
    return { state: "alert", expression: "confus", tone: "attention" };
  if (status === "awaiting_approval")
    return { state: "notify", expression: "attentif", tone: "approval" };
  if (status === "cancelled")
    return { state: "idle", expression: "somnolent", tone: "rest" };
  if (
    event?.action === "browse_catalog" &&
    Array.isArray(event.data.products)
  ) {
    if (!event.data.products.length)
      return { state: "wide", expression: "triste", tone: "empty" };
    return { state: "wink", expression: "heureux", tone: "found" };
  }
  if (
    event?.action === "compare_products" &&
    comparedProducts(event.data.comparison).some(
      (item) =>
        item.stockUnknown || (Array.isArray(item.issues) && item.issues.length),
    )
  )
    return { state: "wide", expression: "mefiant", tone: "attention" };
  if (event?.action === "compare_products")
    return { state: "swirl", expression: "curieux", tone: "comparing" };
  if (event?.action === "get_account_context")
    return { state: "idle", expression: "attentif", tone: "checking" };
  if (event?.action === "prepare_order")
    return { state: "notify", expression: "attentif", tone: "approval" };
  if (event?.action === "get_product_details")
    return { state: "wide", expression: "surpris", tone: "discovering" };
  if (status === "running")
    return { state: "thinking", expression: "curieux", tone: "working" };
  if (status === "queued")
    return { state: "idle", expression: "attentif", tone: "working" };
  if (status === "completed")
    return { state: "wink", expression: "heureux", tone: "complete" };
  return { state: "swirl", expression: "curieux", tone: "rest" };
}

export function AgentCharacter({
  status,
  event,
  size = "large",
}: {
  status?: string;
  event?: TradeEvent;
  size?: "large" | "small";
}) {
  const mood = agentMood(status, event);
  const [settled, setSettled] = useState(false);
  const [engaged, setEngaged] = useState(false);
  const [reduced, setReduced] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    setSettled(false);
    const timer = window.setTimeout(() => setSettled(true), 2600);
    return () => window.clearTimeout(timer);
  }, [status, event?.id, mood.state]);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return (
    <div
      className={`agent-character agent-character--${size} tone-${mood.tone}`}
      data-emotion={mood.expression}
      onPointerEnter={() => setEngaged(true)}
      onPointerLeave={() => setEngaged(false)}
    >
      <BloubAvatar
        signature
        state={engaged ? "wink" : settled ? "idle" : mood.state}
        expression={engaged ? "heureux" : mood.expression}
        reducedMotion={reduced}
        paper="#e0eef2"
      />
    </div>
  );
}

function ProductTile({
  product,
  showDelivery = false,
  onAsk,
}: {
  product: Record<string, unknown>;
  showDelivery?: boolean;
  onAsk: (instruction: string) => void;
}) {
  const { t, locale } = useI18n();
  const [broken, setBroken] = useState(false);
  const name = String(product.name ?? product.displayName ?? t("Product", "Tuote"));
  const productId = String(product.id ?? product.productId ?? "");
  const estimate = record(product.estimate);
  return (
    <article className="agent-product">
      <div className="agent-product-photo">
        {typeof product.imageUrl === "string" && !broken ? (
          <img
            src={product.imageUrl}
            alt={name}
            onError={() => setBroken(true)}
          />
        ) : (
          <Package size={30} />
        )}
      </div>
      <div>
        <h4>{name}</h4>
        <p>{String(product.salesUnit ?? "")}</p>
        {typeof product.salesUnitPriceCents === "number" && (
          <strong>
            {euro(product.salesUnitPriceCents, locale, t)}{" "}
            <small>{t("/ sales unit · ex VAT", "/ myyntierä · alv 0 %")}</small>
          </strong>
        )}
        {typeof product.availableSellUnits === "number" &&
          !product.stockUnknown &&
          !(
            Array.isArray(product.issues) &&
            product.issues.includes("STOCK_UNKNOWN")
          ) && <p>{t(`${product.availableSellUnits} sales units available`, `${product.availableSellUnits} myyntierää saatavilla`)}</p>}
        {product.stockUnknown ||
        (Array.isArray(product.issues) &&
          product.issues.includes("STOCK_UNKNOWN")) ? (
          <p>{t("Availability unverified", "Saatavuutta ei ole vahvistettu")}</p>
        ) : null}
        {typeof estimate.totalCents === "number" && (
          <p>{t("Request estimate", "Hinta-arvio")}: {euro(estimate.totalCents, locale, t)}</p>
        )}
        {showDelivery && (
          <ProductDeliveryEstimate product={{
            availableDate: product.availableDate,
            deliveryStatus: product.deliveryStatus,
          }} />
        )}
      </div>
      <button
        onClick={() =>
          onAsk(t(
            `Check product ${productId} (${name}). Ask me for any missing purchase requirements before preparing a draft.`,
            `Tarkista tuote ${productId} (${name}). Kysy puuttuvat hankintavaatimukset ennen tilausluonnoksen laatimista.`,
          ))
        }
        aria-label={t(`Ask about ${name}`, `Kysy tuotteesta ${name}`)}
      >
        <ArrowRight size={17} />
      </button>
    </article>
  );
}

function ResultWidget({
  event,
  onOpenRun,
  onAsk,
  purchaseRuns = [],
  onDecision,
  orderRehearsalAvailable,
}: {
  event: TradeEvent;
  purchaseRuns?: Run[];
  onDecision?: () => void;
  orderRehearsalAvailable?: boolean;
  onOpenRun: (id: string) => void;
  onAsk: (text: string) => void;
}) {
  const { t, locale } = useI18n();
  const data = event.data;
  const [expanded, setExpanded] = useState(false);
  if (event.status === "failed")
    return (
      <div className="agent-error">
        <CircleAlert size={20} />
        <div>
          <strong>
            {t(`${toolName(event.action, t)} needs attention`, `Tarkista toiminto: ${toolName(event.action, t)}`)}
          </strong>
          <p>
            {data.message
              ? tradeMessage(String(data.message), t)
              : t("This operation could not be completed.", "Toimintoa ei voitu suorittaa loppuun.")}
          </p>
        </div>
      </div>
    );
  if (event.action === "get_account_context") {
    const policy = record(data.policy);
    return (
      <section className="agent-widget agent-rules">
        <div className="agent-widget-title">
          <ShieldCheck size={18} />
          <h3>{t("Purchase permissions", "Ostovaltuudet")}</h3>
          <span>{t("Account rules", "Tilin säännöt")}</span>
        </div>
        <div className="agent-rule-limit">
          <strong>{euro(policy.automaticLimitCents, locale, t)}</strong>
          <span>{t("Automatic spending limit", "Automaattisten ostojen raja")}</span>
        </div>
        <p>
          {typeof policy.automaticLimitCents !== "number"
            ? t("Spending authority has not been returned by this lookup.", "Ostovaltuuksia ei saatu tästä hausta.")
            : policy.automaticLimitCents === 0
              ? t("Every purchase needs your approval.", "Jokainen osto vaatii hyväksyntäsi.")
              : t("Purchases above this limit need your approval.", "Rajan ylittävät ostot vaativat hyväksyntäsi.")}
        </p>
        <div className="agent-rule-tags">
          {[
            ...(Array.isArray(policy.requiredClaims)
              ? policy.requiredClaims.map((value: ProductRequirement) =>
                  productRequirementLabel(value, locale) ?? readable(value))
              : []),
            ...(Array.isArray(policy.freeFromAllergens)
              ? policy.freeFromAllergens.map((value: string) =>
                  t(`Free from ${value}`, `Ei sisällä: ${allergenLabel(value, locale)}`))
              : []),
          ].map((value, i) => (
            <span key={i}>{readable(value)}</span>
          ))}
        </div>
      </section>
    );
  }
  if (event.action === "list_requests") {
    const tasks = rows(data.requests);
    return (
      <section className="agent-widget">
        <div className="agent-widget-title">
          <ListChecks size={18} />
          <h3>{t("Your requests", "Omat pyynnöt")}</h3>
          <span>{t(`${tasks.length} at lookup`, `${tasks.length} hakutulosta`)}</span>
        </div>
        <div className="agent-task-results">
          {(expanded ? tasks : tasks.slice(0, 3)).map((task) => (
            <button
              key={String(task.id)}
              onClick={() => onOpenRun(String(task.id))}
            >
              <span className={`agent-task-dot status-${task.status}`} />
              <div>
                <strong>{String(task.title)}</strong>
                <small>
                  {runStatusLabel(String(task.status ?? ""), t)}
                  {record(task.draft).totalCents != null
                    ? ` · ${euro(record(task.draft).totalCents, locale, t)}`
                    : ""}
                </small>
              </div>
              <ArrowRight size={17} />
            </button>
          ))}
        </div>
        {tasks.length > 3 && (
          <button
            className="agent-see-more"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? t("Show less", "Näytä vähemmän") : t(`See all ${tasks.length} tasks`, `Näytä kaikki ${tasks.length} tehtävää`)}
            <ChevronDown size={16} />
          </button>
        )}
        {!tasks.length && <p>{t("No tasks matched this lookup.", "Haku ei löytänyt tehtäviä.")}</p>}
      </section>
    );
  }
  const draft = record(data.draft);
  if ((draft.name || Array.isArray(draft.items)) && typeof data.id === "string") {
    const current = purchaseRuns.find((r) => r.id === data.id);
    return <PurchaseCard snapshot={current ?? (data as unknown as Run)} onChange={onDecision} orderRehearsalAvailable={orderRehearsalAvailable} />;
  }
  const comparison = record(data.comparison);
  const comparisonItems = rows(comparison.items);
  const requirements = record(data.requirements);
  const requestedItems = rows(requirements.items);
  const isMultiItemComparison = comparisonItems.length > 0;
  const isComparison = event.action === "compare_products" || isMultiItemComparison;
  const staggered = isMultiItemComparison && comparisonItems.length > 1;
  const products = rows(
    data.products ?? data.observations ?? comparison.observations,
  );
  const groups = isMultiItemComparison
    ? comparisonItems.map((compared) => {
        const requested = requestedItems.find(
          (item) => item.itemId === compared.itemId,
        );
        return {
          id: String(compared.itemId),
          label: requested
            ? `${requested.quantity} ${requested.unit === "sales_unit" ? t("sales units of", "myyntierää") : requested.unit} ${requested.query}`
            : String(compared.itemId),
          products: rows(compared.observations),
        };
      })
    : [{ id: "products", label: null, products }];
  const productCount = groups.reduce(
    (count, group) => count + group.products.length,
    0,
  );
  if (productCount || isComparison)
    return (
      <section className="agent-widget">
        <div className="agent-widget-title">
          <Search size={18} />
          <h3>
            {isComparison ? t("Your options, compared", "Vaihtoehtojen vertailu") : t("Found in the catalog", "Löytyi valikoimasta")}
          </h3>
          <span>{t(`${productCount} products`, `${productCount} tuotetta`)}</span>
        </div>
        {isComparison && typeof requirements.deadline === "string" && (
          <DeliverySummary deadline={requirements.deadline} mode={isDeliveryMode(requirements.deliveryMode) ? requirements.deliveryMode : undefined} />
        )}
        {groups.map((group) => (
          <div className="agent-product-results" key={group.id}>
            {group.label && (
              <h4 className="agent-comparison-label">{group.label}</h4>
            )}
            {(expanded ? group.products : group.products.slice(0, 3)).map(
              (product, i) => (
                <ProductTile
                  key={String(product.id ?? product.productId ?? i)}
                  product={product}
                  showDelivery={staggered || (isComparison && typeof product.deliveryStatus === "string")}
                  onAsk={onAsk}
                />
              ),
            )}
            {!group.products.length && (
              <p>{t("No products were found for this item.", "Tälle riville ei löytynyt tuotteita.")}</p>
            )}
          </div>
        ))}
        {data.pricesIncluded === false && (
          <p className="agent-source-note">
            {t("Catalog only. Price and availability still need checking.", "Valikoimatiedot. Tarkista vielä hinta ja saatavuus.")}
          </p>
        )}
        {groups.some((group) => group.products.length > 3) && (
          <button
            className="agent-see-more"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? t("Show less", "Näytä vähemmän") : t(`Explore all ${productCount} products`, `Näytä kaikki ${productCount} tuotetta`)}
            <ChevronDown size={16} />
          </button>
        )}
        {isComparison && typeof data.id === "string" && (
          <button className="agent-see-more" onClick={() => onOpenRun(data.id as string)}>
            {t("Open comparison", "Avaa vertailu")}
            <ArrowRight size={16} />
          </button>
        )}
      </section>
    );
  if (event.action === "get_activity")
    return (
      <section className="agent-widget">
        <div className="agent-widget-title">
          <Clock3 size={18} />
          <h3>{t("What happened", "Tapahtumat")}</h3>
        </div>
        <ol className="agent-history">
          {rows(data.events)
            .slice(0, 6)
            .map((item, i) => (
              <li key={i}>
                <strong>
                  {toolName(item.action, t)}
                </strong>
                <small>{runStatusLabel(String(item.status ?? ""), t)}</small>
              </li>
            ))}
        </ol>
      </section>
    );
  if (event.action === "browse_catalog" || event.action === "search_products")
    return (
      <section className="agent-widget">
        <div className="agent-widget-title">
          <Search size={18} />
          <h3>{t("No matches this time", "Ei hakutuloksia")}</h3>
        </div>
        <p className="agent-source-note">
          {t(
            "No catalog products matched this search and your account requirements. Try a more specific product name.",
            "Valikoimassa ei ollut tuotteita, jotka vastaavat hakua ja tilisi vaatimuksia. Kokeile tarkempaa tuotenimeä.",
          )}
        </p>
      </section>
    );
  if (
    (event.action === "create_request" ||
      event.action === "get_request_status") &&
    typeof data.id === "string"
  )
    return (
      <section className="agent-widget">
        <div className="agent-widget-title">
          <ListChecks size={18} />
          <h3>{t("Purchase request", "Hankintapyyntö")}</h3>
        </div>
        <h4>{String(data.title ?? t("Your request", "Pyyntösi"))}</h4>
        <p>{runStatusLabel(String(data.status ?? ""), t)}</p>
        <button
          className="agent-see-more"
          onClick={() => onOpenRun(data.id as string)}
        >
          {t("Open request", "Avaa pyyntö")}
          <ArrowRight size={16} />
        </button>
      </section>
    );
  if (event.action === "get_product_details" && data.product)
    return (
      <section className="agent-widget">
        <div className="agent-widget-title">
          <Package size={18} />
          <h3>{t("Product details", "Tuotetiedot")}</h3>
        </div>
        <ProductTile product={record(data.product)} onAsk={onAsk} />
        <AgentMarkdown
          content={String(
            record(record(data.product).details).ingredients ?? "",
          )}
        />
      </section>
    );
  return null;
}

type ChatTurn = { id: string; prompt: string; events: TradeEvent[] };
export function conversationTurns(events: TradeEvent[]) {
  const turns: ChatTurn[] = [];
  for (const event of events) {
    const prompt =
      event.action === "buyer_message"
        ? event.data.content
        : event.action === "agent_job"
          ? event.data.instruction
          : undefined;
    if (typeof prompt === "string")
      turns.push({ id: event.id, prompt, events: [] });
    else {
      if (!turns.length) turns.push({ id: "context", prompt: "", events: [] });
      turns[turns.length - 1].events.push(event);
    }
  }
  return turns;
}

export function ChatReply({
  content,
  structured,
}: {
  content: string;
  structured: boolean;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  if (
    !structured ||
    (content.length < 240 &&
      !/[|]|run_[a-z0-9]+|job_[a-z0-9]+|https?:/.test(content))
  )
    return <AgentMarkdown content={content} />;
  const question = content
    .split(/\n/)
    .filter(
      (line) => line.trim().endsWith("?") && !/https?:|run_|job_/.test(line),
    )
    .at(-1);
  return (
    <div className="chat-brief">
      <p>
        {question || t(
          "The results are above. Select a product or request to continue.",
          "Valitse yllä olevista tuloksista tuote tai pyyntö jatkaaksesi.",
        )}
      </p>
      <button onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
        {expanded ? t("Hide explanation", "Piilota selitys") : t("Read explanation", "Lue selitys")}
        <ChevronDown size={14} />
      </button>
      {expanded && <AgentMarkdown content={content} />}
    </div>
  );
}
const progressLabel = (events: TradeEvent[], t: Translate) => {
  const latest = events.filter((e) => e.action !== "agent_job").at(-1);
  return latest?.status === "started"
    ? activityLabel(t, latest)
    : t("Putting the results together", "Kootaan tuloksia");
};

function RequestProgress({ run }: { run: Run }) {
  const { t } = useI18n();
  const phase = run.receipt || run.approved_revision != null || run.status === "ready" ? 4
    : run.draft ? 3 : run.comparison ? 2 : 1;
  const labels = [
    t("Request", "Pyyntö"),
    t("Lookup", "Tuotehaku"),
    t("Draft", "Luonnos"),
    t("Decision", "Päätös"),
  ];
  return (
    <ol className="purchase-progress" aria-label={t("Purchase progress", "Hankinnan eteneminen")}>
      {labels.map((label, index) => (
        <li key={label} aria-current={index === phase - 1 ? "step" : undefined}>
          <span>{index < phase - 1 || run.receipt ? <Check size={14} /> : index + 1}</span>{label}
        </li>
      ))}
    </ol>
  );
}

function RequestHistory({ events }: { events: TradeEvent[] }) {
  const { t, locale } = useI18n();
  const labels: Record<string, string> = {
    create_request: t("Request created", "Pyyntö luotu"),
    compare_products: t("Supplier offers checked", "Toimittajan vaihtoehdot tarkistettu"),
    prepare_order: t("Draft prepared", "Luonnos valmisteltu"),
    human_approval: t("Buyer approved the draft", "Ostaja hyväksyi luonnoksen"),
    human_rejection: t("Buyer declined the draft", "Ostaja hylkäsi luonnoksen"),
    order_rehearsal: t("Rehearsal receipt recorded", "Harjoitustilauksen kuitti tallennettu"),
    amend_request: t("Item updated", "Tuote päivitetty"),
    remove_request_items: t("Items removed", "Tuotteita poistettu"),
    update_request_preferences: t("Preferences updated", "Toiveet päivitetty"),
  };
  const entries = events.filter(({ action, status }) =>
    Object.hasOwn(labels, action) && (status === "completed" || status === "failed")).slice(-12).reverse();
  if (!entries.length) return null;
  return (
    <details className="purchase-history">
      <summary>{t("Decision history", "Päätöshistoria")}</summary>
      <ol>
        {entries.map((event) => (
          <li key={event.id}>
            <time dateTime={event.created_at}>{formatHelsinkiTime(event.created_at, locale)}</time>
            {event.status === "completed" ? labels[event.action]
              : tradeMessage(String(event.data.message ?? t("Operation failed", "Toiminto epäonnistui")), t)}
          </li>
        ))}
      </ol>
    </details>
  );
}

export function AgentExperience({
  run,
  events,
  onOpenRun,
  onAsk,
  onStop,
  autoScroll = false,
  assistantAvailable = true,
  purchaseRuns = [],
  onDecision,
  orderRehearsalAvailable,
}: {
  run: Run | null;
  events: TradeEvent[];
  onOpenRun: (id: string) => void;
  onAsk: (instruction: string) => void;
  onStop?: () => void;
  autoScroll?: boolean;
  assistantAvailable?: boolean;
  purchaseRuns?: Run[];
  onDecision?: () => void;
  orderRehearsalAvailable?: boolean;
}) {
  const { t } = useI18n();
  const reduced = useReducedMotion();
  const root = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  useEffect(() => {
    if (!autoScroll) return;
    const scroller = root.current?.parentElement;
    if (!scroller) return;
    const track = () => {
      nearBottom.current =
        scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <
        120;
    };
    scroller.addEventListener("scroll", track, { passive: true });
    nearBottom.current = true;
    const raf = requestAnimationFrame(() => {
      scroller.scrollTop = scroller.scrollHeight;
    });
    return () => {
      scroller.removeEventListener("scroll", track);
      cancelAnimationFrame(raf);
    };
  }, [autoScroll, run?.id]);
  useEffect(() => {
    if (!autoScroll || !nearBottom.current) return;
    const scroller = root.current?.parentElement;
    const raf = requestAnimationFrame(() => {
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
    });
    return () => cancelAnimationFrame(raf);
  }, [autoScroll, events.length, run?.status]);
  const turns = conversationTurns(events);
  const active = run && ["running", "queued"].includes(run.status);
  const hasWidget = (e: TradeEvent) =>
    Object.hasOwn(toolNames, e.action) &&
    ["completed", "failed"].includes(e.status);
  if (run && !run.id.startsWith("job_"))
    return (
      <div ref={root} className="agent-experience chat-stream">
        <RequestProgress run={run} />
        <PurchaseCard snapshot={run} onChange={onDecision} orderRehearsalAvailable={orderRehearsalAvailable} />
        {assistantAvailable && run.status === "needs_attention" && (
          <button className="work-text-button" type="button" onClick={() => onAsk(t(
            `Review request ${run.id} and suggest available options. Ask before changing the request.`,
            `Tarkista pyyntö ${run.id} ja ehdota saatavilla olevia vaihtoehtoja. Kysy ennen pyynnön muuttamista.`,
          ))}>
            {t("Ask about alternatives", "Kysy vaihtoehdoista")} <ArrowRight size={16} />
          </button>
        )}
        <RequestHistory events={events} />
      </div>
    );
  return (
    <div ref={root} className="agent-experience chat-stream">
      {!run && (
        <div className="chat-welcome">
          <AgentCharacter size="small" />
          <h3>{t("What can I help you find?", "Mitä haluaisit löytää?")}</h3>
          <div className="agent-starters">
            <button
              onClick={() =>
                onAsk(t(
                  "Check my purchasing rules and summarize tasks that need my attention.",
                  "Tarkista ostosääntöni ja kokoa yhteenveto tehtävistä, jotka vaativat huomiotani.",
                ))
              }
            >
              <ShieldCheck size={18} />
              <span>
                <strong>{t("Catch me up on my kitchen", "Näytä keittiöni ajankohtaiset tehtävät")}</strong>
              </span>
              <ArrowRight size={16} />
            </button>
            <button
              onClick={() =>
                onAsk(t(
                  "Find lactose-free milk in the catalog. Do not create an order yet.",
                  "Etsi valikoimasta laktoositonta maitoa. Älä vielä luo tilausta.",
                ))
              }
            >
              <Search size={18} />
              <span>
                <strong>{t("Find products for my next order", "Etsi tuotteita seuraavaan tilaukseen")}</strong>
              </span>
              <ArrowRight size={16} />
            </button>
          </div>
        </div>
      )}
      {turns.map((turn, index) => {
        const latest = index === turns.length - 1;
        const widgets = [
          ...new Map(
            turn.events.filter(hasWidget).map((event) => [event.action, event]),
          ).values(),
        ];
        const responses = turn.events.filter(
          (event) =>
            event.action === "model_response" &&
            typeof event.data.content === "string" &&
            event.data.content.trim(),
        );
        const finalResponse = responses.at(-1);
        const working = latest && active;
        const failed = turn.events
          .filter(
            (event) =>
              event.action === "agent_job" && event.status === "failed",
          )
          .at(-1);
        return (
          <motion.div
            className="chat-turn"
            key={turn.id}
            initial={reduced ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
          >
            {turn.prompt && (
              <div className="chat-user-message">
                <p>{turn.prompt}</p>
              </div>
            )}
            <div className="chat-assistant-message">
              <div className="chat-message-avatar">
                {latest ? (
                  <AgentCharacter
                    size="small"
                    status={run?.status}
                    event={turn.events
                      .filter((e) => Object.hasOwn(toolNames, e.action))
                      .at(-1)}
                  />
                ) : (
                  <span className="chat-previous-avatar">
                    <Package size={16} />
                  </span>
                )}
              </div>
              <div className="chat-message-content">
                {responses.slice(0, -1).map((event) => (
                  <ChatReply
                    key={event.id}
                    structured={widgets.length > 0}
                    content={String(event.data.content)}
                  />
                ))}
                {widgets.length > 0 && (
                  <div className="chat-inline-results">
                    {widgets.map((event) => (
                      <ResultWidget
                        key={event.id}
                        event={event}
                        purchaseRuns={purchaseRuns}
                        onDecision={onDecision}
                        orderRehearsalAvailable={orderRehearsalAvailable}
                        onOpenRun={onOpenRun}
                        onAsk={onAsk}
                      />
                    ))}
                  </div>
                )}
                {finalResponse && (
                  <ChatReply
                    structured={widgets.length > 0}
                    content={String(finalResponse.data.content)}
                  />
                )}
                {working && (
                  <div className="chat-working" role="status">
                    <span className="chat-thinking-dots">
                      <i />
                      <i />
                      <i />
                    </span>
                    <span>
                      {run?.status === "queued"
                        ? t("One moment…", "Hetkinen…")
                        : progressLabel(turn.events, t)}
                    </span>
                    {onStop && <button onClick={onStop}>{t("Stop", "Pysäytä")}</button>}
                  </div>
                )}
                {latest && run?.status === "awaiting_approval" && (
                  <p className="chat-decision-note">
                    {t("Ready for your decision. Nothing has been ordered.", "Valmis päätettäväksi. Tilausta ei ole tehty.")}
                  </p>
                )}
                {failed && (
                  <div className="agent-error">
                    <CircleAlert size={17} />
                    <p>
                      {failed.data.message
                        ? tradeMessage(String(failed.data.message), t)
                        : t("I couldn’t complete this request. Please try again.", "Pyyntöä ei voitu suorittaa loppuun. Yritä uudelleen.")}
                    </p>
                  </div>
                )}
                {latest && run?.status === "cancelled" && (
                  <p className="chat-decision-note">{t("This task was stopped.", "Tehtävä pysäytettiin.")}</p>
                )}
              </div>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
