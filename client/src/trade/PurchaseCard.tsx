import { useEffect, useRef, useState } from "react";
import { Check, FlaskConical, ReceiptText, ShieldCheck, X, Package, RefreshCw } from "lucide-react";
import { useI18n } from "../i18n";
import { supplierIssueLabel } from "../supplierIssues";
import { tradeMessage } from "./tradeCopy";
import { formatCalendarDay, formatHelsinkiTime } from "../helsinkiTime";
import {
  isPreferredDelivery,
  tradeApi,
  type Comparison,
  type ComparedProduct,
  type DeliveryMode,
  type DraftEligibility,
  type DraftLine,
  type Eligibility,
  type ItemChoice,
  type ItemAvailability,
  type ItemComparison,
  type ProductChoice,
  type RequestChange,
  type RequestItem,
  type Run,
} from "./api";

const euros = {
  en: new Intl.NumberFormat("en-FI", { style: "currency", currency: "EUR" }),
  fi: new Intl.NumberFormat("fi-FI", { style: "currency", currency: "EUR" }),
};
const numbers = {
  en: new Intl.NumberFormat("en-FI"),
  fi: new Intl.NumberFormat("fi-FI"),
};
type Locale = keyof typeof euros;
const money = (value: number, locale: Locale) => euros[locale].format(value / 100);
const finnishUnits: Record<string, string> = { each: "kpl", case: "laatikkoa", sales_unit: "myyntiyksikköä" };

function requestedQuantity(item: Pick<RequestItem, "unit" | "quantity" | "query">, locale: Locale) {
  const unit = locale === "fi"
    ? finnishUnits[item.unit] ?? item.unit
    : item.unit === "sales_unit" ? "sales units of" : item.unit;
  return `${numbers[locale].format(item.quantity)} ${unit} ${item.query}`;
}

function RequestChanges({ changes }: { changes: RequestChange[] }) {
  const { t, locale } = useI18n();
  function itemLabel(item: Extract<RequestChange, { kind: "item_changed" }>["before"]) {
    const summary = requestedQuantity(item, locale);
    return item.productId && item.productId !== item.query ? `${summary} (${item.productId})` : summary;
  }
  const noLimit = t("No budget cap", "Ei budjettikattoa");
  const noDate = t("No delivery target", "Ei toimitustavoitetta");
  const budgetLabel = (value: { cents: number; mode: "hard" | "preferred" } | null) => value
    ? `${value.mode === "hard" ? t("Budget cap", "Budjettikatto") : t("Budget target", "Budjettitavoite")} ${money(value.cents, locale)}`
    : noLimit;
  const deliveryLabel = (value: { deadline: string; mode: DeliveryMode } | null) => value
    ? `${{
      by: t("Needed by", "Tarvitaan viimeistään"), on: t("Required on", "Toimitettava päivänä"),
      preferred_by: t("Preferred by", "Toivottu viimeistään"), preferred_on: t("Preferred on", "Toivottu toimituspäivä"),
    }[value.mode]} ${formatHelsinkiTime(value.deadline, locale)}`
    : noDate;
  return (
    <div className="purchase-request-changes">
      <h3>{t("Changes proposed by the agent", "Agentin ehdottamat muutokset")}</h3>
      <ul>
        {changes.map((change) => {
          if (change.kind === "item_changed") {
            return <li key={change.revision}>{itemLabel(change.before)} → {itemLabel(change.after)}</li>;
          }
          if (change.kind === "items_removed") {
            return <li key={change.revision}>{t("Removed", "Poistettu")} {change.items.map(itemLabel).join(", ")}</li>;
          }
          return <li key={change.revision}>
            {change.budget && <span>{budgetLabel(change.budget.before)} → {budgetLabel(change.budget.after)}</span>}
            {change.delivery && <span>{deliveryLabel(change.delivery.before)} → {deliveryLabel(change.delivery.after)}</span>}
          </li>;
        })}
      </ul>
    </div>
  );
}

const formatCaveats = (caveats: string[], locale: Locale) =>
  caveats.map((value) => locale === "fi" || preferenceCaveats.includes(value)
    ? supplierIssueLabel(value, locale)
    : value.replaceAll("_", " ").toLowerCase()).join(" · ");
const preferenceCaveats = ["OVER_PREFERRED_BUDGET", "OUTSIDE_PREFERRED_DELIVERY_DATE"];

function DeliveryDay({ day }: { day: string }) {
  const { locale } = useI18n();
  return <time dateTime={day}>{formatCalendarDay(day, locale)}</time>;
}

type ProductDelivery = { availableDate?: unknown; deliveryStatus?: unknown };

