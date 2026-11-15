import type { Translate } from "../i18n";
import type { TradeEvent } from "./api";

export const agentClients = {
  chatgpt: "ChatGPT",
  claude: "Claude",
  "claude-code": "Claude Code",
  codex: "Codex",
  custom: "Custom agent",
} as const;

export type AgentClient = keyof typeof agentClients;

export function agentClientLabel(client: AgentClient, t: Translate) {
  return client === "custom" ? t(agentClients.custom, "Oma agentti") : agentClients[client];
}

export function scopeLabel(scope: string, t: Translate) {
  const labels: Record<string, string> = {
    "catalog:read": t("View products, prices, stock and request status", "Katso tuotteita, hintoja, varastosaldoja ja pyyntöjen tiloja"),
    "requests:write": t("Create purchasing requests and prepare drafts", "Luo hankintapyyntöjä ja valmistele luonnoksia"),
    "orders:write": t("Record rehearsal orders within your authority and approvals", "Kirjaa harjoitustilauksia valtuuksiesi ja hyväksyntöjesi rajoissa"),
  };
  return labels[scope] ?? scope;
}

export function activityLabel(t: Translate, event?: TradeEvent) {
  if (!event) return t("Starting your request", "Aloitetaan pyynnön käsittely");
  const labels: Record<string, string> = {
    browse_catalog: t("Searching the catalog", "Haetaan tuotteita valikoimasta"),
    search_products: t("Finding suitable products", "Etsitään sopivia tuotteita"),
    compare_products: t("Checking prices and availability", "Tarkistetaan hintoja ja saatavuutta"),
    amend_request: t("Updating a requested item", "Päivitetään pyydettyä tuotetta"),
    remove_request_items: t("Removing items from the request", "Poistetaan tuotteita pyynnöstä"),
    update_request_preferences: t("Updating budget and delivery preferences", "Päivitetään budjetti- ja toimitustoiveita"),
    get_account_context: t("Checking your purchase permissions", "Tarkistetaan ostovaltuuksia"),
    get_product_details: t("Reading product details", "Luetaan tuotetietoja"),
    list_requests: t("Checking your requests", "Tarkistetaan pyyntöjäsi"),
    prepare_order: t("Preparing a purchase draft", "Valmistellaan tilausluonnosta"),
    get_activity: t("Reading recent activity", "Tarkistetaan viimeaikaisia tapahtumia"),
    place_order: event.data.kind === "order_rehearsal" || event.data.mode === "rehearsal"
      ? t("Recording a rehearsal receipt", "Tallennetaan harjoitustilauksen kuittia")
      : t("Checking supplier submission", "Tarkistetaan tilauksen lähetystä toimittajalle"),
    model_request: t("Preparing a response", "Valmistellaan vastausta"),
    model_response: t("Preparing the next step", "Valmistellaan seuraavaa vaihetta"),
  };
  return labels[event.action] ?? t("Working on your request", "Käsitellään pyyntöäsi");
}

export function runStatusLabel(status: string, t: Translate) {
  const labels: Record<string, string> = {
    active: t("active", "aktiivinen"),
    approved: t("approved", "hyväksytty"),
    awaiting_approval: t("awaiting approval", "odottaa hyväksyntää"),
    cancelled: t("cancelled", "peruttu"),
    completed: t("completed", "valmis"),
    failed: t("failed", "epäonnistunut"),
    needs_attention: t("needs attention", "vaatii huomiota"),
    queued: t("queued", "jonossa"),
    ready: t("within authority", "ostovaltuuksien rajoissa"),
    rejected: t("rejected", "hylätty"),
    running: t("running", "käsittelyssä"),
  };
  return labels[status] ?? status.replaceAll("_", " ");
}

