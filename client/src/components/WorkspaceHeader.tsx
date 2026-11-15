import { useI18n } from "../i18n";
import { useRef, useState } from "react";
import { Menu, RotateCcw, X, type LucideIcon } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { CoSignBrand } from "./CoSignBrand";
import { DisplayPreferences } from "./DisplayPreferences";
import type { Screen } from "../types";

export function WorkspaceHeader({ screen, navItems, busy, isSimulator, isReady, onNavigate, onReset }: {
  screen: Screen;
  navItems: { id: Screen; label: string; Icon: LucideIcon; count?: number }[];
  busy: boolean;
  isSimulator: boolean;
  isReady: boolean;
  onNavigate: (screen: Screen) => void;
  onReset: () => void;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const reduceMotion = useReducedMotion();

  function closeMenu() {
    if (expanded) toggleRef.current?.focus();
    setExpanded(false);
  }

  function go(destination: Screen) {
    closeMenu();
    onNavigate(destination);
  }

  return (
    <header className="workspace-header" data-dense={navItems.length > 5} onKeyDown={(event) => {
      if (event.key === "Escape" && expanded) {
        event.preventDefault();
        closeMenu();
      }
    }}>
      <div className="masthead-top workspace-width">
        <button className="brand-button" type="button" onClick={() => go("dashboard")} disabled={busy} aria-label={t("VALIO:Cosign overview", "VALIO:Cosign, yleiskatsaus")}>
          <CoSignBrand />
        </button>

        <button
          className="mobile-menu-toggle icon-button"
          type="button"
          ref={toggleRef}
          aria-label={expanded ? t("Close navigation", "Sulje valikko") : t("Open navigation", "Avaa valikko")}
          aria-expanded={expanded}
          aria-controls="workspace-menu"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <X size={21} aria-hidden="true" /> : <Menu size={21} aria-hidden="true" />}
        </button>

        <div className="masthead-menu" id="workspace-menu" data-expanded={expanded}>
          <div className="masthead-navigation">
            <nav className="workspace-nav" aria-label={t("Purchasing", "Hankinnat")}>
              {navItems.map(({ id, label, Icon, count }) => {
                const active = screen === id || (id === "workspace" && (screen === "request" || screen === "compare")) || (id === "history" && screen === "receipt");
                return (
                  <button
                    className="workspace-nav-item"
                    type="button"
                    key={id}
                    aria-current={active ? (screen === id ? "page" : "location") : undefined}
                    disabled={busy}
                    onClick={() => go(id)}
                  >
                    {active && <motion.span
                      aria-hidden="true"
                      className="nav-selection"
                      layoutId={reduceMotion ? undefined : "workspace-selection"}
                      transition={{ type: "spring", stiffness: 530, damping: 39 }}
                    />}
                    <Icon size={17} strokeWidth={1.8} aria-hidden="true" />
                    <span>{label}</span>
                    {count !== undefined && <span className="nav-count">{count}</span>}
                  </button>
                );
              })}
            </nav>
            {isSimulator && <button className="reset-link reset-link-mobile" type="button" disabled={busy} onClick={() => { closeMenu(); onReset(); }}>
              <RotateCcw size={15} aria-hidden="true" /> {t(" Reset demo ", " Nollaa demo ")}
            </button>}
          </div>
        </div>

        <div className="masthead-status">
          <DisplayPreferences />
          <span className="mode-label" data-simulator={isSimulator} data-offline={!isReady}>
            <span aria-hidden="true" />
            {isSimulator ? t("Test simulator", "Testisimulaattori") : isReady ? "Valio Aimo" : t("Workspace unavailable", "Työtila ei ole käytettävissä")}
          </span>
          {isSimulator && <button className="reset-link reset-link-desktop" type="button" disabled={busy} onClick={onReset} aria-label={t("Reset demo", "Nollaa demo")} title={t("Reset demo", "Nollaa demo")}>
            <RotateCcw size={17} aria-hidden="true" />
          </button>}
        </div>
      </div>
    </header>
  );
}