function deliveryEstimate({ availableDate, deliveryStatus }: ProductDelivery) {
  if (typeof availableDate === "string" && availableDate) {
    if (deliveryStatus === "estimated") {
      return { label: "Estimated arrival", day: availableDate, className: "purchase-option-arrival" };
    }
    if (deliveryStatus === "time_unverified") {
      return { label: "Estimated arrival", day: availableDate, timeUnverified: true };
    }
    if (deliveryStatus === "after_deadline") {
      return { label: "After your deadline", day: availableDate, className: "purchase-option-late" };
    }
  }
  return { label: "Delivery date unverified" };
}

export function ProductDeliveryEstimate({ product }: { product: ProductDelivery }) {
  const { t } = useI18n();
  const { label, day, className, timeUnverified } = deliveryEstimate(product);
  return (
    <p className={className}>
      {tradeMessage(label, t)}{day && <> <DeliveryDay day={day} /></>}
      {timeUnverified && <small className="purchase-option-time">{t("Delivery time unverified", "Toimituksen kellonaikaa ei ole vahvistettu")}</small>}
    </p>
  );
}

export function DeliverySummary({
  deadline,
  mode,
  dates = [],
  itemCount = 0,
  timeUnverified = false,
}: {
  deadline?: string;
  mode?: DeliveryMode;
  dates?: (string | undefined)[];
  itemCount?: number;
  timeUnverified?: boolean;
}) {
  const { t, locale } = useI18n();
  const known = dates.filter((date): date is string => Boolean(date)).sort();
  const next = known[0];
  const full = known.length === itemCount && !timeUnverified ? known.at(-1) : undefined;
  if (!deadline && !next) return null;
  const deadlineLabel = {
    by: t("Needed by", "Tarvitaan viimeistään"),
    on: t("Requested for", "Pyydetty toimituspäivä"),
    preferred_by: t("Preferred by", "Toivottu viimeistään"),
    preferred_on: t("Preferred for", "Toivottu toimituspäivä"),
  }[mode ?? "by"];

  return (
    <dl className="purchase-delivery-summary">
      {deadline && (
        <div>
          <dt>{deadlineLabel}</dt>
          <dd><time dateTime={deadline}>{formatHelsinkiTime(deadline, locale)}</time></dd>
        </div>
      )}
      {next && (
        <div>
          <dt>{t("Next estimated arrival", "Seuraava arvioitu toimituspäivä")}</dt>
          <dd><DeliveryDay day={next} /></dd>
        </div>
      )}
      {full && (
        <div>
          <dt>{t("Full order estimated by", "Koko tilaus arvioitu saapuvaksi viimeistään")}</dt>
          <dd><DeliveryDay day={full} /></dd>
        </div>
      )}
    </dl>
  );
}

function PurchaseLine({
  title,
  line,
  requested,
}: {
  title: string;
  line?: DraftLine;
  requested?: RequestItem;
}) {
  const { t, locale } = useI18n();
  return (
    <div className="purchase-card-item">
      <PurchasePhoto url={line?.imageUrl} />
      <div>
        <h3>{title}</h3>
        <p>
          {line
            ? `${numbers[locale].format(line.salesUnits)} ${line.salesUnit}`
            : t("No product selected yet", "Tuotetta ei ole vielä valittu")}
        </p>
        {requested && <p>{t("Requested", "Pyydetty määrä:")} {requestedQuantity(requested, locale)}</p>}
        {requested && !!line?.caveats.length && (
          <p className="purchase-caveats">{formatCaveats(line.caveats, locale)}</p>
        )}
      </div>
      {line && (
        <strong>
          {money(line.totalCents, locale)}
          <small>{t("estimate · ex VAT", "arvio · alv 0 %")}</small>
        </strong>
      )}
    </div>
  );
}

function PurchasePhoto({ url }: { url?: string | null }) {
  const [failedUrl, setFailedUrl] = useState<string>();
  return url && failedUrl !== url ? (
    <img src={url} alt="" loading="lazy" onError={() => setFailedUrl(url)} />
  ) : (
    <Package size={30} aria-hidden="true" />
  );
}

function DraftLines({
  lines,
  items,
  staggered,
}: {
  lines: (DraftLine & { itemId: string })[];
  items?: RequestItem[];
  staggered: boolean;
}) {
  const { t } = useI18n();
  const renderLine = (line: (typeof lines)[number]) => (
    <PurchaseLine
      key={line.itemId}
      line={line}
      title={line.name}
      requested={items?.find(({ itemId }) => itemId === line.itemId)}
    />
  );
  if (!staggered) {
    return <div className="purchase-draft-lines">{lines.map(renderLine)}</div>;
  }

  const groups = new Map<string, typeof lines>();
  const unverified: typeof lines = [];
  for (const line of lines) {
    const day = line.availableDate;
    if (!day) {
      unverified.push(line);
      continue;
    }
    const group = groups.get(day) ?? [];
    group.push(line);
    groups.set(day, group);
  }

  return (
    <div className="purchase-draft-lines">
      {[...groups].sort(([a], [b]) => a.localeCompare(b)).map(([day, group]) => (
        <div className="purchase-delivery-group" key={day}>
          <p className="purchase-arrival-date">
            {t("Estimated arrival", "Arvioitu toimituspäivä")} <DeliveryDay day={day} />
          </p>
          {group.map(renderLine)}
        </div>
      ))}
      {unverified.length > 0 && (
        <div className="purchase-delivery-group">
          <p className="purchase-arrival-date">{t("Delivery date unverified", "Toimituspäivää ei ole vahvistettu")}</p>
          {unverified.map(renderLine)}
        </div>
      )}
    </div>
  );
}

