import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  ArrowUpRight,
  Link2,
  LogOut,
  Play,
  X,
  Search,
  ArrowRight,
  MessageCircle,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Workbench } from "./Workbench";
import { RequestIntake } from "./RequestIntake";
import { Connections } from "./Connections";
import { Button } from "../components/ui";
import { CoSignBrand, CosignName, CoSignMark } from "../components/CoSignBrand";
import {
  allergenLabel,
  allergenOptions,
  productRequirementLabel,
  productRequirementLabels,
} from "../productRequirements";
import {
  tradeApi,
  type Policy,
  type Run,
  type Session,
  type TradeEvent,
} from "./api";
import { AgentCharacter, AgentExperience } from "./AgentExperience";
import marketPhoto from "../assets/aimo-market.webp";
import { DisplayPreferences } from "../components/DisplayPreferences";
import { useI18n } from "../i18n";
import { scopeLabel, tradeMessage, type AgentClient } from "./tradeCopy";
import type { ProductRequirement } from "../types";
import "./trade.css";
import "./purchase-workflow.css";

export function ProductionApp() {
  const { t } = useI18n();
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [runs, setRuns] = useState<Run[]>([]);
  const [selected, setSelected] = useState(
    new URLSearchParams(location.search).get("run") ?? "",
  );
  const [loadedDetail, setDetail] = useState<Run | null>(null);
  const detail = loadedDetail?.id === selected ? loadedDetail : null;
  const [detailError, setDetailError] = useState("");
  const [events, setEvents] = useState<TradeEvent[]>([]);
  const [live, setLive] = useState(false);
  const [intakeOpen, setIntakeOpen] = useState(false);
  const [setupClient, setSetupClient] = useState<AgentClient>();
  const [requestFilter, setRequestFilter] = useState("all");
  const [tab, setTab] = useState(
    new URLSearchParams(location.search).get("page") || "workspace",
  );
  const reduced = useReducedMotion();
  useEffect(() => {
    const url = new URL(location.href);
    url.searchParams.set("page", tab);
    history.replaceState({}, "", url);
  }, [tab]);
  useEffect(() => {
    const back = () =>
      setTab(new URLSearchParams(location.search).get("page") || "workspace");
    window.addEventListener("popstate", back);
    return () => window.removeEventListener("popstate", back);
  }, []);
  const navigate = (page: string) => {
    if (page === tab) return;
    const url = new URL(location.href);
    url.searchParams.set("page", page);
    history.pushState({}, "", url);
    setTab(page);
  };
  const [agentOpen, setAgentOpen] = useState(Boolean(selected));
  const [newAgentTask, setNewAgentTask] = useState(false);
  const requestOpen = !newAgentTask && selected.startsWith("run_");
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!agentOpen || !session) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAgentOpen(false);
      if (event.key !== "Tab") return;
      const nodes = Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled), textarea, input, summary, a[href]",
        ) ?? [],
      ).filter((node) => node.offsetParent !== null);
      const first = nodes[0],
        last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", trap);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", trap);
      previous?.focus();
    };
  }, [agentOpen, session]);
  const [search, setSearch] = useState("");
  const [catalogQuery, setCatalogQuery] = useState("");
  const [instruction, setInstruction] = useState("");
  const [consent, setConsent] = useState<{
    name: string;
    redirectUri: string;
    scopes: string[];
  } | null>(null);
  const consentId = useRef(
    new URLSearchParams(location.search).get("authorize"),
  );
  const cursor = useRef("0");
  const selectedRef = useRef(selected);
  const accountId = session?.account.id;
  const accountRef = useRef(accountId);
  accountRef.current = accountId;
  const detailGeneration = useRef(0);
  const listGeneration = useRef(0);
  const loadDetail = useCallback(async (runId: string, owner: string) => {
    if (selectedRef.current !== runId || accountRef.current !== owner) return;
    const generation = ++detailGeneration.current;
    const stillSelected = () => selectedRef.current === runId && accountRef.current === owner
      && detailGeneration.current === generation;
    try {
      const current = await tradeApi<Run>(`/runs/${encodeURIComponent(runId)}`);
      if (!stillSelected()) return;
      if (current.id !== runId) throw new Error("Could not load this request.");
      setDetail(current);
      setDetailError("");
    } catch (e) {
      if (stillSelected()) setDetailError(e instanceof Error ? e.message : "Could not load this request.");
    }
  }, []);
  const reload = useCallback(async () => {
    const owner = accountRef.current;
    if (!owner) return;
    const runId = selectedRef.current;
    const generation = ++listGeneration.current;
    const rows = await tradeApi<Run[]>("/runs");
    if (accountRef.current !== owner || listGeneration.current !== generation) return;
    setRuns(rows);
    if (runId) await loadDetail(runId, owner);
  }, [loadDetail]);
  const action = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Operation failed");
    } finally {
      setBusy(false);
    }
  };
  const loadSession = useCallback(async () => {
    try {
      setSession(await tradeApi<Session>("/session"));
    } catch (e) {
      if ((e as { status?: number }).status !== 401)
        setError(e instanceof Error ? e.message : "Cannot connect");
    } finally {
      setChecking(false);
    }
  }, []);
  useEffect(() => {
    void loadSession();
  }, [loadSession]);
  useEffect(() => {
    if (!session) return;
    let active = true;
    void reload().catch((e) => setError(e.message));
    if (consentId.current)
      void tradeApi<typeof consent>(
        `/oauth/pending?id=${encodeURIComponent(consentId.current)}`,
      )
        .then(setConsent)
        .catch((e) => setError(e.message));
    const stream = new EventSource(
      `/api/events/stream?after=${cursor.current}`,
    );
    stream.onopen = () => {
      if (active) setLive(true);
    };
    stream.onerror = () => {
      if (active) setLive(false);
    };
    stream.addEventListener("session_expired", () => {
      if (!active) return;
      stream.close();
      setLive(false);
      setIntakeOpen(false);
      setSession(null);
      setRuns([]);
      setEvents([]);
      setDetail(null);
      accountRef.current = undefined;
      selectedRef.current = "";
      setSelected("");
      setAgentOpen(false);
      setConsent(null);
      cursor.current = "0";
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    stream.onmessage = (message) => {
      if (!active) return;
      let event: TradeEvent;
      try {
        event = JSON.parse(message.data);
        if (typeof event?.id !== "string") return;
      } catch {
        return;
      }
      cursor.current = event.id;
      setEvents((old) =>
        old.some((item) => item.id === event.id)
          ? old
          : [...old, event].slice(-500),
      );
      if (!timer)
        timer = setTimeout(() => {
          timer = undefined;
          void reload().catch((e) => setError(e.message));
        }, 250);
    };
    return () => {
      active = false;
      stream.close();
      clearTimeout(timer);
    };
  }, [accountId, reload]);
  useEffect(() => {
    if (!accountId || !selected) {
      setDetail(null);
      return;
    }
    let active = true;
    void loadDetail(selected, accountId);
    void tradeApi<TradeEvent[]>(`/events?runId=${encodeURIComponent(selected)}`)
      .then((rows) => {
        if (active)
          setEvents((old) => {
            const merged = new Map(
              [...old, ...rows].map((event) => [event.id, event]),
            );
            return [...merged.values()].sort(
              (a, b) => Number(a.id) - Number(b.id),
            );
          });
      })
      .catch((e) => { if (active) setError(e.message); });
    return () => {
      active = false;
    };
  }, [selected, accountId, loadDetail]);
  function openRun(runId: string) {
    setNewAgentTask(false);
    if (selectedRef.current !== runId) {
      setDetail(null);
      setDetailError("");
    }
    selectedRef.current = runId;
    setSelected(runId);
    setAgentOpen(true);
    const url = new URL(location.href);
    url.searchParams.set("run", runId);
    history.replaceState({}, "", url);
  }
  const selectedEvents = events.filter((event) => event.run_id === selected);
  if (checking)
    return (
      <main className="trade-login trade-login-loading">
        <p role="status">{t("Connecting to your workspace…", "Yhdistetään työtilaan…")}</p>
      </main>
    );
  if (!session)
    return (
      <main className="trade-login">
        <div className="trade-login-art">
          <CoSignBrand inverse />
          <h1>{t("Purchasing with your approval", "Hankinnat sinun päätökselläsi")}</h1>
          <img src={marketPhoto} alt="" />
        </div>
        <div className="trade-auth-main">
          <DisplayPreferences />
          <form
            className="trade-login-form"
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              void action(async () => {
                await tradeApi("/login", {
                  email: data.get("email"),
                  password: data.get("password"),
                });
                await loadSession();
              });
            }}
          >
            <h2>{t("Sign in", "Kirjaudu sisään")}</h2>
            <p>
              {consentId.current
                ? t("Sign in to connect an agent to your account.", "Kirjaudu sisään yhdistääksesi avustajan tiliisi.")
                : t("Sign in to review purchasing activity and manage your agents.", "Kirjaudu sisään tarkastellaksesi hankintoja ja hallitaksesi avustajia.")}
            </p>
            <label>
              {t("Email", "Sähköposti")}
              <input type="email" name="email" autoComplete="username" required />
            </label>
            <label>
              {t("Password", "Salasana")}
              <input
                type="password"
                name="password"
                autoComplete="current-password"
                required
              />
            </label>
            {error && (
              <p role="alert" className="trade-error">
                {tradeMessage(error, t)}
              </p>
            )}
            <Button type="submit" size="lg" disabled={busy}>
              {t("Sign in", "Kirjaudu sisään")} <ArrowUpRight size={18} />
            </Button>
            <p className="trade-muted">
              {t("Account access is provisioned by your administrator.", "Järjestelmänvalvojasi myöntää käyttöoikeuden.")}
            </p>
          </form>
        </div>
      </main>
    );
  return (
    <div className="trade-app">
      <header className="trade-header" inert={agentOpen}>
        <a className="trade-brand" href="/" aria-label={t("VALIO:Cosign overview", "VALIO:Cosign-yleiskatsaus")}>
          <CoSignBrand />
        </a>
        <form
          className="market-search"
          onSubmit={(event) => {
            event.preventDefault();
            setCatalogQuery(search);
            navigate("products");
          }}
        >
          <Search size={21} />
          <input
            aria-label={t("Search products", "Hae tuotteita")}
            placeholder={t("Search products for your kitchen", "Hae tuotteita keittiöösi")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            required
          />
          <button type="submit" aria-label={t("Search catalog", "Hae tuotevalikoimasta")}>
            <ArrowRight size={19} />
          </button>
        </form>
        <nav aria-label={t("Main navigation", "Päävalikko")}>
          {[
            ["workspace", t("Overview", "Yleiskatsaus")],
            ["products", t("Products", "Tuotteet")],
            ["requests", t("Requests", "Pyynnöt")],
            ["connections", t("Connections", "Yhteydet")],
            ["policy", t("Settings", "Asetukset")],
          ].map(([value, title]) => (
            <button
              key={value}
              aria-current={tab === value ? "page" : undefined}
              onClick={() => {
                if (value === "connections") setSetupClient(undefined);
                if (value === "requests" && tab !== "requests") setRequestFilter("all");
                navigate(value);
              }}
            >
              {title}
              {tab === value && (
                <motion.span
                  className="work-nav-indicator"
                  layoutId="active-page"
                  transition={{ duration: reduced ? 0 : 0.25 }}
                />
              )}
            </button>
          ))}
        </nav>
        <button
          className="header-chat-button"
          onClick={() => setAgentOpen(true)}
        >
          <MessageCircle size={18} />
          {t("Assistant", "Avustaja")}
        </button>
        <DisplayPreferences />
        <div className="trade-account">
          <span>{session.account.name}</span>
          <button
            aria-label={t("Sign out", "Kirjaudu ulos")}
            onClick={() =>
              void action(async () => {
                await tradeApi("/logout", {});
                setSession(null);
                setRuns([]);
                setEvents([]);
                setDetail(null);
                accountRef.current = undefined;
                selectedRef.current = "";
                setSelected("");
                setAgentOpen(false);
                setIntakeOpen(false);
                setLive(false);
                setConsent(null);
                cursor.current = "0";
              })
            }
          >
            <LogOut size={18} />
          </button>
        </div>
      </header>
      <AnimatePresence mode="wait" initial={false}>
        <motion.main
          key={tab}
          className="trade-main"
          inert={agentOpen}
          initial={reduced ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: reduced ? 0 : 0.18 }}
        >
          {error && (
            <div role="alert" className="trade-error">
              {tradeMessage(error, t)}
              <button aria-label={t("Dismiss error", "Sulje virheilmoitus")} onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {consent && (
            <section className="trade-consent">
              <Link2 />
              <h2>{t(`Connect ${consent.name}?`, `Yhdistetäänkö ${consent.name}?`)}</h2>
              <p>
                {t("This client will access purchasing data for", "Sovellus saa pääsyn seuraavan tilin hankintatietoihin:")}{" "}
                <strong>{session.account.name}</strong>.{" "}
                {t(
                  "Your account rules still apply. It cannot approve purchases on your behalf.",
                  "Tilisi hankintasäännöt pysyvät voimassa. Sovellus ei voi hyväksyä hankintoja puolestasi.",
                )}
              </p>
              <p>
                {t("Return address:", "Paluuosoite:")}{" "}
                <code>{new URL(consent.redirectUri).origin}</code>
              </p>
              <ul>
                {consent.scopes.map((scope) => (
                  <li key={scope}>{scopeLabel(scope, t)}</li>
                ))}
              </ul>
              <div className="trade-actions">
                {[true, false].map((allow) => (
                  <Button
                    key={String(allow)}
                    disabled={busy}
                    variant={allow ? "primary" : "secondary"}
                    onClick={() =>
                      void action(async () => {
                        const result = await tradeApi<{ redirect: string }>(
                          "/oauth/consent",
                          { id: consentId.current, allow },
                        );
                        location.assign(result.redirect);
                      })
                    }
                  >
                    {allow ? t("Allow connection", "Salli yhteys") : t("Decline", "Hylkää")}
                  </Button>
                ))}
              </div>
            </section>
          )}
          {!consent &&
            (tab === "connections" ? (
              <Connections session={session} action={action} busy={busy} initialClient={setupClient} />
            ) : tab === "policy" ? (
              <PolicyEditor
                session={session}
                action={action}
                busy={busy}
                onSave={loadSession}
              />
            ) : (
              <Workbench
                page={tab}
                orderRehearsalAvailable={session.orderRehearsalAvailable}
                valioStubMode={session.valioStubMode}
                onPage={(page, filter = "all") => {
                  if (page === "connections") setSetupClient(undefined);
                  if (page === "requests") setRequestFilter(filter);
                  navigate(page);
                }}
                onConnect={(client) => {
                  setSetupClient(client);
                  navigate("connections");
                }}
                accountId={session.account.id}
                runs={runs}
                events={events}
                query={catalogQuery}
                onQuery={setCatalogQuery}
                onOpenRun={openRun}
                onNewRequest={() => setIntakeOpen(true)}
                initialRequestFilter={requestFilter}
                onRefresh={() => void reload().catch((e) => setError(e.message))}
                onAsk={(text = "") => {
                  setNewAgentTask(true);
                  setInstruction(text);
                  setAgentOpen(true);
                }}
              />
            ))}
        </motion.main>
      </AnimatePresence>
      {intakeOpen && (
        <RequestIntake
          onClose={() => setIntakeOpen(false)}
          onCreate={(runId) => {
            setIntakeOpen(false);
            openRun(runId);
            void reload().catch((e) => setError(e.message));
          }}
        />
      )}
      {!agentOpen && (
        <button
          className="market-assistant-launcher"
          aria-label={t("Chat with Cosign", "Keskustele Cosign-avustajan kanssa")}
          aria-haspopup="dialog"
          onClick={() => setAgentOpen(true)}
        >
          <AgentCharacter size="small" status={detail?.status} />
          <span>{t("Chat with assistant", "Keskustele avustajan kanssa")}</span>
          <MessageCircle size={18} />
        </button>
      )}
      {agentOpen && (
        <div className="market-drawer-layer">
          <button
            className="market-scrim"
            tabIndex={-1}
            aria-label={t("Close assistant", "Sulje avustaja")}
            onClick={() => setAgentOpen(false)}
          />
          <aside
            ref={panelRef}
            className="market-drawer"
            role="dialog"
            aria-modal="true"
            aria-label={requestOpen ? t("Purchase request", "Hankintapyyntö") : t("Cosign assistant", "Cosign-avustaja")}
            onKeyDown={(event) => {
              if (event.key === "Escape") setAgentOpen(false);
            }}
          >
            <header>
              <CoSignMark className="market-assistant-brand" />
              <div>
                <h2>{requestOpen ? t("Purchase request", "Hankintapyyntö") : <><CosignName />{t(" assistant", "-avustaja")}</>}</h2>
                <p>
                  {!requestOpen && "NVIDIA Nemotron · "}
                  {live ? t("Live updates", "Reaaliaikaiset päivitykset") : t("Connecting to live updates…", "Yhdistetään reaaliaikaisiin päivityksiin…")}
                </p>
                {session.valioStubMode && <p>{t("Simulated supplier prices and stock", "Simuloidut toimittajahinnat ja varastosaldot")}</p>}
              </div>
              <button
                aria-label={t("Close assistant panel", "Sulje avustajapaneeli")}
                onClick={() => setAgentOpen(false)}
              >
                <X />
              </button>
            </header>
            <div className="market-drawer-body">
              {!newAgentTask && selected && !detail ? (
                detailError ? (
                  <div className="agent-error">
                    <p role="alert">{tradeMessage(detailError, t)}</p>
                    <button type="button" onClick={() => accountId && void loadDetail(selected, accountId)}>{t("Retry loading request", "Yritä ladata pyyntö uudelleen")}</button>
                  </div>
                ) : <p role="status">{t("Loading request…", "Ladataan pyyntöä…")}</p>
              ) : <AgentExperience
                key={newAgentTask ? "new" : selected}
                autoScroll={!requestOpen}
                assistantAvailable={Boolean(session.nemotronModel)}
                onStop={() =>
                  void action(async () => {
                    if (detail && detail.id === selectedRef.current) {
                      await tradeApi(`/runs/${detail.id}/cancel`, {});
                      await reload();
                    }
                  })
                }
                run={newAgentTask ? null : detail}
                events={newAgentTask ? [] : selectedEvents}
                onOpenRun={openRun}
                purchaseRuns={runs}
                orderRehearsalAvailable={session.orderRehearsalAvailable}
                onDecision={() => void reload().catch((e) => setError(e.message))}
                onAsk={(text) => {
                  if (requestOpen) setNewAgentTask(true);
                  setInstruction(text);
                }}
              />}
            </div>{" "}
            {!requestOpen && <section className="trade-compose drawer-compose">
              <div>
                <span className="trade-eyebrow">{t("YOUR NEMOTRON AGENT", "NEMOTRON-AVUSTAJASI")}</span>
                <h2>{t("What does your kitchen need?", "Mitä keittiösi tarvitsee?")}</h2>
                <p>
                  {t(
                    "Include quantities and dietary needs, plus any budget or delivery preferences.",
                    "Kerro määrät ja ruokavaliovaatimukset sekä mahdolliset budjetti- ja toimitustoiveet.",
                  )}
                </p>
              </div>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!newAgentTask && selected && !detail) return;
                  void action(async () => {
                    const runId = selectedRef.current;
                    const owner = accountRef.current;
                    const continuing =
                      !newAgentTask &&
                      detail?.id === runId &&
                      detail?.id.startsWith("job_") &&
                      ["completed", "failed"].includes(detail.status);
                    const result =
                      continuing && detail
                        ? (await tradeApi(`/agent/jobs/${detail.id}/reply`, {
                            instruction,
                          }),
                          { runId: detail.id })
                        : await tradeApi<{ runId: string }>("/agent/jobs", {
                            instruction,
                          });
                    await reload();
                    if (accountRef.current === owner && selectedRef.current === runId) {
                      setInstruction("");
                      openRun(result.runId);
                    }
                  });
                }}
              >
                <label className="trade-sr" htmlFor="purchase-instruction">
                  {t("Purchase instructions", "Hankintaohjeet")}
                </label>
                <textarea
                  id="purchase-instruction"
                  value={instruction}
                  onChange={(event) => setInstruction(event.target.value)}
                  required
                  minLength={
                    !newAgentTask && detail?.id.startsWith("job_") ? 2 : 10
                  }
                  maxLength={8000}
                  placeholder={t("Message your assistant…", "Kirjoita avustajalle…")}
                />
                <div className="trade-compose-footer">
                  <small>
                    {session.nemotronModel
                      ? t("Powered by NVIDIA Nemotron", "Käyttää NVIDIA Nemotronia")
                      : t("Agent service is not configured", "Avustajapalvelua ei ole määritetty")}
                  </small>
                  <Button
                    type="submit"
                    disabled={busy || !session.nemotronModel || Boolean(!newAgentTask && selected && !detail)}
                  >
                    <Play size={15} />
                    {t("Send message", "Lähetä viesti")}
                  </Button>
                </div>
              </form>
            </section>}
          </aside>
        </div>
      )}
      <footer className="trade-footer" inert={agentOpen}>
        <CoSignBrand inverse />
      </footer>
    </div>
  );
}

