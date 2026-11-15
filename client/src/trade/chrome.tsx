// The frame around every page: navigation icons and the footer.
import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { ArrowUpRight } from "lucide-react";
import { CoSignBrand } from "../components/CoSignBrand";
import { useI18n } from "../i18n";
import { Scribble, useNow } from "./motion-kit";
import { isoWeek } from "./pass";

export type PageId = "workspace" | "products" | "requests" | "connections" | "policy";

const line = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.9,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;
const settle = { type: "spring", stiffness: 420, damping: 18 } as const;

/**
 * Navigation icons drawn for this product. Each one acts out its page when the
 * pointer is over its tab: the service bell rings, produce lifts out of the crate,
 * the ticket is written, the plug connects, the rules slide.
 * They read the "rest" and "hover" variants of the motion button that holds them.
 */
export function NavIcon({ page }: { page: string }) {
  switch (page) {
    case "workspace":
      return (
        <svg viewBox="0 0 24 24" className="cs-icon" aria-hidden="true" {...line}>
          <motion.g
            style={{ originX: 0.5, originY: 1 }}
            variants={{ rest: { rotate: 0 }, hover: { rotate: [0, -10, 8, -4, 0] } }}
            transition={{ duration: 0.55, ease: "easeInOut" }}
          >
            <path className="cs-icon-body" d="M5 17a7 7 0 0 1 14 0Z" />
            <path d="M12 10V8.2" />
            <circle cx="12" cy="6.7" r="1.3" />
          </motion.g>
          <path d="M3.5 19.7h17" />
          <motion.path
            d="M4.7 8.3 3.1 7.2M19.3 8.3l1.6-1.1"
            variants={{ rest: { opacity: 0 }, hover: { opacity: [0, 1, 1, 0] } }}
            transition={{ duration: 0.55 }}
          />
        </svg>
      );
    case "products":
      return (
        <svg viewBox="0 0 24 24" className="cs-icon" aria-hidden="true" {...line}>
          <motion.path
            d="M6.6 10.6a2.5 2.5 0 0 1 5 0"
            variants={{ rest: { y: 0 }, hover: { y: -2 } }}
            transition={settle}
          />
          <motion.g
            variants={{ rest: { y: 0 }, hover: { y: -2.8 } }}
            transition={{ ...settle, delay: 0.05 }}
          >
            <path d="M11.9 10.6a3 3 0 0 1 6 0" />
            <path d="M14.9 7.6c.1-1.1.8-1.9 1.9-2.1" />
          </motion.g>
          <path
            className="cs-icon-body cs-icon-cover"
            d="M4 10.8h16v7.7a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5Z"
          />
          <path d="M4 15.3h16" />
        </svg>
      );
    case "requests":
      return (
        <svg viewBox="0 0 24 24" className="cs-icon" aria-hidden="true" {...line}>
          <motion.g
            variants={{ rest: { rotate: 0 }, hover: { rotate: -8 } }}
            transition={settle}
          >
            <path
              className="cs-icon-body"
              d="M4 8.5A1.5 1.5 0 0 1 5.5 7h13A1.5 1.5 0 0 1 20 8.5V10a2 2 0 0 0 0 4v1.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 15.5V14a2 2 0 0 0 0-4Z"
            />
            <path d="M14.8 7.5v9" strokeDasharray="1.6 2.1" />
            <motion.path
              d="M7.4 10.6h4.2M7.4 13.4h2.8"
              variants={{ rest: { pathLength: 1 }, hover: { pathLength: [0, 1] } }}
              transition={{ duration: 0.45, ease: "easeOut" }}
            />
          </motion.g>
        </svg>
      );
    case "connections":
      return (
        <svg viewBox="0 0 24 24" className="cs-icon" aria-hidden="true" {...line}>
          <motion.g
            variants={{ rest: { y: 0 }, hover: { y: [0, -2.2, 1.4, 0] } }}
            transition={{ duration: 0.5, ease: "easeInOut" }}
          >
            <path d="M9 3.6v3.9M15 3.6v3.9" />
            <path className="cs-icon-body" d="M6.5 7.5h11V11a5.5 5.5 0 0 1-11 0Z" />
          </motion.g>
          <path d="M12 16.6v3.9" />
          <motion.path
            d="M4.5 13.4 2.9 14.2M19.5 13.4l1.6.8"
            variants={{ rest: { opacity: 0 }, hover: { opacity: [0, 0, 1, 0] } }}
            transition={{ duration: 0.6 }}
          />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 24 24" className="cs-icon" aria-hidden="true" {...line}>
          <path d="M4 7h16M4 12h16M4 17h16" />
          <motion.circle
            className="cs-icon-knob"
            cx="9"
            cy="7"
            r="2.1"
            variants={{ rest: { x: 0 }, hover: { x: 6 } }}
            transition={settle}
          />
          <motion.circle
            className="cs-icon-knob"
            cx="15.5"
            cy="12"
            r="2.1"
            variants={{ rest: { x: 0 }, hover: { x: -7 } }}
            transition={{ ...settle, delay: 0.04 }}
          />
          <motion.circle
            className="cs-icon-knob"
            cx="8"
            cy="17"
            r="2.1"
            variants={{ rest: { x: 0 }, hover: { x: 5.5 } }}
            transition={{ ...settle, delay: 0.08 }}
          />
        </svg>
      );
  }
}

