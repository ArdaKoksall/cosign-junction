import { createContext, useCallback, useContext, useLayoutEffect, useState, type ReactNode } from "react";

export type Locale = "en" | "fi";
export type Translate = (english: string, finnish: string) => string;
type Preference<T extends string> = "system" | T;
type LanguagePreference = Preference<Locale>;
type ThemePreference = Preference<"light" | "dark">;

const languageKey = "cosign.language";
const themeKey = "cosign.theme";

export function detectLocale(languages: readonly string[]): Locale {
  for (const language of languages) {
    const primary = language.toLowerCase().split("-")[0];
    if (primary === "en" || primary === "fi") return primary;
  }
  return "en";
}

function browserLocale(): Locale {
  return typeof navigator === "undefined" ? "en" :
    detectLocale(navigator.languages?.length ? navigator.languages : [navigator.language ?? "en"]);
}

function readPreference<T extends string>(key: string, choices: readonly T[]): Preference<T> {
  try {
    const value = localStorage.getItem(key) as T | null;
    if (value && choices.includes(value)) return value;
  } catch { /* Browser privacy settings may disable storage. */ }
  return "system";
}

function savePreference(key: string, value: string) {
  try {
    if (value === "system") localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* Apply the choice for the current visit even without storage. */ }
}

type Preferences = {
  locale: Locale;
  t: Translate;
  language: LanguagePreference;
  theme: ThemePreference;
  setLanguage: (language: LanguagePreference) => void;
  setTheme: (theme: ThemePreference) => void;
};

const I18nContext = createContext<Preferences>({
  locale: "en", t: (english) => english, language: "system", theme: "system",
  setLanguage: () => {}, setTheme: () => {},
});

export function DisplayProvider({ children }: { children: ReactNode }) {
  const [preferredLocale, setPreferredLocale] = useState(browserLocale);
  const [language, setLanguage] = useState<LanguagePreference>(() => readPreference(languageKey, ["en", "fi"]));
  const [theme, setTheme] = useState<ThemePreference>(() => readPreference(themeKey, ["light", "dark"]));
  const locale = language === "system" ? preferredLocale : language;
  const t: Translate = useCallback((en, fi) => locale === "fi" ? fi : en, [locale]);

  useLayoutEffect(() => {
    const onLanguageChange = () => setPreferredLocale(browserLocale());
    window.addEventListener("languagechange", onLanguageChange);
    return () => window.removeEventListener("languagechange", onLanguageChange);
  }, []);

  useLayoutEffect(() => {
    document.documentElement.lang = locale;
    document.title = locale === "fi"
      ? "VALIO:Cosign | Keittiön hankinnat"
      : "VALIO:Cosign | Kitchen purchasing";
  }, [locale]);

  useLayoutEffect(() => {
    // The CSS follows prefers-color-scheme whenever there is no manual override.
    if (theme === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <I18nContext.Provider value={{
      locale, t, language, theme,
      setLanguage: (value) => { setLanguage(value); savePreference(languageKey, value); },
      setTheme: (value) => { setTheme(value); savePreference(themeKey, value); },
    }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}