const finnishMessages: Readonly<Record<string, string>> = {
  "Could not load this request.": "Pyyntöä ei voitu ladata.",
  "Could not update this request.": "Pyyntöä ei voitu päivittää.",
  "Operation failed": "Toiminto epäonnistui.",
  "Cannot connect": "Yhteyttä ei voitu muodostaa.",
  "Request failed": "Pyyntö epäonnistui.",
  "Failed to fetch": "Palveluun ei saatu yhteyttä.",
  "Email or password is incorrect": "Sähköposti tai salasana on virheellinen.",
  "Sign in to your account": "Kirjaudu sisään.",
  "Resource not found": "Tietoa ei löytynyt.",
  "The delivery deadline has passed.": "Toimituksen määräaika on umpeutunut.",
  "Your purchasing rules changed. Refresh the comparison before approving.": "Hankintasääntösi ovat muuttuneet. Päivitä vertailu ennen hyväksymistä.",
  "Your purchasing rules changed. Refresh the comparison and prepare a new draft.": "Hankintasääntösi ovat muuttuneet. Päivitä vertailu ja valmistele uusi luonnos.",
  "Refresh prices and availability and prepare a new draft.": "Päivitä hinnat ja saatavuus ja valmistele uusi luonnos.",
  "Refresh prices and availability before approving this draft.": "Päivitä hinnat ja saatavuus ennen luonnoksen hyväksymistä.",
  "Refresh prices and availability before preparing this order": "Päivitä hinnat ja saatavuus ennen tilauksen valmistelua.",
  "A supplier cutoff expired or is unknown. Refresh prices and availability.": "Toimittajan tilausaika on päättynyt tai sitä ei tunneta. Päivitä hinnat ja saatavuus.",
  "This approval request changed": "Hyväksyttävä pyyntö on muuttunut.",
  "Request changed; refresh its state": "Pyyntö on muuttunut. Lataa sen tila uudelleen.",
  "Request changed before the edit. Refresh it and try again.": "Pyyntö muuttui ennen muokkausta. Lataa se uudelleen ja yritä uudestaan.",
  "Account requirements changed; compare again": "Tilin vaatimukset ovat muuttuneet. Tee vertailu uudelleen.",
  "This request is closed": "Tämä pyyntö on suljettu.",
  "Product is not in the current comparison": "Tuote ei ole mukana nykyisessä vertailussa.",
  "Estimated arrival": "Arvioitu toimituspäivä",
  "After your deadline": "Määräajan jälkeen",
  "Delivery date unverified": "Toimituspäivää ei ole vahvistettu",
  "Stock is not verified sufficient": "Varaston riittävyyttä ei ole vahvistettu.",
  "Order cutoff expired or unknown": "Tilausaika on päättynyt tai sitä ei tunneta.",
  "Price or required pack quantity is unknown": "Hintaa tai tarvittavaa pakkausmäärää ei tunneta.",
  "No catalog product matched this line and its requirements.": "Tälle riville ei löytynyt vaatimukset täyttävää tuotetta valikoimasta.",
  "The supplier did not return usable availability evidence for every checked offer. Refresh the lookup to retry.": "Toimittaja ei palauttanut kaikille tarkistetuille vaihtoehdoille käyttökelpoisia saatavuustietoja. Yritä uudelleen päivittämällä vertailu.",
  "The supplier returned an empty delivery schedule for at least one offer.": "Toimittaja palautti tyhjän toimitusaikataulun vähintään yhdelle vaihtoehdolle.",
  "The supplier did not return usable price evidence for every checked offer. Refresh the lookup to retry.": "Toimittaja ei palauttanut kaikille tarkistetuille vaihtoehdoille käyttökelpoisia hintatietoja. Yritä uudelleen päivittämällä vertailu.",
  "Refresh the supplier observations": "Päivitä toimittajan tiedot.",
  "Refresh the supplier observations.": "Päivitä toimittajan tiedot.",
  "Refresh the supplier observations for the recommended dates.": "Päivitä toimittajan tiedot suositelluille päiville.",
  "At least one item has no eligible offer on the checked dates.": "Vähintään yhdelle tuotteelle ei löytynyt sopivaa vaihtoehtoa tarkistetuilta päiviltä.",
  "The checked offers did not yield a basket within the comparison search limit.": "Vertailun hakurajan puitteissa ei löytynyt sopivaa ostoskoria.",
  "No combination from the checked offers fits both the shared budget and available stock.": "Mikään tarkistettu yhdistelmä ei mahdu kokonaisbudjettiin ja saatavilla olevaan varastoon.",
  "No combination from the checked offers fits the available stock and supported order total.": "Mikään tarkistettu yhdistelmä ei sovi saatavilla olevaan varastoon ja tuettuun tilauksen kokonaissummaan.",
};

export function tradeMessage(message: string, t: Translate) {
  return t(message, finnishMessages[message] ?? message);
}
