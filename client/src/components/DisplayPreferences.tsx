import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Languages, Monitor } from "lucide-react";
import { useI18n } from "../i18n";
import "./display-preferences.css";

export function DisplayPreferences() {
  const { t, locale, language, setLanguage, theme, setTheme } = useI18n();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const area = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !area.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  return (
    <div ref={area} className="display-preferences" onKeyDown={(event) => {
      if (event.key === "Escape" && open) {
        event.stopPropagation();
        setOpen(false);
        trigger.current?.focus();
      }
    }}>
      <button ref={trigger} type="button" className="display-preferences-trigger" aria-expanded={open} aria-controls={panelId}
        aria-label={t("Language and appearance", "Kieli ja ulkoasu")} onClick={() => setOpen(!open)}>
        <Languages size={16} aria-hidden="true" />
        <span aria-hidden="true">{locale.toUpperCase()}</span>
        <ChevronDown size={13} aria-hidden="true" className="display-preferences-chevron" />
      </button>
      <div className="display-preferences-panel" id={panelId} hidden={!open}>
        <label>
          <span><Languages size={15} aria-hidden="true" />{t("Language", "Kieli")}</span>
          <select value={language} onChange={(event) => setLanguage(event.target.value as typeof language)}>
            <option value="system">{t("Browser default", "Selaimen oletus")}</option>
            <option value="en" lang="en">English</option>
            <option value="fi" lang="fi">Suomi</option>
          </select>
        </label>
        <label>
          <span><Monitor size={15} aria-hidden="true" />{t("Appearance", "Ulkoasu")}</span>
          <select value={theme} onChange={(event) => setTheme(event.target.value as typeof theme)}>
            <option value="system">{t("System", "Järjestelmä")}</option>
            <option value="light">{t("Light", "Vaalea")}</option>
            <option value="dark">{t("Dark", "Tumma")}</option>
          </select>
        </label>
      </div>
    </div>
  );
}
