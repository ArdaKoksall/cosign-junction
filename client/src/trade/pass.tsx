// "The pass": in a kitchen, nothing leaves until it has been checked at the pass.
// Requests hang on a rail as tickets. A ticket prints when a request arrives and
// carries a signature line, because a purchase only proceeds once the buyer signs.
import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowRight } from "lucide-react";
import { TypeLine, springs } from "./motion-kit";
import { CosignName } from "../components/CoSignBrand";
import { useI18n } from "../i18n";
import { runStatusLabel } from "./tradeCopy";
import type { Run } from "./api";

/** ISO 8601 week number; kitchens plan and order by week. */
export const isoWeek = (date: Date) => {
  const day = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const weekday = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() + 4 - weekday);
  const yearStart = Date.UTC(day.getUTCFullYear(), 0, 1);
  return Math.ceil(((day.getTime() - yearStart) / 86_400_000 + 1) / 7);
};

/** Ink colour for a status: who has to act, or how it ended. */
export const statusTone = (status: string) =>
  status === "awaiting_approval"
    ? "wait"
    : ["running", "active", "queued"].includes(status)
      ? "work"
      : ["approved", "completed", "ready"].includes(status)
        ? "done"
        : ["failed", "needs_attention", "rejected"].includes(status)
          ? "stop"
          : "rest";

const tilts = [-1.3, 0.9, -0.5, 1.2, -0.9, 0.6];

function Ticket({
  run,
  index,
  printed,
  activity,
  onOpen,
}: {
  run: Run;
  index: number;
  printed: boolean;
  activity?: string;
  onOpen: () => void;
}) {
  const { t, locale } = useI18n();
  const reduced = useReducedMotion();
  const tilt = tilts[index % tilts.length];
  const total = run.draft && "totalCents" in run.draft ? run.draft.totalCents : undefined;
  const working = ["running", "queued", "active"].includes(run.status);
  const signed = run.status === "approved" || Boolean(run.receipt);
  const created = new Date(run.created_at);
  const language = locale === "fi" ? "fi-FI" : "en-GB";
  return (
    <motion.button
      layout={reduced ? false : "position"}
      className={`cs-ticket tone-${statusTone(run.status)}`}
      onClick={onOpen}
      initial={
        reduced
          ? false
          : printed
            ? { y: -70, opacity: 0, rotate: tilt - 5 }
            : { y: -18, opacity: 0, rotate: tilt }
      }
      animate={{ y: 0, opacity: 1, rotate: tilt }}
      exit={{ opacity: 0, y: 12, transition: { duration: 0.18 } }}
      whileHover={
        reduced
          ? undefined
          : { rotate: tilt > 0 ? tilt - 2.6 : tilt + 2.6, y: 3, transition: springs.hang }
      }
      whileTap={reduced ? undefined : { scale: 0.98, transition: springs.pop }}
      transition={{ ...springs.hang, delay: printed ? 0 : 0.3 + index * 0.07 }}
    >
      <span className="cs-ticket-peg" aria-hidden="true" />
      <span className="cs-ticket-paper">
        <span className="cs-ticket-top">
          <span>
            {t("No.", "Nro")} {run.id.slice(-5).toUpperCase()}
          </span>
          <time dateTime={run.created_at}>
            {created.toLocaleDateString(language, {
              timeZone: "Europe/Helsinki",
              day: "numeric",
              month: "short",
            })}
            {" · "}
            {created.toLocaleTimeString(language, {
              timeZone: "Europe/Helsinki",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </time>
        </span>
        <strong>{run.title}</strong>
        <span className="cs-ticket-meta">
          {run.source === "web" ? (
            t("Workspace", "Työtila")
          ) : run.source === "nemotron" ? (
            <>
              <CosignName />
              {t(" assistant", "-avustaja")}
            </>
          ) : (
            t("Connected agent", "Yhdistetty avustaja")
          )}
        </span>
        <span className="cs-ticket-foot">
          <span className="cs-ticket-status">
            {run.receipt ? t("Rehearsed", "Harjoiteltu") : runStatusLabel(run.status, t)}
          </span>
          {working && activity ? (
            <span className="cs-ticket-live">
              <TypeLine text={activity} />
            </span>
          ) : typeof total === "number" ? (
            <span className="cs-ticket-total">
              {new Intl.NumberFormat(locale === "fi" ? "fi-FI" : "en-FI", {
                style: "currency",
                currency: "EUR",
              }).format(total / 100)}
            </span>
          ) : null}
        </span>
        {(run.status === "awaiting_approval" || signed) && (
          <span className="cs-ticket-sign" aria-hidden="true">
            <i>✕</i>
            {signed ? <em>{t("approved", "hyväksytty")}</em> : null}
          </span>
        )}
      </span>
    </motion.button>
  );
}

/** Requests as tickets on a rail. New requests print onto the rail as they arrive. */
export function TicketRail({
  runs,
  activityFor,
  onOpenRun,
  onViewAll,
}: {
  runs: Run[];
  activityFor: (run: Run) => string | undefined;
  onOpenRun: (id: string) => void;
  onViewAll: () => void;
}) {
  const { t } = useI18n();
  // Tickets that are there when the page opens settle in together; later ones print.
  const [opened] = useState(() => Date.now());
  const shown = runs.slice(0, 8);
  return (
    <div className="cs-rail" role="region" aria-label={t("Requests", "Pyynnöt")}>
      <div className="cs-rail-bar" aria-hidden="true" />
      <div className="cs-rail-track">
        <AnimatePresence initial mode="popLayout">
          {shown.map((run, index) => (
            <Ticket
              key={run.id}
              run={run}
              index={index}
              printed={Date.now() - opened > 2500}
              activity={activityFor(run)}
              onOpen={() => onOpenRun(run.id)}
            />
          ))}
        </AnimatePresence>
        {!shown.length && (
          <>
            <div className="cs-ticket cs-ticket--note">
              <span className="cs-ticket-peg" aria-hidden="true" />
              <span className="cs-ticket-paper">
                <span className="cs-ticket-top">
                  <span>{t("No.", "Nro")} 00001</span>
                </span>
                <strong>
                  {t("Your first request prints here.", "Ensimmäinen pyyntösi tulostuu tähän.")}
                </strong>
                <span className="cs-ticket-meta">
                  {t(
                    "Ask the assistant or create a request. It stays on the rail until you have decided.",
                    "Kysy avustajalta tai luo pyyntö. Se pysyy tässä, kunnes olet tehnyt päätöksen.",
                  )}
                </span>
              </span>
            </div>
            <div className="cs-ticket cs-ticket--ghost" aria-hidden="true" />
            <div className="cs-ticket cs-ticket--ghost" aria-hidden="true" />
          </>
        )}
        {runs.length > 0 && (
          <button className="cs-rail-more" onClick={onViewAll}>
            {t("All requests", "Kaikki pyynnöt")}
            <ArrowRight size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
