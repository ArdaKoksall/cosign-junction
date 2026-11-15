import { useI18n } from "../i18n";
import { useState, type FormEvent } from "react";
import { ArrowRight, CircleAlert, Eye, EyeOff, LoaderCircle } from "lucide-react";
import { Button } from "./ui";
import { CoSignBrand } from "./CoSignBrand";
import { DisplayPreferences } from "./DisplayPreferences";
import { getSimulatorSession, setSimulatorToken } from "../api";

export function SimulatorTokenForm({ onConnect, embedded = false }: { onConnect: () => void; embedded?: boolean }) {
  const { t } = useI18n();
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function connect(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await getSimulatorSession(token.trim());
      setSimulatorToken(token.trim());
      onConnect();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Could not sign in.", "Kirjautuminen epäonnistui."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form-grid" onSubmit={connect}>
      <div className="purchase-access-field">
        <label htmlFor="simulator-token">{embedded ? t("Buyer token", "Ostajan tunnus") : t("Simulator access token", "Simulaattorin käyttöoikeustunnus")}</label>
        <div>
          <input id="simulator-token" type={showToken ? "text" : "password"} autoComplete="current-password" autoCapitalize="none" spellCheck={false} value={token} onChange={(event) => setToken(event.target.value)} required />
          <button type="button" className="purchase-token-toggle" aria-label={t("Show access token", "Näytä käyttöoikeustunnus")} aria-pressed={showToken} onClick={() => setShowToken(!showToken)}>
            {showToken ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
          </button>
        </div>
      </div>
      {error && <p className="message error" role="alert"><CircleAlert size={17} aria-hidden="true" />{error}</p>}
      <div className="actions">
        <Button type="submit" size="md" disabled={busy || !token.trim()}>
          {busy ? t("Signing in…", "Kirjaudutaan…") : embedded ? t("Sign in as buyer", "Kirjaudu ostajana") : t("Open workspace", "Avaa työtila")}
          {busy ? <LoaderCircle className="purchase-spinner" size={17} aria-hidden="true" /> : <ArrowRight size={17} aria-hidden="true" />}
        </Button>
      </div>
    </form>
  );
}

export function SimulatorAccess({ onConnect }: { onConnect: () => void }) {
  const { t } = useI18n();
  return (
    <main className="access-page">
      <section className="access-card" aria-labelledby="simulator-title">
        <div className="access-masthead"><CoSignBrand /><DisplayPreferences /></div>
        <div className="access-content">
          <div className="access-heading">
            <h1 id="simulator-title">{t("Open the simulator", "Avaa simulaattori")}</h1>
            <p>{t("Use your buyer token to try approval and checkout with test orders.", "Kokeile hyväksyntää ja tilaamista testitilauksilla. Kirjaudu ostajan tunnuksella.")}</p>
          </div>
          <SimulatorTokenForm onConnect={onConnect} />
        </div>
      </section>
    </main>
  );
}
