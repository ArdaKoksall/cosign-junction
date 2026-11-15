import { useI18n } from "../i18n";
import { useEffect, useState } from "react";
import { ArrowRight, CircleAlert, LoaderCircle, Milk, RefreshCw } from "lucide-react";
import { formatEuro, getRoutineMilk, setRoutineMilkMandate } from "../api";
import milkPhoto from "../assets/monday-milk.jpg";
import { Badge, Button } from "../components/ui";
import type { RoutineMilkStatus } from "../types";
import "../purchase-redesign.css";

export function RoutineMilkScreen({ onReceipt }: { onReceipt: (orderId: string) => void }) {
  const { t, locale } = useI18n();
  const [status, setStatus] = useState<RoutineMilkStatus>();
  const [cap, setCap] = useState("120");
  const [error, setError] = useState("");
  const [pending, setPending] = useState<"refresh" | "authorize" | "revoke">();

  async function refreshFromButton() {
    setPending("refresh");
    try {
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Could not load the weekly activity.", "Viikon tapahtumia ei voitu ladata."));
    } finally {
      setPending(undefined);
    }
  }

  async function refresh(useSavedCap = false) {
    const next = await getRoutineMilk();
    setStatus(next);
    setError("");
    if (useSavedCap && next.mandate) setCap(String(next.mandate.maxTotalCents / 100));
  }

  useEffect(() => {
    void refresh(true).catch((err: Error) => setError(err.message));
  }, []);

  async function update(active: boolean, maxTotalCents: number) {
    setPending(active ? "authorize" : "revoke");
    setError("");
    try {
      await setRoutineMilkMandate(active, maxTotalCents);
      await refresh(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Could not change the mandate.", "Valtuutusta ei voitu muuttaa."));
    } finally {
      setPending(undefined);
    }
  }

  const mandate = status?.mandate;
  const placedOrderId = status?.placedOrderId;

  return (
    <div className="purchase-view">
      <header className="purchase-heading">
        <div>
          <h1>{t("Weekly milk mandate", "Viikoittaisen maitotilauksen valtuutus")}</h1>
          <p>{t("Authorize one simulated milk order per week. Substitutions require buyer approval.", "Valtuuta yksi testimaitotilaus viikossa. Korvaavat tuotteet vaativat ostajan hyväksynnän.")}</p>
        </div>
        {status && <span className="purchase-heading-meta">{t("Week of ", "Viikko alkaen ")}{status.period}</span>}
      </header>

      {error && (
        <div className="message error" role="alert">
          <CircleAlert size={18} aria-hidden="true" />
          <p>{error}</p>
        </div>
      )}

      <div className="purchase-layout purchase-mandate-layout">
        <section aria-labelledby="mandate-authorization">
          <div className="purchase-section-heading">
            <h2 id="mandate-authorization">{t("Weekly spending limit", "Viikon käyttöraja")}</h2>
            <span role="status">
              <Badge color={mandate?.active ? "success" : "default"}>{!status ? error ? t("Unavailable", "Ei saatavilla") : t("Loading", "Ladataan") : mandate?.active ? t("Active", "Voimassa") : t("Inactive", "Ei voimassa")}</Badge>
            </span>
          </div>
          <form className="purchase-mandate-form" onSubmit={(event) => {
            event.preventDefault();
            void update(true, Math.round(Number(cap) * 100));
          }}>
            <label htmlFor="weekly-cap">{t("Limit in EUR, ex VAT", "Raja euroina, alv 0 %")}</label>
            <div className="purchase-currency-input">
              <span aria-hidden="true">€</span>
              <input id="weekly-cap" type="number" min="0" step="0.01" required value={cap} onChange={(event) => setCap(event.target.value)} disabled={Boolean(pending)} />
            </div>
            <div className="purchase-actions">
              <Button type="submit" disabled={Boolean(pending) || !status}>
                {pending === "authorize" && <LoaderCircle className="purchase-spinner" size={16} aria-hidden="true" />}
                {pending === "authorize" ? t("Saving mandate…", "Tallennetaan valtuutusta…") : mandate?.active ? t("Update mandate", "Päivitä valtuutus") : t("Authorize weekly order", "Valtuuta viikkotilaus")}
              </Button>
              {mandate?.active && (
                <Button variant="danger-soft" disabled={Boolean(pending)} onClick={() => void update(false, mandate.maxTotalCents)}>
                  {pending === "revoke" && <LoaderCircle className="purchase-spinner" size={16} aria-hidden="true" />}
                  {pending === "revoke" ? t("Revoking…", "Peruutetaan…") : t("Revoke mandate", "Peruuta valtuutus")}
                </Button>
              )}
            </div>
          </form>
        </section>

        <section className="purchase-week-card" aria-labelledby="weekly-activity">
          <h2 className="purchase-ribbon" id="weekly-activity">{t("Weekly activity", "Viikon tapahtumat")}</h2>
          <img className="purchase-week-photo" src={milkPhoto} width="850" height="390" alt="" />
          <div className="purchase-week-body">
            <div className="purchase-week-order">
              <Milk size={21} strokeWidth={1.7} aria-hidden="true" />
              <div>
                <strong>{status?.quantityLiters ?? 100}{t(" L lactose-free milk", " l laktoositonta maitoa")}</strong>
                <p>{placedOrderId ? t("Simulated order placed", "Testitilaus tehty") : t("No order this week", "Ei tilausta tällä viikolla")}</p>
              </div>
            </div>
            {status && <p className="purchase-note">{mandate ? t(`Revision ${mandate.revision} · ${formatEuro(mandate.maxTotalCents, locale)} cap`, `Versio ${mandate.revision} · Enimmäissumma ${formatEuro(mandate.maxTotalCents, locale)}`) : t("Awaiting buyer authorization", "Odottaa ostajan valtuutusta")}</p>}
            <div className="purchase-actions">
              <Button variant="secondary" disabled={Boolean(pending)} onClick={() => void refreshFromButton()}>
                <RefreshCw className={pending === "refresh" ? "purchase-spinner" : undefined} size={15} aria-hidden="true" />
                {pending === "refresh" ? t("Refreshing activity…", "Päivitetään tapahtumia…") : t("Refresh activity", "Päivitä tapahtumat")}
              </Button>
              {placedOrderId && (
                <Button variant="tertiary" onClick={() => onReceipt(placedOrderId)}>
                  {t("Open weekly receipt ", "Avaa viikkotilauksen kuitti ")}
                  <ArrowRight size={16} aria-hidden="true" />
                </Button>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