type ComparisonOption = { product: ComparedProduct; choice: ProductChoice; fit?: Eligibility };

function optionsFor(comparison: Comparison | undefined, eligibility?: DraftEligibility): ComparisonOption[] {
  const offers = comparison?.deliveryOffers ?? [];
  const datedProducts = new Set(offers.map(({ productId }) => productId));
  return [
    ...offers.map((offer) => ({
      product: offer,
      choice: { productId: offer.productId, availableDate: offer.availableDate },
      fit: offer,
    })),
    ...(comparison?.observations ?? []).filter(({ productId }) => !datedProducts.has(productId)).map((product) => ({
      product,
      choice: { productId: product.productId },
      fit: eligibility?.[product.productId],
    })),
  ];
}

function matchesChoice(left: ProductChoice, right?: ProductChoice) {
  return left.productId === right?.productId && left.availableDate === right.availableDate;
}

function ComparisonOptions({
  options,
  disabled,
  selected,
  showDelivery = false,
  multiple = false,
  readOnly = false,
  onSelect,
}: {
  options: ComparisonOption[];
  disabled: boolean;
  selected?: ProductChoice;
  showDelivery?: boolean;
  multiple?: boolean;
  readOnly?: boolean;
  onSelect: (choice: ProductChoice) => void;
}) {
  const { t, locale } = useI18n();
  if (!options.length) return <p>{t("No products were found for this item. Ask the assistant about alternatives.", "Tälle riville ei löytynyt tuotteita. Kysy vaihtoehtoja avustajalta.")}</p>;

  return (
    <div className="purchase-comparison-cards">
      {options.map(({ product, choice, fit }) => {
        const displayDate = showDelivery || Boolean(product.deliveryStatus || choice.availableDate);
        const deliveryLabel = displayDate ? deliveryEstimate(product).label : undefined;
        const blockers = fit?.reasons.length
          ? fit.reasons
              .filter((reason) => reason !== deliveryLabel)
              .map((reason) => locale === "fi" && /^[a-z]+(?: [a-z]+)+$/.test(reason)
                ? supplierIssueLabel(reason.replaceAll(" ", "_").toUpperCase(), locale)
                : tradeMessage(reason, t))
              .join(" · ")
          : t("Refresh price and stock before selecting.", "Päivitä hinta ja varastosaldo ennen valintaa.");
        const isSelected = matchesChoice(choice, selected);
        const preferences = product.issues.filter((issue) => preferenceCaveats.includes(issue));
        const choiceLabel = choice.availableDate
          ? t(
            `Choose ${product.name} for ${formatCalendarDay(choice.availableDate, locale)}`,
            `Valitse ${product.name}, toimitus ${formatCalendarDay(choice.availableDate, locale)}`,
          )
          : t(`Choose ${product.name}`, `Valitse ${product.name}`);
        return (
          <article key={JSON.stringify([choice.productId, choice.availableDate])}>
            <PurchasePhoto url={product.imageUrl} />
            <h4>{product.name}</h4>
            <p>{product.salesUnit}</p>
            <strong>
              {product.salesUnitPriceCents == null
                ? t("Price not verified", "Hintaa ei ole vahvistettu")
                : money(product.salesUnitPriceCents, locale)}
              <small>{t(" / sales unit", " / myyntiyksikkö")}</small>
            </strong>
            {product.estimate?.totalCents != null && (multiple || choice.availableDate) && (
              <p>
                {t(
                  `${money(product.estimate.totalCents, locale)} for ${numbers[locale].format(product.estimate.salesUnits)} sales units · ex VAT`,
                  `${money(product.estimate.totalCents, locale)} / ${numbers[locale].format(product.estimate.salesUnits)} myyntiyksikköä · alv 0 %`,
                )}
              </p>
            )}
            <p>
              {!product.issues.includes("STOCK_UNKNOWN") &&
              product.availableSellUnits != null &&
              product.availableSellUnits < 9999999999
                ? t(
                    `${numbers[locale].format(product.availableSellUnits)} sales units reported available`,
                    `Saatavilla ilmoitettu ${numbers[locale].format(product.availableSellUnits)} myyntiyksikköä`,
                  )
                : t("Stock needs verification", "Varastosaldo on vahvistettava")}
            </p>
            {displayDate && <ProductDeliveryEstimate product={product} />}
            {(product.reliability != null || product.carbon != null) && (
              <dl className="purchase-offer-signals">
                {product.reliability != null && <div><dt>{t("Historical reliability", "Historiallinen toimitusvarmuus")}</dt><dd>{new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 }).format(product.reliability)}</dd></div>}
                {product.carbon != null && <div><dt>{t("Category footprint", "Tuoteryhmän hiilijalanjälki")}</dt><dd>{numbers[locale].format(product.carbon)} kg CO₂e/kg</dd></div>}
              </dl>
            )}
            {preferences.length > 0 && <small>{formatCaveats(preferences, locale)}</small>}
            {!readOnly && (
              <>
                <button
                  type="button"
                  aria-label={choiceLabel}
                  aria-pressed={multiple ? isSelected : undefined}
                  disabled={disabled || !fit?.eligible}
                  onClick={() => onSelect(choice)}
                >
                  {isSelected && <Check size={14} aria-hidden="true" />}
                  {multiple || choice.availableDate ? t("Choose", "Valitse") : t("Choose this product", "Valitse tämä tuote")}
                </button>
                {!fit?.eligible && blockers && <small>{blockers}</small>}
              </>
            )}
          </article>
        );
      })}
    </div>
  );
}

