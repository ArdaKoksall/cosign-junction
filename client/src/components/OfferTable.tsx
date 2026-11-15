import { useI18n } from "../i18n";
import { Check, Leaf, Milk, Truck, X } from "lucide-react";
import { formatEuro, sourceKind } from "../api";
import type { CompareResponse } from "../types";
import { Badge } from "./ui";
import "../screens/purchasing-evidence.css";

export function OfferTable({ offers, empty }: { offers: CompareResponse["offers"]; empty: string }) {
  const { t, locale } = useI18n();
  if (!offers.length) return <p className="muted">{empty}</p>;
  return (
    <div className="evidence-offer-list">
      {offers.map((offer) => (
        <article className="evidence-offer" key={offer.id}>
          <div className="evidence-offer-heading">
            <span className="evidence-icon"><Milk size={19} aria-hidden="true" /></span>
            <div>
              <h3>{offer.name}</h3>
              <p>{offer.id} · {offer.quantityLiters} L</p>
            </div>
            <div className="evidence-offer-price"><strong>{formatEuro(offer.priceCents, locale)}</strong></div>
          </div>
          <div className="evidence-offer-signals">
            <span><Truck size={15} aria-hidden="true" />{t(" Reliability ", " Toimitusvarmuus ")}<strong>{offer.reliability ?? t("Unknown", "Ei tiedossa")}</strong></span>
            <span><Leaf size={15} aria-hidden="true" />{t(" Carbon ", " Hiilijalanjälki ")}<strong>{offer.carbon ?? t("Unknown", "Ei tiedossa")}</strong></span>
            <Badge className={sourceKind(offer.source)}>{offer.source || "unlabeled"}</Badge>
          </div>
          <div className="evidence-offer-status">
            <span className={offer.eligible ? "eligible" : "excluded"}>
              {offer.eligible ? <Check size={14} aria-hidden="true" /> : <X size={14} aria-hidden="true" />}
              {offer.eligible ? t("Eligible", "Sopiva") : t("Excluded", "Hylätyt")}
            </span>
            <small>{offer.reason?.replaceAll("_", " ").toLowerCase() || t("No reason supplied", "Syytä ei ilmoitettu")}</small>
          </div>
        </article>
      ))}
    </div>
  );
}
