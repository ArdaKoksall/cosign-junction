import { useI18n, type Translate } from "./i18n";
import { FormEvent, lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { helsinkiDateTime, parseHelsinkiDateTime } from "./helsinkiTime";
import { rehearsalMilkBudgetEuros, type KitchenBrief } from "./kitchenBriefs";
import {
  LayoutDashboard,
  WalletCards,
  CheckCheck,
  ClipboardList,
  FileCheck2,
  History,
  Inbox,
  RefreshCw,
  ShieldCheck,
  Store,
  X,
  CircleAlert,
  BookOpen,
} from "lucide-react";
import { Button } from "./components/ui";
import { CoSignBrand } from "./components/CoSignBrand";
import { WorkspaceHeader } from "./components/WorkspaceHeader";
import { DisplayPreferences } from "./components/DisplayPreferences";
import { SimulatorAccess } from "./components/SimulatorAccess";
import { RequestDecisionTrail } from "./components/RequestDecisionTrail";
import { ApprovalScreen } from "./screens/ApprovalScreen";
import { BasketScreen } from "./screens/BasketScreen";
import { DashboardScreen } from "./screens/DashboardScreen";
import { RequestWorkspaceScreen } from "./screens/RequestWorkspaceScreen";
import { OrderHistoryScreen } from "./screens/OrderHistoryScreen";
import { SupplierLookupScreen } from "./screens/SupplierLookupScreen";
import { lookupSupplierDates, type SupplierLookupResult } from "./supplierLookup";
import { describeChoice, type OptionChoice } from "./optionChoice";
import { RequestScreen } from "./screens/RequestScreen";
import { RoutineMilkScreen } from "./screens/RoutineMilkScreen";
import { ReceiptScreen } from "./screens/ReceiptScreen";
import {
  approveProposal,
  commitProposal,
  compareRequest,
  createRehearsalQuote,
  createRequest,
  getOrder,
  getRecentOrders,
  getRehearsalQuote,
  getCapabilities,
  getSavedRequest,
  getSavedRequests,
  injectPriceChange,
  resetDemo,
} from "./api";
import {
  clearRecentOrders,
  saveRecentOrder,
} from "./storage";
import {
  ApiError,
  type BudgetEstimate,
  type CatalogProduct,
  type CompareResponse,
  type CreateRequestBody,
  type OrderResponse,
  type ProductRequirement,
  type QuantityUnit,
  type RankingObjective,
  type RecentOrder,
  type SavedRequest,
  type Screen,
} from "./types";

const CatalogScreen = lazy(() => import("./screens/CatalogScreen").then(({ CatalogScreen }) => ({ default: CatalogScreen })));
const SupplierComparisonScreen = lazy(() => import("./screens/SupplierComparisonScreen")
  .then(({ SupplierComparisonScreen }) => ({ default: SupplierComparisonScreen })));

function toLocalDeadline(instant: Date): string {
  const offset = instant.getTimezoneOffset();
  const local = new Date(instant.getTime() - offset * 60_000);
  return local.toISOString().slice(0, 16);
}

type DeadlineFields = { date: string; time: string; instant?: string };
type RequestOverrides = Partial<{
  deadlineIso: string; requirements: ProductRequirement[]; freeFromAllergen: string[]; budgetCents: number;
  productQuery: string; selectedProductId: string; mondayMilk: boolean; notice: string;
}>;
const noIntakeSuggestions = { product: false, quantity: false, unit: false, deadline: false, budget: false, ranking: false };

function deadlineFields(instant: Date, simulator: boolean): DeadlineFields {
  const [date, time] = (simulator ? toLocalDeadline(instant) : helsinkiDateTime(instant)).split("T");
  return { date, time, instant: instant.toISOString() };
}

function nextHelsinkiMonday(): string {
  const today = helsinkiDateTime(new Date()).slice(0, 10);
  const monday = new Date(`${today}T00:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() + ((8 - monday.getUTCDay()) % 7 || 7));
  return monday.toISOString().slice(0, 10);
}

function defaultDeadline(simulator: boolean): DeadlineFields {
  const next = new Date();
  next.setDate(next.getDate() + ((8 - next.getDay()) % 7 || 7));
  next.setHours(12, 0, 0, 0);
  return deadlineFields(next, simulator);
}

function deadlineInstant({ date, time, instant }: DeadlineFields, simulator: boolean) {
  if (instant || !date || !time) return instant;
  if (!simulator) return parseHelsinkiDateTime(date, time);
  const local = new Date(`${date}T${time}`);
  if (Number.isFinite(local.getTime())) return local.toISOString();
}

function clearRequestHandoff() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("request")) return;
  url.searchParams.delete("request");
  window.history.replaceState(window.history.state, "", url);
}

function defaultCatalogUnit(product: CatalogProduct): QuantityUnit {
  return product.amountDimension === "g" ? "kg" : product.amountDimension === "ml" ? "L"
    : ["KI", "CS"].includes(product.salesUnit) ? "case" : "each";
}

function errorText(err: unknown, t: Translate): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return t("Something went wrong.", "Virhetilanne.");
}

export function App() {
  const { t, locale } = useI18n();
  const [screen, setScreen] = useState<Screen>("dashboard");
  const reduceMotion = useReducedMotion();
  const [busy, setBusy] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ screen: Screen; text: string } | null>(null);
  const [isSimulator, setIsSimulator] = useState(false);
  const [capabilitiesReady, setCapabilitiesReady] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [connectedRehearsalEnabled, setConnectedRehearsalEnabled] = useState(false);
  const workspaceReady = capabilitiesReady && (!authRequired || signedIn);
  const previousView = useRef({ screen, signedIn });
  useEffect(() => {
    const previous = previousView.current;
    if (previous.screen === screen && previous.signedIn === signedIn) return;
    previousView.current = { screen, signedIn };
    window.scrollTo({ top: 0 });
    mainRef.current?.focus({ preventScroll: true });
  }, [screen, signedIn]);
  useEffect(() => {
    let active = true;
    getCapabilities().then((capabilities) => {
      if (active) {
        setIsSimulator(capabilities.simulatorEnabled);
        setAuthRequired(capabilities.purchasingAuthRequired === true);
        setConnectedRehearsalEnabled(capabilities.connectedRehearsalEnabled === true);
        setCapabilitiesReady(true);
      }
    }).catch((err: unknown) => {
      if (active) setError(t(`Could not load supplier connection status. ${errorText(err, t)}`, `Toimittajayhteyden tilaa ei voitu ladata. ${errorText(err, t)}`));
    });
    return () => { active = false; };
  }, []);

  const [quantity, setQuantity] = useState(0);
  const [unit, setUnit] = useState<QuantityUnit>();
  const intakeSuggestions = useRef({ ...noIntakeSuggestions });
  const [requirements, setRequirements] = useState<ProductRequirement[]>([]);
  const [freeFromAllergen, setFreeFromAllergen] = useState<string[]>([]);
  const [rankingObjective, setRankingObjective] = useState<RankingObjective>();
  const [deadline, setDeadline] = useState<DeadlineFields>({ date: "", time: "" });
  const deadlineIso = deadlineInstant(deadline, isSimulator);
  const [budgetEuros, setBudgetEuros] = useState<number | null>(null);
  const [budgetEstimate, setBudgetEstimate] = useState<BudgetEstimate | null>(null);
  const [productQuery, setProductQuery] = useState("");
  const [selectedProductId, setSelectedProductId] = useState<string | undefined>();
  const [mondayMilk, setMondayMilk] = useState(false);

  const [requestId, setRequestId] = useState<string | null>(null);
  const submittedDraft = useRef<{ contents: string; id: string } | null>(null);
  const [handoff, setHandoff] = useState(() => new URLSearchParams(window.location.search).get("request"));
  const [proposal, setProposal] = useState<CompareResponse | null>(null);
  const [rehearsalQuote, setRehearsalQuote] = useState<CompareResponse | null>(null);
  const [rehearsalOrderId, setRehearsalOrderId] = useState<string | null>(null);
  const [previousProposal, setPreviousProposal] =
    useState<CompareResponse | null>(null);
  const [approvedVersion, setApprovedVersion] = useState<number | null>(null);
  const [priceDrift, setPriceDrift] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(() =>
    crypto.randomUUID(),
  );
  const [order, setOrder] = useState<OrderResponse | null>(null);
  const [replayableOrderId, setReplayableOrderId] = useState<string | null>(null);
  const [recoverId, setRecoverId] = useState("");
  const [recent, setRecent] = useState<RecentOrder[]>([]);
  const [savedRequests, setSavedRequests] = useState<SavedRequest[]>([]);
  const showDashboard = screen === "dashboard";
  const canReadOrders = isSimulator || (connectedRehearsalEnabled && signedIn);
  const needsOrderHistory = canReadOrders && (showDashboard || screen === "history");
  useEffect(() => {
    if (!workspaceReady || !showDashboard) return;
    const controller = new AbortController();
    getSavedRequests({}, controller.signal).then(({ requests }) => {
      if (!controller.signal.aborted) setSavedRequests(requests);
    }).catch((err: unknown) => {
      if (!controller.signal.aborted) setError(t(`Could not refresh recent requests. ${errorText(err, t)}`, `Viimeisimpiä pyyntöjä ei voitu päivittää. ${errorText(err, t)}`));
    });
    return () => controller.abort();
  }, [showDashboard, workspaceReady]);
  useEffect(() => {
    if (!workspaceReady || !needsOrderHistory) return;
    const controller = new AbortController();
    getRecentOrders(controller.signal).then(({ orders }) => {
      if (!controller.signal.aborted) setRecent(orders);
    }).catch((err: unknown) => {
      if (!controller.signal.aborted) setError(t(`Could not refresh order history. ${errorText(err, t)}`, `Tilaushistoriaa ei voitu päivittää. ${errorText(err, t)}`));
    });
    return () => controller.abort();
  }, [needsOrderHistory, screen, workspaceReady]);
  const [liveDate, setLiveDate] = useState(nextHelsinkiMonday);
  const [liveResult, setLiveResult] = useState<SupplierLookupResult | null>(null);
  const [lookupSkus, setLookupSkus] = useState<string[] | undefined>();
  const [catalogSku, setCatalogSku] = useState<string>();

  const checkoutProposal = isSimulator ? proposal : rehearsalQuote;
  const eligible = proposal?.offers.filter((offer) => offer.eligible) ?? [];
  const rejected = proposal?.offers.filter((offer) => !offer.eligible) ?? [];
  const supplierComparison = proposal?.comparisonMode === "supplier_observations";
  const placed = checkoutProposal?.status === "placed" || replayableOrderId !== null || rehearsalOrderId !== null;
  const approved =
    approvedVersion !== null &&
    approvedVersion === checkoutProposal?.version &&
    !priceDrift;

  const budgetCents = Math.round((budgetEuros ?? 0) * 100);
  const overBudget = checkoutProposal ? checkoutProposal.totalCents > budgetCents : false;

  const deltaCents = useMemo(() => {
    if (!proposal || !previousProposal) return null;
    return proposal.totalCents - previousProposal.totalCents;
  }, [proposal, previousProposal]);

  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (err) {
      setError(errorText(err, t));
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  function startNewRequest() {
    clearRequestHandoff();
    submittedDraft.current = null;
    setRequestId(null);
    setProposal(null);
    setRehearsalQuote(null);
    setRehearsalOrderId(null);
    setPreviousProposal(null);
    setApprovedVersion(null);
    setPriceDrift(false);
    setOrder(null);
    setReplayableOrderId(null);
    setIdempotencyKey(crypto.randomUUID());
    setQuantity(0);
    setUnit(isSimulator ? "L" : undefined);
    intakeSuggestions.current = { ...noIntakeSuggestions };
    setRequirements(isSimulator ? ["lactose-free"] : []);
    setFreeFromAllergen([]);
    setRankingObjective(undefined);
    setDeadline(isSimulator ? defaultDeadline(true) : { date: "", time: "" });
    setBudgetEuros(null);
    setBudgetEstimate(null);
    setProductQuery(isSimulator ? "milk" : "");
    setSelectedProductId(undefined);
    setMondayMilk(false);
    setNotice(null);
    setScreen("request");
  }

  function loadMondayMilk() {
    setMondayMilk(true);
    setSelectedProductId(undefined);
    setProductQuery("plain drinking milk");
    setQuantity(1000);
    setUnit("L");
    intakeSuggestions.current = { ...noIntakeSuggestions };
    setRequirements(["lactose-free"]);
    setFreeFromAllergen([]);
    setRankingObjective(undefined);
    const monday = nextHelsinkiMonday();
    const deadline = parseHelsinkiDateTime(monday, "11:00");
    if (deadline) setDeadline(deadlineFields(new Date(deadline), isSimulator));
    setBudgetEuros(connectedRehearsalEnabled ? rehearsalMilkBudgetEuros : 1450);
    setBudgetEstimate(null);
  }

  function loadKitchenBrief(brief: KitchenBrief) {
    startNewRequest();
    if (brief.mondayMilk) {
      loadMondayMilk();
      return;
    }
    setProductQuery(brief.query);
    setQuantity(brief.quantityLiters);
    setUnit("L");
    setDeadline(defaultDeadline(isSimulator));
    setRequirements(brief.diet === "lactose-free" ? ["lactose-free"] : []);
    setBudgetEuros(brief.budgetEuros);
  }

  function openCatalogProduct(product: CatalogProduct, appliedRequirements: ProductRequirement[], allergens: string[]) {
    startNewRequest();
    setProductQuery(product.name.slice(0, 120));
    setSelectedProductId(product.id);
    setUnit(defaultCatalogUnit(product));
    setRequirements(appliedRequirements);
    setFreeFromAllergen(allergens);
  }

  function selectRequestProduct(product: CatalogProduct, appliedRequirements: ProductRequirement[]) {
    intakeSuggestions.current.product = false;
    setProductQuery(product.name.slice(0, 120));
    setSelectedProductId(product.id);
    setMondayMilk(false);
    if (!quantity && !unit) setUnit(defaultCatalogUnit(product));
    setRequirements(appliedRequirements);
    clearBudgetEstimate();
  }

  function editProductRequirements(next: ProductRequirement[]) {
    setRequirements(next);
    if (next.length !== 1 || next[0] !== "lactose-free") setMondayMilk(false);
    clearBudgetEstimate();
  }

  function editAllergenRequirements(next: string[]) {
    setFreeFromAllergen(next);
    if (next.length) setMondayMilk(false);
    clearBudgetEstimate();
  }

  function checkCatalogSku(sku: string) {
    setLiveResult(null);
    setLookupSkus([sku]);
    setScreen("lookup");
  }

  function checkComparisonDates() {
    const ids = proposal?.observations?.map(({ productId }) => productId);
    if (!ids?.length) return;
    setLiveDate(deadline.date);
    setLiveResult(null);
    setLookupSkus(ids);
    setScreen("lookup");
  }

  function inspectComparisonProduct(sku: string) {
    setLiveDate(deadline.date);
    setCatalogSku(sku);
    setScreen("catalog");
  }

  function clearBudgetEstimate() {
    if (!budgetEstimate) return;
    setBudgetEstimate(null);
    setBudgetEuros(null);
  }

  function editRequirement() {
    clearRequestHandoff();
    submittedDraft.current = null;
    setRequestId(null);
    setProposal(null);
    setRehearsalQuote(null);
    setRehearsalOrderId(null);
    setApprovedVersion(null);
    setPreviousProposal(null);
    setScreen("request");
  }

  /** The structured body for POST /api/requests: what the form sends, and what an external agent sends. */
  function requestInput(values: {
    deadline: string; unit: QuantityUnit; requirements: ProductRequirement[]; freeFromAllergen: string[];
    budgetCents: number; query: string; productId?: string; mondayMilk: boolean;
  }): CreateRequestBody {
    return {
      ...(isSimulator ? { quantityLiters: quantity } : { quantity, unit: values.unit }),
      deadline: values.deadline,
      diet: isSimulator || values.requirements.includes("lactose-free") ? "lactose-free" : "none",
      requirements: isSimulator || !values.requirements.length ? undefined : values.requirements,
      freeFromAllergen: isSimulator || !values.freeFromAllergen.length ? undefined : values.freeFromAllergen,
      rankingObjective: isSimulator ? undefined : rankingObjective,
      budgetCents: values.budgetCents,
      query: isSimulator || !values.productId ? values.query : undefined,
      productId: isSimulator ? undefined : values.productId,
      preset: values.mondayMilk ? "monday_milk" as const : undefined,
    };
  }

  async function onCreateAndCompare(event?: FormEvent, overrides: RequestOverrides = {}) {
    event?.preventDefault();
    const { notice: compareNotice, ...chosen } = overrides;
    const values = { deadlineIso, requirements, freeFromAllergen, budgetCents, productQuery, selectedProductId, mondayMilk, ...chosen };
    const { requirements: requestRequirements, freeFromAllergen: requestAllergens, productQuery: requestQuery, selectedProductId: requestProductId } = values;
    if (!values.deadlineIso || !unit) return;
    await run(async () => {
      const input = requestInput({
        deadline: values.deadlineIso!, unit, requirements: requestRequirements, freeFromAllergen: requestAllergens,
        budgetCents: values.budgetCents, query: requestQuery, productId: requestProductId, mondayMilk: values.mondayMilk,
      });
      const contents = JSON.stringify(input);
      let id = submittedDraft.current?.contents === contents ? submittedDraft.current.id : undefined;
      if (!id) {
        const created = await createRequest(input);
        id = created.requestId;
        const savedInput = { ...input, diet: created.diet ?? input.diet, requirements: created.requirements ?? input.requirements };
        if (created.requirements) setRequirements(created.requirements);
        else if (created.diet === "lactose-free") setRequirements((previous) => [...new Set([...previous, "lactose-free" as const])]);
        submittedDraft.current = { id, contents: JSON.stringify(savedInput) };
        const saved = { ...savedInput, query: requestQuery, id, createdAt: new Date().toISOString() };
        setSavedRequests((previous) => [saved, ...previous].slice(0, 50));
      }
      setOrder(null);
      setReplayableOrderId(null);
      setRehearsalQuote(null);
      setRehearsalOrderId(null);
      setRequestId(id);
      const compared = await compareRequest(id);
      intakeSuggestions.current = { ...noIntakeSuggestions };
      setPreviousProposal(null);
      setProposal(compared);
      setApprovedVersion(null);
      setPriceDrift(false);
      setIdempotencyKey(crypto.randomUUID());
      setNotice(compareNotice ? { screen: "compare", text: compareNotice } : null);
      setScreen("compare");
    });
  }

  /** Applies a chosen runner-up to the request. Compares straight away, or opens the form to edit first. */
  function chooseOption(choice: OptionChoice, compareNow: boolean) {
    const nextRequirements = requirements.filter((requirement) => !choice.removeRequirements.includes(requirement));
    const nextAllergens = freeFromAllergen.filter((code) => !choice.removeAllergens.includes(code));
    const nextBudgetCents = choice.budgetCents != null ? Math.max(choice.budgetCents, budgetCents) : budgetCents;
    const nextDeadline: DeadlineFields = choice.deliveryDate ? { date: choice.deliveryDate, time: deadline.time } : deadline;
    const nextDeadlineIso = deadlineInstant(nextDeadline, isSimulator);
    const name = choice.name.slice(0, 120);
    const changes = describeChoice(choice, locale).join("; ");
    editRequirement();
    intakeSuggestions.current = { ...noIntakeSuggestions };
    setProductQuery(name);
    setSelectedProductId(choice.productId);
    setMondayMilk(false);
    setRequirements(nextRequirements);
    setFreeFromAllergen(nextAllergens);
    setBudgetEuros(nextBudgetCents / 100);
    setBudgetEstimate(null);
    setDeadline(nextDeadline);
    if (compareNow && nextDeadlineIso && Date.parse(nextDeadlineIso) > Date.now()) {
      void onCreateAndCompare(undefined, {
        deadlineIso: nextDeadlineIso, requirements: nextRequirements, freeFromAllergen: nextAllergens, budgetCents: nextBudgetCents,
        productQuery: name, selectedProductId: choice.productId, mondayMilk: false,
        notice: t(`Switched to ${choice.name}. Changes: ${changes}. Edit the request to change anything else.`, `Tuotteeksi vaihdettiin ${choice.name}. Muutokset: ${changes}. Muokkaa pyyntöä, jos haluat tehdä muita muutoksia.`),
      });
    } else {
      setNotice({ screen: "request", text: t(`Request updated for ${choice.name}. Changes: ${changes}. Review it, then compare.`, `Pyyntö päivitettiin tuotteelle ${choice.name}. Muutokset: ${changes}. Tarkista pyyntö ja tee vertailu.`) });
    }
  }

  async function onRefreshCompare() {
    if (!requestId) return;
    await run(async () => {
      const compared = await compareRequest(requestId);
      setProposal(compared);
      setScreen("compare");
    });
  }

  async function onOpenRequest(id: string, fromHandoff = false) {
    await run(async () => {
      const { request, comparison, approvedVersion, placedOrderId } = await getSavedRequest(id);
      const rehearsal = connectedRehearsalEnabled && signedIn ? await getRehearsalQuote(id) : null;
      const orderId = rehearsal?.placedOrderId ?? placedOrderId;
      const receipt = orderId ? await getOrder(orderId) : null;
      if (!fromHandoff) clearRequestHandoff();
      submittedDraft.current = null;
      setRequestId(request.id);
      setProductQuery(request.query ?? "milk");
      setSelectedProductId(request.productId);
      setMondayMilk(request.preset === "monday_milk");
      setQuantity(request.quantity ?? request.quantityLiters ?? 0);
      setUnit(request.unit ?? "L");
      intakeSuggestions.current = { ...noIntakeSuggestions };
      setRequirements(request.requirements ?? (request.diet === "lactose-free" ? ["lactose-free"] : []));
      setFreeFromAllergen(request.freeFromAllergen ?? []);
      setRankingObjective(request.rankingObjective);
      setBudgetEuros(request.budgetCents / 100);
      setBudgetEstimate(null);
      setDeadline(deadlineFields(new Date(request.deadline), isSimulator));
      setOrder(receipt);
      setReplayableOrderId(null);
      setProposal(comparison);
      setRehearsalQuote(rehearsal?.quote ?? null);
      setRehearsalOrderId(rehearsal?.placedOrderId ?? null);
      setPreviousProposal(null);
      setApprovedVersion(rehearsal?.approvedVersion ?? approvedVersion);
      setPriceDrift(false);
      setNotice(null);
      setIdempotencyKey(crypto.randomUUID());
      setScreen(receipt ? "receipt" : comparison ? "compare" : "workspace");
    });
  }

  useEffect(() => {
    if (!workspaceReady || !handoff) return;
    setHandoff(null);
    void onOpenRequest(handoff, true);
  }, [workspaceReady, handoff]);

  function onRehearsalSignIn() {
    setSignedIn(true);
    if (!requestId) return;
    void run(async () => {
      const { quote, approvedVersion, placedOrderId } = await getRehearsalQuote(requestId);
      setRehearsalQuote(quote);
      setApprovedVersion(approvedVersion);
      setRehearsalOrderId(placedOrderId);
    });
  }

  async function onCreateRehearsal(productId: string) {
    if (!requestId || !proposal || !signedIn) return;
    await run(async () => {
      const quote = await createRehearsalQuote(requestId, proposal.version, productId);
      setRehearsalQuote(quote);
      setApprovedVersion(quote.status === "approved" ? quote.version : null);
      if (rehearsalQuote?.proposalId !== quote.proposalId || rehearsalQuote.version !== quote.version) {
        setIdempotencyKey(crypto.randomUUID());
      }
      setNotice(null);
      setScreen("review");
    });
  }

  async function onApprove() {
    if (!checkoutProposal) return;
    await run(async () => {
      const result = await approveProposal(
        checkoutProposal.proposalId,
        checkoutProposal.version,
      );
      if (!result.approved) {
        throw new ApiError(
          t("The server did not approve this revision.", "Palvelin ei hyväksynyt tätä versiota."),
          409,
          result,
        );
      }
      setApprovedVersion(result.version);
      setPriceDrift(false);
      setNotice(null);
      setScreen("review");
    });
  }

  async function onPriceChange() {
    if (!proposal) return;
    await run(async () => {
      await injectPriceChange(proposal.proposalId);
      setPreviousProposal(proposal);
      setApprovedVersion(null);
      setPriceDrift(true);
      if (requestId) {
        const compared = await compareRequest(requestId);
        setProposal(compared);
      }
      setNotice(null);
      setScreen("review");
    });
  }

  async function onCommit() {
    if (!checkoutProposal) return;
    await run(async () => {
      const result = await commitProposal(
        checkoutProposal.proposalId,
        checkoutProposal.version,
        idempotencyKey,
      );
      setOrder(result);
      setReplayableOrderId(result.orderId);
      if (rehearsalQuote) setRehearsalOrderId(result.orderId);
      setRecent(
        saveRecentOrder({
          orderId: result.orderId,
          status: result.status,
          totalCents: result.totalCents,
          savedAt: new Date().toISOString(),
        }),
      );
      setNotice(order?.orderId === result.orderId
        ? { screen: "receipt", text: t("Retry returned the same receipt.", "Uudelleenyritys palautti saman kuitin.") }
        : null);
      setScreen("receipt");
    });
  }

  async function onRetryCommit() {
    await onCommit();
  }

  async function onRecover(id = recoverId) {
    if (!id.trim()) return;
    await run(async () => {
      const result = await getOrder(id.trim());
      setOrder(result);
      setScreen("receipt");
    });
  }

  async function onReset() {
    await run(async () => {
      await resetDemo();
      clearRequestHandoff();
      submittedDraft.current = null;
      clearRecentOrders();
      setRecent([]);
      setSavedRequests([]);
      setRequestId(null);
      setProposal(null);
      setRehearsalQuote(null);
      setRehearsalOrderId(null);
      setPreviousProposal(null);
      setApprovedVersion(null);
      setPriceDrift(false);
      setOrder(null);
      setReplayableOrderId(null);
      setIdempotencyKey(crypto.randomUUID());
      setNotice({ screen: "dashboard", text: t("Demo reset. Saved orders and requests were cleared.", "Demo nollattiin. Tallennetut tilaukset ja pyynnöt poistettiin.") });
      setScreen("dashboard");
    });
  }

  async function onLiveLookup(productIds: string[], requestedDates: string[]) {
    await run(async () => {
      setLiveResult(null);
      setLiveResult(await lookupSupplierDates(productIds, requestedDates));
    });
  }

  const status = placed
    ? "Simulated order placed"
    : approved
      ? "Approved"
      : rehearsalQuote
        ? "Simulated quote ready"
        : supplierComparison
          ? "Supplier data checked"
          : proposal
            ? "Needs review"
            : "Draft";
  const statusLabels = {
    "Simulated order placed": t("Simulated order placed", "Testitilaus tehty"),
    Approved: t("Approved", "Hyväksytty"),
    "Simulated quote ready": t("Simulated quote ready", "Testitarjous valmis"),
    "Supplier data checked": t("Supplier data checked", "Toimittajatiedot tarkistettu"),
    "Needs review": t("Needs review", "Odottaa tarkistusta"),
    Draft: t("Draft", "Luonnos"),
  };
  const currentRequest = requestId ? {
    id: requestId,
    quantity,
    unit,
    productId: selectedProductId,
    budgetCents,
    deadline: deadlineIso ?? "",
    query: productQuery,
    status,
    statusLabel: statusLabels[status],
  } : null;
  const navItems = [
    { id: "dashboard" as const, label: t("Overview", "Yleiskatsaus"), Icon: LayoutDashboard },
    { id: "workspace" as const, label: t("Requests", "Pyynnöt"), Icon: Inbox },
    ...(checkoutProposal ? [{
      id: "review" as const, label: t("Approvals", "Hyväksynnät"), Icon: ShieldCheck,
      count: !approved && !placed ? 1 : undefined,
    }] : []),
    ...(!isSimulator ? [{ id: "catalog" as const, label: t("Catalog", "Tuoteluettelo"), Icon: BookOpen }] : []),
    { id: "lookup" as const, label: t("Supplier lookup", "Toimittajahaku"), Icon: Store },
    ...(canReadOrders ? [{
      id: "history" as const, label: t("Order history", "Tilaushistoria"), Icon: History,
      count: recent.length || undefined,
    }] : []),
    ...(isSimulator && authRequired ? [{ id: "routine" as const, label: t("Weekly milk", "Viikoittainen maitotilaus"), Icon: WalletCards }] : []),
  ];

  if (!capabilitiesReady && !error) return (
    <main className="access-page">
      <div className="workspace-loading">
        <CoSignBrand />
        <span role="status">{t("Opening workspace…", "Avataan työtilaa…")}</span>
        <DisplayPreferences />
      </div>
    </main>
  );
  if (authRequired && !signedIn) return <SimulatorAccess onConnect={() => setSignedIn(true)} />;

  return (
    <div
      className="purchasing-app"
      data-app-layout
    >
      <a className="skip-link" href="#main-content">
        {t("Skip to content ", "Siirry sisältöön ")}
      </a>
      <WorkspaceHeader
        screen={screen} navItems={navItems} busy={busy} isSimulator={isSimulator} isReady={capabilitiesReady}
        onNavigate={(destination) => {
          if (destination === "catalog") setCatalogSku(undefined);
          if (destination === "dashboard" || destination === "workspace" || destination === "history") clearRequestHandoff();
          setScreen(destination);
        }} onReset={() => void onReset()}
      />

      <main
        className="detail-panel"
        ref={mainRef}
        id="main-content"
        tabIndex={-1}
        aria-busy={busy}
      >
        <div className="detail-scroll workspace-width">
          <div className="screen-body">
            {error && (
              <div className="message error" role="alert">
                <CircleAlert size={18} />
                <span>{error}</span>
                <button
                  type="button"
                  aria-label={t("Dismiss error", "Sulje virheilmoitus")}
                  onClick={() => setError(null)}
                >
                  <X size={16} />
                </button>
              </div>
            )}
            {notice?.screen === screen && !error && (
              <div className="message success" role="status">
                <CheckCheck size={18} />
                <span>{notice.text}</span>
                <button
                  type="button"
                  aria-label={t("Dismiss notification", "Sulje ilmoitus")}
                  onClick={() => setNotice(null)}
                >
                  <X size={16} />
                </button>
              </div>
            )}
            {busy && (
              <div className="working-indicator" role="status">
                <RefreshCw size={14} />
                {t("Working on your request… ", "Käsitellään pyyntöä… ")}
              </div>
            )}

            <motion.div
              key={screen}
              className="screen-transition"
              initial={reduceMotion || screen === "dashboard" ? false : { opacity: .35, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: reduceMotion ? 0 : .26, ease: [.22, 1, .36, 1] }}
            >
              {screen === "dashboard" && <DashboardScreen
                connectedRehearsalEnabled={connectedRehearsalEnabled}
                canReadOrders={canReadOrders}
                busy={busy} isSimulator={isSimulator}
                currentRequest={currentRequest}
                savedRequests={savedRequests} recent={recent}
                onNewRequest={startNewRequest}
                onOpenCurrentRequest={() => setScreen(proposal ? "compare" : "workspace")}
                onOpenExample={loadKitchenBrief}
                onOpenCatalog={() => { setCatalogSku(undefined); setScreen("catalog"); }}
                onOpenRequests={() => setScreen("workspace")}
                onOpenLookup={() => setScreen("lookup")}
                onOpenHistory={() => setScreen("history")}
                onRecover={(id) => void onRecover(id)} onOpenRequest={(id) => void onOpenRequest(id)}
              />}

              {screen === "workspace" && <RequestWorkspaceScreen
                currentRequest={currentRequest} ready={workspaceReady} busy={busy}
                comparisonVersion={proposal?.version} approvedVersion={approvedVersion} onNewRequest={startNewRequest}
                onCompare={() => void onRefreshCompare()} onOpenCurrent={() => setScreen("compare")}
                onEditRequest={editRequirement}
                onOpenRequest={(id) => void onOpenRequest(id)}
              />}

              {screen === "request" && <RequestScreen
                busy={busy} isSimulator={isSimulator} mondayMilk={mondayMilk}
                agentRequest={deadlineIso && unit && productQuery.trim() ? requestInput({
                  deadline: deadlineIso, unit, requirements, freeFromAllergen, budgetCents, query: productQuery,
                  productId: selectedProductId, mondayMilk,
                }) : null}
                productQuery={productQuery} productId={selectedProductId} quantity={quantity} unit={unit} budgetEuros={budgetEuros} budgetEstimate={budgetEstimate}
                deadlineDate={deadline.date} deadlineTime={deadline.time} deadlineValid={Boolean(deadlineIso)}
                requirements={requirements} freeFromAllergen={freeFromAllergen} rankingObjective={rankingObjective}
                onMondayMilk={loadMondayMilk}
                onSelectProduct={selectRequestProduct}
                onQuery={(value) => {
                  intakeSuggestions.current.product = false;
                  setProductQuery(value);
                  setSelectedProductId(undefined);
                  setMondayMilk(false);
                  clearBudgetEstimate();
                }}
                onQuantity={(value) => {
                  intakeSuggestions.current.quantity = false;
                  setQuantity(value);
                  clearBudgetEstimate();
                }}
                onUnit={(value) => {
                  intakeSuggestions.current.unit = false;
                  setUnit(value);
                  if (value !== "L") setMondayMilk(false);
                  clearBudgetEstimate();
                }}
                onBudget={(value) => {
                  intakeSuggestions.current.budget = false;
                  setBudgetEuros(value);
                  setBudgetEstimate(null);
                }}
                onDeadline={(date, time) => {
                  intakeSuggestions.current.deadline = false;
                  setDeadline({ date, time });
                }}
                onRequirements={editProductRequirements}
                onFreeFromAllergen={editAllergenRequirements}
                onRankingObjective={(value) => {
                  intakeSuggestions.current.ranking = false;
                  setRankingObjective(value);
                }}
                onBack={() => setScreen("workspace")} onSubmit={onCreateAndCompare}
              />}

              {screen === "compare" && proposal && unit && (
                <Suspense fallback={<p className="working-indicator" role="status">{t("Opening comparison…", "Avataan vertailua…")}</p>}>
                  {supplierComparison ? <SupplierComparisonScreen
                    proposal={proposal} mondayMilk={mondayMilk} productQuery={productQuery}
                    quantity={quantity} unit={unit} requirements={requirements} freeFromAllergen={freeFromAllergen} budgetCents={budgetCents} deadline={deadlineIso ?? ""} exactProductId={selectedProductId} busy={busy}
                    onEdit={editRequirement} onRefresh={() => void onRefreshCompare()} onCheckDates={checkComparisonDates}
                    onInspectProduct={inspectComparisonProduct} deadlineDate={deadline.date} onChooseOption={chooseOption}
                    rehearsal={connectedRehearsalEnabled ? {
                      signedIn, quote: rehearsalQuote, hasOrder: rehearsalOrderId !== null,
                      onSignIn: onRehearsalSignIn, onCreate: (sku) => void onCreateRehearsal(sku),
                      onReview: () => setScreen("review"),
                      onReceipt: () => { if (rehearsalOrderId) void onRecover(rehearsalOrderId); },
                    } : undefined}
                  /> : <BasketScreen
                    proposal={proposal} quantityLiters={quantity} budgetCents={budgetCents}
                    eligible={eligible} rejected={rejected} overBudget={overBudget} busy={busy}
                    onRefresh={() => void onRefreshCompare()} onReview={() => setScreen("review")}
                  />}
                </Suspense>
              )}

              {screen === "review" && checkoutProposal && <ApprovalScreen
                proposal={checkoutProposal} eligible={eligible} busy={busy} hasOrder={placed}
                approved={approved} approvedVersion={approvedVersion} overBudget={overBudget}
                previousProposal={previousProposal} priceDrift={priceDrift} deltaCents={deltaCents}
                onApprove={() => void onApprove()} onCommit={() => void onCommit()}
                onPriceChange={isSimulator ? () => void onPriceChange() : undefined}
                onComparison={rehearsalQuote ? () => setScreen("compare") : undefined}
              />}

              {(screen === "compare" || screen === "review") && proposal && <RequestDecisionTrail
                key={proposal.requestId} requestId={proposal.requestId} revision={proposal.version} approvedVersion={approvedVersion}
                rehearsalRevision={screen === "review" ? rehearsalQuote?.version : undefined}
              />}

              {screen === "receipt" && order && <ReceiptScreen
                order={order} busy={busy} canRetry={Boolean(proposal) && order.orderId === replayableOrderId}
                onRefresh={() => void onRecover(order.orderId)} onNewRequest={startNewRequest}
                onRetry={() => void onRetryCommit()}
                onComparison={order.rehearsal && order.orderId === rehearsalOrderId && proposal ? () => setScreen("compare") : undefined}
              />}

              {screen === "routine" && <RoutineMilkScreen onReceipt={(id) => void onRecover(id)} />}

              {screen === "history" && <OrderHistoryScreen
                isSimulator={canReadOrders} busy={busy} recent={recent} recoverId={recoverId}
                onReference={setRecoverId} onRecover={(id) => void onRecover(id)}
                onNewRequest={startNewRequest}
              />}

              {screen === "catalog" && (
                <Suspense fallback={<p className="working-indicator" role="status">{t("Opening catalog…", "Avataan tuoteluetteloa…")}</p>}>
                  <CatalogScreen key={catalogSku ?? "browse"} initialSku={catalogSku} onUseProduct={openCatalogProduct} onCheckSku={checkCatalogSku}
                    onBackToComparison={catalogSku && proposal ? () => setScreen("compare") : undefined} />
                </Suspense>
              )}

              {screen === "lookup" && <SupplierLookupScreen
                busy={busy} date={liveDate} result={liveResult} initialSkus={lookupSkus}
                onDate={(date) => { setLiveDate(date); setLiveResult(null); }}
                onLookup={(productIds, requestedDates) => void onLiveLookup(productIds, requestedDates)}
              />}

              {(screen === "compare" || screen === "review") && !proposal && (
                <div className="empty-state">
                  <ClipboardList size={30} />
                  <h1>{t("Create a request first", "Luo ensin hankintapyyntö")}</h1>
                  <p>{t("Once a comparison is ready, you can review it here.", "Voit tarkastella valmista vertailua täällä.")}</p>
                  <Button onClick={startNewRequest}>{t("Prepare a request", "Valmistele hankintapyyntö")}</Button>
                </div>
              )}
              {screen === "receipt" && !order && (
                <div className="empty-state">
                  <FileCheck2 size={30} />
                  <h1>{t("No receipt selected", "Kuittia ei ole valittu")}</h1>
                  <Button onClick={() => setScreen("history")}>
                    {t("Open order history ", "Avaa tilaushistoria ")}
                  </Button>
                </div>
              )}
            </motion.div>
          </div>
        </div>
      </main>
    </div>
  );
}