function MultiItemComparison({
  items,
  comparison,
  eligibility,
  budgetCents,
  preferredBudget,
  availability,
  deadline,
  mode,
  disabled,
  readOnly,
  onPrepare,
}: {
  items: RequestItem[];
  comparison: ItemComparison;
  eligibility?: Record<string, DraftEligibility>;
  budgetCents?: number;
  preferredBudget: boolean;
  availability?: Run["itemAvailability"];
  deadline?: string;
  mode?: DeliveryMode;
  disabled: boolean;
  readOnly: boolean;
  onPrepare: (selections: ItemChoice[]) => void;
}) {
  const { t, locale } = useI18n();
  const [selected, setSelected] = useState<Record<string, ProductChoice>>({});
  const plan = comparison.basketPlan;
  const planChoices = Object.fromEntries((plan?.selections ?? []).map(choice => [choice.itemId, choice]));
  const groups = items.map((item) => {
    const options = optionsFor(comparison.items.find(({ itemId }) => itemId === item.itemId), eligibility?.[item.itemId]);
    const selection = selected[item.itemId];
    const option = options.find(({ choice }) => matchesChoice(choice, selection));
    const product = option?.product;
    const totalCents = product?.estimate?.totalCents;
    const timeUnverified = product?.deliveryStatus === "time_unverified";
    const date = product?.deliveryStatus === "estimated" || timeUnverified ? product.availableDate ?? undefined : undefined;
    const choice = option?.fit?.eligible && product?.estimate && totalCents != null
      ? { selection: { itemId: item.itemId, ...option.choice }, totalCents, date, timeUnverified,
        units: product.estimate.salesUnits, stock: product.availableSellUnits }
      : null;
    return { item, options, selection, choice };
  });
  const choices = groups.flatMap(({ choice }) => (choice ? [choice] : []));
  const complete = choices.length === items.length;
  const total = choices.reduce((sum, choice) => sum + choice.totalCents, 0);
  const overBudget = complete && budgetCents != null && total > budgetCents;
  const scheduledStock = new Map<string, { units: number; stock: number }>();
  for (const choice of choices) {
    const key = JSON.stringify([choice.selection.productId, choice.date]);
    const existing = scheduledStock.get(key);
    scheduledStock.set(key, {
      units: Number(((existing?.units ?? 0) + choice.units).toPrecision(15)),
      stock: Math.min(existing?.stock ?? Infinity, choice.stock ?? 0),
    });
  }
  const stockConflict = [...scheduledStock.values()].some(({ units, stock }) => units > stock);
  const usePlan = plan?.status === "feasible" && Object.keys(planChoices).length === items.length
    && groups.every(({ item, options }) => options.some(({ choice, fit }) => fit?.eligible && matchesChoice(choice, planChoices[item.itemId])));
  return (
    <>
      <DeliverySummary
        deadline={deadline}
        mode={mode}
        dates={choices.map(({ date }) => date)}
        itemCount={items.length > 1 ? items.length : undefined}
        timeUnverified={choices.some((choice) => choice.timeUnverified)}
      />
      {!readOnly && usePlan && (
        <>
          {plan.explanation && (
            <p>
              {t("Earliest complete basket", "Aikaisin saatavilla oleva koko tilaus")} · <DeliveryDay day={plan.explanation.completionDate} />. {plan.explanation.priceOptimal
                ? t("Lowest total on that date within your budget and delivery settings.", "Pienin kokonaissumma kyseisenä päivänä budjetti- ja toimitusasetuksillasi.")
                : t("This basket fits the request. The search limit prevented verifying the lowest total.", "Tilaus vastaa pyyntöä. Hakuraja esti pienimmän kokonaissumman varmistamisen.")}
            </p>
          )}
          <div className="purchase-decision-actions">
            <button type="button" disabled={disabled} onClick={() => setSelected(planChoices)}>
              {t("Use suggested options", "Käytä ehdotettuja vaihtoehtoja")}{plan.totalCents != null && ` (${money(plan.totalCents, locale)})`}
            </button>
          </div>
        </>
      )}
      {!readOnly && plan && plan.status !== "feasible" && (
        <p role="status">{plan.reasons?.map((reason) => tradeMessage(reason, t)).join(" ") ||
          t("No complete selection is available from these options.", "Näistä vaihtoehdoista ei voi koota tilausta.")}{" "}
          {t("Ask the assistant about alternatives.", "Kysy vaihtoehtoja avustajalta.")}</p>
      )}
      {groups.map(({ item, options, selection }) => (
        <fieldset className="purchase-comparison-group" key={item.itemId}>
          <legend>{requestedQuantity(item, locale)}</legend>
          <AvailabilityReason availability={availability?.[item.itemId]} />
          <ComparisonOptions
            options={options}
            disabled={disabled}
            selected={selection}
            showDelivery={items.length > 1}
            multiple
            readOnly={readOnly}
            onSelect={(choice) =>
              setSelected((previous) => ({
                ...previous,
                [item.itemId]: choice,
              }))
            }
          />
        </fieldset>
      ))}
      {complete && (
        <div className="purchase-draft-total">
          <span>{t("Order estimate · ex VAT", "Tilauksen arvio · alv 0 %")}</span>
          <strong>{money(total, locale)}</strong>
        </div>
      )}
      {overBudget && (
        <p role="status">
          {preferredBudget ? t(
            `The selected products exceed the ${money(budgetCents, locale)} budget target.`,
            `Valitut tuotteet ylittävät budjettitavoitteen (${money(budgetCents, locale)}).`,
          ) : t(
            `The selected products exceed the ${money(budgetCents, locale)} order budget.`,
            `Valitut tuotteet ylittävät tilauksen budjetin (${money(budgetCents, locale)}).`,
          )}
        </p>
      )}
      {stockConflict && <p role="status">{t("The selected items exceed the stock reported for the same product and date.", "Valittu määrä ylittää samalle tuotteelle ja päivälle ilmoitetun varastosaldon.")}</p>}
      {!readOnly && (
        <div className="purchase-decision-actions">
          <button
            type="button"
            disabled={disabled || !complete || (overBudget && !preferredBudget) || stockConflict}
            onClick={() => onPrepare(choices.map(({ selection }) => selection))}
          >
            {t("Prepare draft", "Valmistele luonnos")}
          </button>
        </div>
      )}
    </>
  );
}

