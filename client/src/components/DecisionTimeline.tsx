import { useI18n, type Locale, type Translate } from "../i18n";
import { Check, CircleAlert } from "lucide-react";
import type { DecisionEvent } from "../types";
import "../purchase-redesign.css";

const eventTitles = (t: Translate): Record<string, string> => ({
  request: t("Request submitted", "Pyyntö lähetetty"),
  supplier_lookup: t("Supplier data checked", "Toimittajatiedot tarkistettu"),
  supplier_ranking: t("Supplier ranking assessed", "Toimittajien järjestys arvioitu"),
  rehearsal_quote: t("Simulated quote created", "Testitarjous luotu"),
  compare: t("Basket compared", "Kori vertailtu"),
  approve: t("Revision approved", "Versio hyväksytty"),
  commit: t("Order placed in simulator", "Tilaus tehty simulaattorissa"),
  mandate: t("Buyer mandate applied", "Ostajan valtuutus käytetty"),
  price_change: t("Basket price changed", "Korin hinta muuttunut"),
});
const highlightActions = new Set(["approve", "commit", "mandate", "price_change", "supplier_ranking", "rehearsal_quote"]);
const outcomesWithoutAttention = new Set(["PASSED", "OBSERVED", "RANKED"]);
const finnishOutcomes: Record<string, string> = {
  PASSED: "onnistui",
  OBSERVED: "havaittu",
  RANKED: "vertailtu",
  BLOCKED: "estetty",
  SIMULATED: "testattu",
  APPROVAL_INVALIDATED: "hyväksyntä mitätöity",
  UNAVAILABLE: "ei saatavilla",
};
const helsinkiTimes = {
  en: new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Helsinki", dateStyle: "medium", timeStyle: "short" }),
  fi: new Intl.DateTimeFormat("fi-FI", { timeZone: "Europe/Helsinki", dateStyle: "medium", timeStyle: "short" }),
};

function timestampText(at: string, locale: Locale) {
  const instant = new Date(at);
  return Number.isNaN(instant.getTime()) ? at : helsinkiTimes[locale].format(instant);
}

export function isDecisionHighlight(event: DecisionEvent | string) {
  return typeof event === "string" || highlightActions.has(event.action ?? event.type ?? "")
    || Boolean(event.outcome && !outcomesWithoutAttention.has(event.outcome));
}

export function DecisionTimeline({ events }: { events: readonly (DecisionEvent | string)[] }) {
  const { t, locale } = useI18n();
  const titles = eventTitles(t);
  return (
    <>
      {events.some((event) => typeof event !== "string" && event.at) && <p className="purchase-note">{t("Helsinki time", "Helsingin aika")}</p>}
      <ol className="purchase-timeline">
        {events.map((event, index) => {
          const fields = typeof event === "string" ? {} : event;
          const { at, actorId, outcome, revision } = fields;
          const detail = fields.detail ?? fields.message;
          const action = fields.action ?? fields.type ?? "event";
          const title = typeof event === "string" ? event : titles[action] ?? action.replaceAll("_", " ");
          const outcomeLabel = outcome && (locale === "fi" ? finnishOutcomes[outcome] : undefined) || outcome?.toLowerCase().replaceAll("_", " ");
          const attention = Boolean(outcome && !outcomesWithoutAttention.has(outcome));
          return (
            <li key={index}>
              <span className="purchase-event-mark" data-attention={attention}>
                {attention ? <CircleAlert size={15} aria-hidden="true" /> : <Check size={16} aria-hidden="true" />}
              </span>
              <div className="purchase-event-content">
                <div className="purchase-event-heading">
                  <strong>{title}</strong>
                  {at && <time dateTime={at}>{timestampText(at, locale)}</time>}
                </div>
                {detail && <p>{detail}</p>}
                {(outcome || actorId || revision !== undefined) && (
                  <div className="purchase-event-meta">
                    {outcomeLabel && <span className="purchase-event-outcome">{outcomeLabel}</span>}
                    {actorId && <span>{actorId}</span>}
                    {revision !== undefined && <span>{t("Revision ", "Versio ")}{revision}</span>}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </>
  );
}