type Action = (fn: () => Promise<void>) => Promise<void>;
function PolicyEditor({
  session,
  action,
  busy,
  onSave,
}: {
  session: Session;
  action: Action;
  busy: boolean;
  onSave: () => Promise<void>;
}) {
  const { t, locale } = useI18n();
  const [policy, setPolicy] = useState<Policy>(session.account.policy);
  const [saved, setSaved] = useState(false);
  function toggle(
    field: "requiredClaims" | "freeFromAllergens",
    value: string,
  ) {
    setSaved(false);
    setPolicy((old) => ({
      ...old,
      [field]: old[field].includes(value)
        ? old[field].filter((item) => item !== value)
        : [...old[field], value],
    }));
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    void action(async () => {
      await tradeApi("/policy", policy);
      await onSave();
      setSaved(true);
    });
  }
  return (
    <form className="trade-settings" onSubmit={submit}>
      <span className="trade-eyebrow">{t("PURCHASING AUTHORITY", "OSTOVALTUUDET")}</span>
      <h1>{t("You set the boundaries.", "Määritä hankintasäännöt")}</h1>
      <p>
        {t(
          "These rules apply to every agent connected to this account. Changing them invalidates existing drafts and approvals.",
          "Säännöt koskevat kaikkia tiliin yhdistettyjä avustajia. Niiden muuttaminen mitätöi aiemmat luonnokset ja hyväksynnät.",
        )}
      </p>
      <label>
        {t("Automatic spending limit (€ per order, ex VAT)", "Automaattinen ostoraja (€/tilaus, alv 0 %)")}
        <input
          type="number"
          min="0"
          max="1000000"
          step="0.01"
          required
          value={policy.automaticLimitCents / 100}
          onChange={(event) => {
            setSaved(false);
            setPolicy({
              ...policy,
              automaticLimitCents: Math.round(Number(event.target.value) * 100),
            });
          }}
        />
      </label>
      <p className="trade-muted">
        {t(
          "A zero limit requires your approval for paid purchases. Unverified conditions still require review.",
          "Nollan euron rajalla kaikki maksulliset hankinnat vaativat hyväksynnän. Vahvistamattomat ehdot on aina tarkistettava.",
        )}
      </p>
      <fieldset>
        <legend>{t("Mandatory product requirements", "Pakolliset tuotevaatimukset")}</legend>
        {Object.keys(productRequirementLabels).map((value) => (
          <label key={value} className="trade-checkbox">
            <input
              type="checkbox"
              checked={policy.requiredClaims.includes(value)}
              onChange={() => toggle("requiredClaims", value)}
            />
            {productRequirementLabel(value as ProductRequirement, locale)}
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend>{t("Require explicit absence of these allergens", "Vaadi, että tuote on todistetusti vapaa näistä allergeeneista")}</legend>
        {Object.keys(allergenOptions).map((value) => (
          <label key={value} className="trade-checkbox">
            <input
              type="checkbox"
              checked={policy.freeFromAllergens.includes(value)}
              onChange={() => toggle("freeFromAllergens", value)}
            />
            {allergenLabel(value, locale)}
          </label>
        ))}
      </fieldset>
      <Button type="submit" disabled={busy}>
        {t("Save authority rules", "Tallenna hankintasäännöt")}
      </Button>
      {saved && <p role="status">{t("Your rules have been saved.", "Hankintasäännöt tallennettu.")}</p>}
    </form>
  );
}