function AvailabilityReason({ availability }: { availability?: ItemAvailability }) {
  const { t } = useI18n();
  if (!availability || availability.status === "eligible") return null;
  return <p>{availability.reasons.map((reason) => tradeMessage(reason, t)).join(" ")}</p>;
}

type PurchaseCardProps = {
  snapshot: Run;
  onChange?: () => void;
  orderRehearsalAvailable?: boolean;
};

export function PurchaseCard(props: PurchaseCardProps) {
  return <PurchaseRunCard key={props.snapshot.id} {...props} />;
}

function PurchaseRunCard({ snapshot, onChange, orderRehearsalAvailable }: PurchaseCardProps) {
  const { t, locale } = useI18n();
  const [review, setReview] = useState<{ run: Run; snapshotVersion: string }>();
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<"decision" | "prepare" | "compare" | "remove" | "rehearse">();
  const [failure, setFailure] = useState<{ message: string; code?: string; revision?: number }>();
  const [loadAttempt, setLoadAttempt] = useState(0);
  const snapshotVersion = `${snapshot.revision}:${snapshot.status}`;
  const version = useRef(snapshotVersion);
  version.current = snapshotVersion;
  const mounted = useRef(false);
  const inFlight = useRef(false);
  const verified = review?.snapshotVersion === snapshotVersion;
  const run = verified ? review.run : snapshot;
  const disabled = !verified || loading || Boolean(pending);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    let active = true;
    setLoading(true);
    tradeApi<Run>(`/runs/${encodeURIComponent(snapshot.id)}`)
      .then((value) => {
        if (active && version.current === snapshotVersion) {
          if (value.id !== snapshot.id) throw new Error("Could not load this request.");
          setReview({ run: value, snapshotVersion });
          setFailure(undefined);
        }
      })
      .catch((e) => {
        if (active && version.current === snapshotVersion) {
          setReview(undefined);
          setFailure({ message: e instanceof Error ? e.message : "Could not load this request." });
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [snapshot.id, snapshotVersion, loadAttempt]);
  const runPath = `/runs/${encodeURIComponent(run.id)}`;
  const execute = async (kind: NonNullable<typeof pending>, path: string, body: object) => {
    if (disabled || inFlight.current || version.current !== snapshotVersion) return;
    inFlight.current = true;
    setPending(kind);
    setFailure(undefined);
    const current = () => mounted.current && version.current === snapshotVersion;
    const accept = (value: Run) => {
      if (value.id !== run.id) throw new Error("Could not load this request.");
      if (current()) setReview({ run: value, snapshotVersion });
    };
    try {
      const result = await tradeApi<Run>(path, body);
      const updated = kind === "rehearse" ? await tradeApi<Run>(runPath) : result;
      accept(updated);
      if (kind === "remove") {
        accept(await tradeApi<Run>("/tools/compare_products", { runId: run.id, revision: updated.revision }));
      }
      if (current()) onChange?.();
    } catch (e) {
      if (!current()) return;
      const code = (e as { code?: string } | undefined)?.code;
      setFailure({ message: e instanceof Error ? e.message : "Could not update this request.", code, revision: run.revision });
      if (kind !== "compare") {
        // A retry must use a freshly viewed draft. A failed refresh leaves actions disabled.
        try {
          const refreshed = await tradeApi<Run>(runPath);
          accept(refreshed);
          if (current() && kind === "decision" && "approve" in body && refreshed.revision === run.revision
            && refreshed.status === (body.approve ? "approved" : "rejected")) {
            setFailure(undefined);
            onChange?.();
          }
          if (current() && kind === "remove" && refreshed.revision !== run.revision) onChange?.();
          if (current() && kind === "rehearse" && refreshed.receipt?.revision === run.revision) {
            setFailure(undefined);
            onChange?.();
          }
        } catch {
          if (current()) setReview(undefined);
        }
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setPending(undefined);
    }
  };
  const prepare = (selection: ProductChoice | { selections: ItemChoice[] }) =>
    execute("prepare", "/tools/prepare_order", { runId: run.id, revision: run.revision, ...selection });
  const decide = (approve: boolean) => execute("decision", `${runPath}/decision`, { revision: run.revision, approve });
  const items = run.requirements?.items;
  const deadline = run.requirements?.deadline;
  const mode = run.requirements?.deliveryMode;
  const excluded = run.requirements?.excludedItems ?? [];
  const requestChanges = run.requestChanges ?? [];
  const removedByAgent = new Set(requestChanges.flatMap((change) =>
    change.kind === "items_removed" ? change.items.map(({ itemId }) => itemId) : [],
  ));
  const otherOmissions = excluded.filter(({ itemId }) => !removedByAgent.has(itemId));
  const partial = run.partialBasketPlan;
  const proposedOmissions = items?.filter(({ itemId }) => partial?.omittedItemIds.includes(itemId)) ?? [];
  const comparison = run.comparison;
  const draft = run.draft;
  const receipt = run.receipt;
  const closed = ["cancelled", "rejected", "completed"].includes(run.status);
  const pastDeadline = Boolean(!isPreferredDelivery(mode) && deadline && Date.parse(deadline) <= Date.now());
  const failedWith = (code: string) => failure?.revision === run.revision && failure?.code === code;
  const staleEvidence = failedWith("stale_evidence");
  const approvalBlocked = run.approvalEligibility?.eligible === false || staleEvidence || failedWith("policy_changed") || failedWith("past_deadline");
  const cannotPrepare = disabled || staleEvidence || failedWith("past_deadline");
  const canCompare = !closed && !pastDeadline && (!draft || approvalBlocked);
  const canRehearse = orderRehearsalAvailable && draft && !receipt && ["approved", "ready"].includes(run.status);
  const rehearse = () => execute("rehearse", "/tools/place_order", {
    runId: run.id,
    revision: run.revision,
    mode: "rehearsal",
    idempotencyKey: `cosign-web:${run.id}:${run.revision}`,
  });
  return (
    <section
      className={`purchase-chat-card purchase-${run.status}`}
      aria-label={t("Purchase approval", "Hankinnan hyväksyntä")}
    >
      <div className="purchase-card-label">
        <ShieldCheck size={18} />
        <strong>
          {receipt
            ? t("Rehearsal complete", "Harjoitus valmis")
            : run.status === "ready"
              ? t("Within account authority", "Tilin ostovaltuuksien rajoissa")
              : run.status === "awaiting_approval"
            ? t("Your approval is needed", "Pyyntö odottaa hyväksyntääsi")
            : run.status === "approved"
              ? t("You allowed this draft", "Hyväksyit tämän luonnoksen")
              : run.status === "rejected"
                ? t("You declined this draft", "Hylkäsit tämän luonnoksen")
                : run.status === "cancelled" ? t("Request cancelled", "Pyyntö on peruttu") : t("Purchase request", "Hankintapyyntö")}
        </strong>
      </div>
      {requestChanges.length > 0 && <RequestChanges changes={requestChanges} />}
      {otherOmissions.length > 0 && (
        <div>
          <p>{t("Removed from this request", "Poistettu tästä pyynnöstä")}</p>
          <ul>{otherOmissions.map((item) => <li key={item.itemId}>{requestedQuantity(item, locale)}</li>)}</ul>
        </div>
      )}
      {run.requirements?.budgetCents != null && (
        <p>{run.requirements.budgetMode === "preferred" ? t("Budget target", "Budjettitavoite") : t("Budget cap", "Budjettikatto")} {money(run.requirements.budgetCents, locale)}</p>
      )}
      {draft && "items" in draft ? (
        <>
          <DeliverySummary
            deadline={deadline}
            mode={mode}
            dates={draft.items.map(({ availableDate }) => availableDate)}
            itemCount={draft.items.length > 1 ? items?.length ?? draft.items.length : undefined}
            timeUnverified={draft.items.some(({ deliveryStatus }) => deliveryStatus === "time_unverified")}
          />
          <DraftLines lines={draft.items} items={items} staggered={draft.items.length > 1} />
          <div className="purchase-draft-total">
            <span>{t("Order estimate · ex VAT", "Tilauksen arvio · alv 0 %")}</span>
            <strong>{money(draft.totalCents, locale)}</strong>
          </div>
          {draft.caveats.includes("OVER_PREFERRED_BUDGET") && (
            <p className="purchase-caveats">{supplierIssueLabel("OVER_PREFERRED_BUDGET", locale)}</p>
          )}
        </>
      ) : items && comparison && "items" in comparison ? (
        <MultiItemComparison
          key={`${run.id}:${run.revision}`}
          items={items}
          comparison={comparison}
          eligibility={run.itemDraftEligibility}
          availability={run.itemAvailability}
          budgetCents={run.requirements?.budgetCents}
          preferredBudget={run.requirements?.budgetMode === "preferred"}
          deadline={deadline}
          mode={mode}
          disabled={cannotPrepare}
          readOnly={closed || pastDeadline}
          onPrepare={(selections) => void prepare({ selections })}
        />
      ) : items ? (
        <>
          <DeliverySummary deadline={deadline} mode={mode} />
          <ul>
            {items.map((item) => (
              <li key={item.itemId}>{requestedQuantity(item, locale)}</li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <DeliverySummary deadline={deadline} mode={mode} dates={[draft?.availableDate]} />
          <PurchaseLine line={draft ?? undefined} title={draft?.name ?? run.title} />
        </>
      )}
      {!draft && comparison && !("items" in comparison) && (
        <>
          <AvailabilityReason availability={run.itemAvailability?.item_1} />
          <ComparisonOptions
            options={optionsFor(comparison, run.draftEligibility)}
            disabled={cannotPrepare}
            readOnly={closed || pastDeadline}
            onSelect={(choice) => void prepare(choice)}
          />
        </>
      )}
      {!draft && partial && proposedOmissions.length > 0 && !closed && !pastDeadline && (
        <div>
          <p>{t("You can continue with the available items by removing these lines.", "Voit jatkaa saatavilla olevilla tuotteilla poistamalla nämä rivit.")}</p>
          <ul>{proposedOmissions.map((item) => <li key={item.itemId}>{requestedQuantity(item, locale)}</li>)}</ul>
          {partial.totalCents != null && (
            <p>{t("Remaining items estimate · ex VAT", "Jäljelle jäävien tuotteiden arvio · alv 0 %")} {money(partial.totalCents, locale)}</p>
          )}
          <div className="purchase-decision-actions">
            <button type="button" disabled={cannotPrepare}
              onClick={() => void execute("remove", "/tools/remove_request_items", {
                runId: run.id, revision: run.revision, itemIds: proposedOmissions.map(({ itemId }) => itemId),
              })}>
              {pending === "remove" ? t("Rechecking…", "Tarkistetaan uudelleen…") : t("Remove listed items and recheck", "Poista luetellut tuotteet ja tarkista uudelleen")}
            </button>
          </div>
        </div>
      )}
      {draft && !("items" in draft) && draft.caveats.length > 0 && (
        <p className="purchase-caveats">
          {formatCaveats(draft.caveats, locale)}
        </p>
      )}
      {run.status === "awaiting_approval" && draft && (
        <>
          <p>{requestChanges.length > 0
            ? t("Approval applies to this draft and the changes shown above.", "Hyväksyntä koskee tätä luonnosta ja yllä näkyviä muutoksia.")
            : draft.policy && draft.totalCents > draft.policy.automaticLimitCents
            ? t(
                `This draft exceeds the account’s ${money(draft.policy.automaticLimitCents, locale)} automatic spending limit.`,
                `Luonnos ylittää tilin automaattisen ostorajan (${money(draft.policy.automaticLimitCents, locale)}).`,
              )
            : draft.caveats.length
              ? t("The supplier or delivery notes require your review.", "Toimittaja- tai toimitushuomiot vaativat tarkistuksesi.")
              : t("Review and decide on this exact draft.", "Tarkista tämä luonnos ja tee päätös.")}</p>
          {approvalBlocked && run.approvalEligibility?.reasons.length && !run.approvalEligibility.reasons.includes(failure?.message ?? "") ? (
            <p role="status">{run.approvalEligibility.reasons.map((reason) => tradeMessage(reason, t)).join(" ")}</p>
          ) : null}
          <div className="purchase-decision-actions">
            <button
              className="trade-motion-button"
              disabled={disabled || approvalBlocked || pastDeadline}
              onClick={() => void decide(true)}
            >
              <Check size={18} />
              {pending === "decision" ? t("Saving…", "Tallennetaan…") : t("Allow draft", "Hyväksy luonnos")}
            </button>
            <button
              className="trade-motion-button"
              disabled={disabled}
              onClick={() => void decide(false)}
            >
              <X size={18} />
              {t("Decline", "Hylkää")}
            </button>
          </div>
        </>
      )}
      {pastDeadline && !closed && <p>{t("Delivery deadline has passed. Ask the assistant to review your request.", "Toimituksen määräaika on umpeutunut. Pyydä avustajaa tarkistamaan hankintapyyntö.")}</p>}
      {failure && <p role="alert">{tradeMessage(failure.message, t)}</p>}
      {!verified && !loading && (
        <div className="purchase-decision-actions">
          <button type="button" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>{t("Retry loading request", "Yritä ladata pyyntö uudelleen")}</button>
        </div>
      )}
      {canCompare && verified && (
        <div className="purchase-decision-actions">
          <button type="button" className="trade-motion-button" disabled={disabled} onClick={() => void execute("compare", "/tools/compare_products", { runId: run.id, revision: run.revision })}>
            <RefreshCw size={16} aria-hidden="true" />
            {pending === "compare" ? t("Checking…", "Tarkistetaan…") : comparison ? t("Refresh price and availability", "Päivitä hinta ja saatavuus") : t("Check price and availability", "Tarkista hinta ja saatavuus")}
          </button>
        </div>
      )}
      {canRehearse && (
        <div className="purchase-rehearsal">
          <p>{t("Record a simulated commitment at this draft’s fixed total. Supplier submission is disabled.", "Kirjaa harjoitustilaus luonnoksen kiinteällä loppusummalla. Tilausta ei lähetetä toimittajalle.")}</p>
          <div className="purchase-decision-actions">
            <button type="button" className="trade-motion-button" disabled={disabled || approvalBlocked || pastDeadline} onClick={() => void rehearse()}>
              <FlaskConical size={17} />
              {pending === "rehearse" ? t("Recording rehearsal…", "Tallennetaan harjoitusta…") : t("Commit rehearsal order", "Vahvista harjoitustilaus")}
            </button>
          </div>
        </div>
      )}
      {receipt && (
        <section className="purchase-receipt" aria-labelledby={`receipt-${run.id}`}>
          <h3 id={`receipt-${run.id}`}><ReceiptText size={18} /> {t("Rehearsal receipt", "Harjoitustilauksen kuitti")}</h3>
          <dl>
            <div><dt>{t("Fixed total · ex VAT", "Kiinteä summa · alv 0 %")}</dt><dd>{money(receipt.totalCents, locale)}</dd></div>
            <div><dt>{t("Authorized by", "Valtuutuksen peruste")}</dt><dd>{receipt.authorization === "buyer_approval" ? t("Buyer approval", "Ostajan hyväksyntä") : t("Account policy", "Tilin hankintasäännöt")}</dd></div>
            <div><dt>{t("Receipt ID", "Kuitin tunnus")}</dt><dd>{receipt.receiptId}</dd></div>
          </dl>
          <small>{t("Simulation only. Supplier submission is disabled.", "Harjoitustilaus. Lähetys toimittajalle on pois käytöstä.")}</small>
        </section>
      )}
      <small className="purchase-card-footnote">
        {run.draft ? t(`Draft v${run.revision}. `, `Luonnos v${run.revision}. `) : ""}
        {!receipt && t("No supplier order placed. Supplier submission is disabled.", "Tilausta ei ole lähetetty toimittajalle. Lähetys on pois käytöstä.")}
      </small>
      {loading && (
        <span className="purchase-refresh">
          <RefreshCw size={12} /> {t("Checking latest version", "Tarkistetaan uusin versio")}
        </span>
      )}
    </section>
  );
}