/**
 * The footer signs the page off: the name is written on a signature line the
 * first time it scrolls into view, above the live state of the workspace.
 */
export function FooterContent({
  live,
  model,
  onPage,
  onAsk,
}: {
  live: boolean;
  model: string | null;
  onPage: (page: PageId) => void;
  onAsk: () => void;
}) {
  const { t, locale } = useI18n();
  const now = useNow();
  const signature = useRef<HTMLDivElement>(null);
  const [written, setWritten] = useState(typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const node = signature.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setWritten(true);
        observer.disconnect();
      },
      { threshold: 0.45 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const language = locale === "fi" ? "fi-FI" : "en-GB";
  const link = (label: string, action: () => void) => (
    <li key={label}>
      <button type="button" onClick={action}>
        {label}
        <ArrowUpRight size={14} />
      </button>
    </li>
  );
  return (
    <div className="cs-footer">
      <div className="cs-footer-top">
        <div className="cs-footer-pitch">
          <CoSignBrand inverse />
          <p>{t("Purchasing with your approval", "Hankinnat sinun päätökselläsi")}</p>
        </div>
        <nav aria-label={t("Footer", "Alatunniste")}>
          <div>
            <h3>{t("Workspace", "Työtila")}</h3>
            <ul>
              {link(t("Overview", "Yleiskatsaus"), () => onPage("workspace"))}
              {link(t("Products", "Tuotteet"), () => onPage("products"))}
              {link(t("Requests", "Pyynnöt"), () => onPage("requests"))}
            </ul>
          </div>
          <div>
            <h3>{t("Agents", "Avustajat")}</h3>
            <ul>
              {link(t("Ask the assistant", "Kysy avustajalta"), onAsk)}
              {link(t("Connect an agent", "Yhdistä avustaja"), () => onPage("connections"))}
            </ul>
          </div>
          <div>
            <h3>{t("Account", "Tili")}</h3>
            <ul>{link(t("Purchasing rules", "Hankintasäännöt"), () => onPage("policy"))}</ul>
          </div>
        </nav>
      </div>
      <dl className="cs-footer-status">
        <div>
          <dt>{t("Updates", "Päivitykset")}</dt>
          <dd className={live ? "is-live" : "is-waiting"}>
            <i aria-hidden="true" />
            {live ? t("Live", "Reaaliaikaiset") : t("Reconnecting", "Yhdistetään")}
          </dd>
        </div>
        <div>
          <dt>{t("Hosted agent", "Avustaja")}</dt>
          <dd translate="no">{model ? model.split("/").pop() : t("Not configured", "Ei määritetty")}</dd>
        </div>
        <div>
          <dt>{t("Catalog", "Valikoima")}</dt>
          <dd translate="no">Valio Aimo</dd>
        </div>
        <div>
          <dt>
            {t("Week", "Viikko")} {isoWeek(now)} · Helsinki
          </dt>
          <dd>
            {now.toLocaleDateString(language, {
              timeZone: "Europe/Helsinki",
              weekday: "short",
              day: "numeric",
              month: "short",
            })}
            {" · "}
            {now.toLocaleTimeString(language, {
              timeZone: "Europe/Helsinki",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </dd>
        </div>
      </dl>
      <div
        className="cs-footer-sign"
        ref={signature}
        data-written={written || undefined}
        aria-hidden="true"
      >
        <i>✕</i>
        <span translate="no">Cosign</span>
        <Scribble />
      </div>
      <div className="cs-footer-base">
        <span translate="no">© {now.getFullYear()} VALIO:Cosign</span>
        <span>
          {t("Purchases follow your account’s approval rules.", "Hankinnoissa noudatetaan tilisi hyväksyntäsääntöjä.")}
        </span>
      </div>
    </div>
  );
}
