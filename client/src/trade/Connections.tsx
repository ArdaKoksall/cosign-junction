import { useEffect, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ArrowUpRight, Check, Copy, Link2, ShieldCheck, Unplug } from "lucide-react";
import { Button } from "../components/ui";
import { CosignWordmark } from "../components/CoSignBrand";
import { useI18n } from "../i18n";
import { tradeApi, type Session } from "./api";
import { agentClientLabel, agentClients, scopeLabel, type AgentClient } from "./tradeCopy";
import { BrandIcon } from "./Workbench";
import "./connections.css";

const clients = {
  chatgpt: {
    url: "https://chatgpt.com/plugins",
    docs: "https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt",
  },
  claude: {
    url: "https://claude.ai/customize/connectors",
    docs: "https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp",
  },
  "claude-code": {
    docs: "https://code.claude.com/docs/en/mcp",
  },
  codex: {
    docs: "https://developers.openai.com/codex/mcp",
  },
  custom: {
    docs: "https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization",
  },
};

type Grant = {
  id: string;
  name: string;
  scopes: string[];
  revoked_at: string | null;
};

export function Connections({
  session,
  action,
  busy,
  initialClient = "chatgpt",
}: {
  session: Session;
  action: (fn: () => Promise<void>) => Promise<void>;
  busy: boolean;
  initialClient?: AgentClient;
}) {
  const { t } = useI18n();
  const [grants, setGrants] = useState<Grant[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let current = true;
    void tradeApi<Grant[]>("/connections")
      .then((result) => { if (current) setGrants(result); })
      .catch(() => { if (current) setLoadFailed(true); });
    return () => { current = false; };
  }, []);

  return (
    <section className="trade-settings mcp-settings">
      <header className="mcp-intro">
        <div>
          <h1>{t("Agent connections", "Agenttiyhteydet")}</h1>
          <p>{t(
            "Use your preferred assistant to find products and prepare purchases. Your account’s purchasing rules apply to every connection.",
            "Etsi tuotteita ja valmistele ostoja haluamallasi avustajalla. Tilisi ostosäännöt koskevat kaikkia yhteyksiä.",
          )}</p>
        </div>
        <Link2 aria-hidden="true" className="mcp-intro-icon" size={32} />
      </header>

      <ClientInstall key={initialClient} mcpUrl={session.mcpUrl} initialClient={initialClient} />

      <section className="mcp-grants" aria-labelledby="mcp-grants-title">
        <h2 id="mcp-grants-title">{t("Your connections", "Omat yhteydet")}</h2>
        {loadFailed ? (
          <p role="alert">{t("Could not load your connections.", "Yhteyksiä ei voitu ladata.")}</p>
        ) : !grants ? (
          <p role="status">{t("Loading connections…", "Ladataan yhteyksiä…")}</p>
        ) : grants.length === 0 ? (
          <div className="mcp-empty"><Unplug aria-hidden="true" size={19} />
            <p>{t("No external agents connected yet.", "Ulkoisia agentteja ei ole vielä yhdistetty.")}</p>
          </div>
        ) : grants.map((grant) => (
          <article className="mcp-grant" key={grant.id}>
            <div>
              <h3>{grant.name || t("MCP client", "MCP-asiakas")}</h3>
              <ul>
                {grant.scopes.map((scope) => <li key={scope}>{scopeLabel(scope, t)}</li>)}
              </ul>
            </div>
            {grant.revoked_at ? (
              <span>{t("Revoked", "Peruttu")}</span>
            ) : (
              <Button
                disabled={busy}
                variant="danger"
                onClick={() => void action(async () => {
                  await tradeApi(`/connections/${grant.id}/revoke`, {});
                  setGrants(await tradeApi<Grant[]>("/connections"));
                })}
              >
                {t("Revoke access", "Peru käyttöoikeus")}
              </Button>
            )}
          </article>
        ))}
      </section>

      <section className="mcp-hosted" aria-labelledby="mcp-hosted-title">
        <ShieldCheck aria-hidden="true" size={20} />
        <div>
          <h2 id="mcp-hosted-title">{t("Built-in assistant", "Sisäinen avustaja")}</h2>
          <p>{session.nemotronModel ?? t(
            "NVIDIA credentials have not been configured.",
            "NVIDIA-tunnuksia ei ole määritetty.",
          )}</p>
        </div>
      </section>
    </section>
  );
}

function ClientInstall({ mcpUrl, initialClient }: { mcpUrl: string; initialClient: AgentClient }) {
  const { t } = useI18n();
  const reduced = useReducedMotion();
  const [client, setClient] = useState<AgentClient>(initialClient);
  const selected = clients[client];
  const clientName = agentClients[client];
  const custom = client === "custom";
  const cloud = "url" in selected;
  const usesHttps = mcpUrl.startsWith("https://");
  const command = client === "claude-code"
    ? `claude mcp add --transport http cosign ${mcpUrl}`
    : `codex mcp add cosign --url ${mcpUrl}`;

  return (
    <section className="mcp-install" aria-labelledby="mcp-install-title">
      <div className="mcp-clients" role="group" aria-label={t("Choose your assistant", "Valitse avustaja")}>
        {(Object.keys(agentClients) as AgentClient[]).map((id) => (
          <button key={id} type="button" onClick={() => setClient(id)} aria-pressed={id === client}>
            {id === client && (
              <motion.span
                aria-hidden="true"
                className="cs-pill"
                layoutId="mcp-client-pill"
                transition={reduced ? { duration: 0 } : { type: "spring", duration: 0.45, bounce: 0 }}
              />
            )}
            <span className="mcp-client-icon"><BrandIcon brand={id} /></span>
            <span className="mcp-client-label">
              <strong>{agentClientLabel(id, t)}</strong>
              <small>{id === "chatgpt" ? t("Web", "Verkko")
                : id === "claude" ? t("Web and desktop", "Verkko ja työpöytä")
                : id === "custom" ? t("MCP client", "MCP-asiakas")
                : t("Terminal", "Pääte")}</small>
            </span>
          </button>
        ))}
      </div>

      <div className="mcp-guide" key={client}>
        <div className="mcp-guide-heading">
          <h2 id="mcp-install-title">{custom ? t("Connect your own agent", "Yhdistä oma agentti")
            : t(`Connect ${clientName}`, `Yhdistä ${clientName}`)}</h2>
          <a href={selected.docs} target="_blank" rel="noopener noreferrer">
            {custom ? t("MCP OAuth guide", "MCP:n OAuth-ohje") : t("Setup guide", "Asennusohje")}
            <ArrowUpRight aria-hidden="true" size={15} />
          </a>
        </div>
        {(cloud || custom) && !usesHttps && (
          <p className="mcp-address-note">{custom ? t(
            "This address is only reachable on the machine running Cosign. If your agent runs elsewhere, use a workspace with an HTTPS address the agent can reach.",
            "Tämä osoite toimii vain koneella, jolla Cosign on käynnissä. Jos agenttisi toimii muualla, käytä työtilaa, jonka HTTPS-osoite on agentin saavutettavissa.",
          ) : t(
            "This workspace uses a local address. Set up a public HTTPS deployment or tunnel to connect this app.",
            "Työtilan osoite on paikallinen. Yhdistä sovellus julkisen HTTPS-osoitteen tai tunnelin kautta.",
          )}</p>
        )}

        <ol className="mcp-steps" role="list">
          <li>
            {cloud || custom ? (
              <>
                <strong>{t("Add the MCP server", "Lisää MCP-palvelin")}</strong>
                {custom ? (
                  <p>{t(
                    "In your agent’s MCP settings, add a server using the Streamable HTTP transport.",
                    "Lisää palvelin agenttisi MCP-asetuksissa ja valitse siirtotavaksi Streamable HTTP.",
                  )}</p>
                ) : client === "chatgpt" ? (
                  <p>{t(
                    "In ChatGPT on the web, open Plugins, select +, then Add custom MCP server. If the option is missing, check your workspace permissions for custom MCP servers.",
                    "Avaa ChatGPT:n verkkoversiossa Plugins, valitse + ja sitten Add custom MCP server. Jos valinta puuttuu, tarkista työtilan mukautettujen MCP-palvelinten käyttöoikeudet.",
                  )}</p>
                ) : (
                  <p>{t(
                    "In Claude, open Customize → Connectors, select + Add, then Add custom connector. In a shared workspace, an owner may need to add it first.",
                    "Avaa Claudessa Customize → Connectors, valitse + Add ja sitten Add custom connector. Jaetussa työtilassa omistajan täytyy ehkä lisätä yhteys ensin.",
                  )}</p>
                )}
                <p>{t("Use this name and server address.", "Käytä tätä nimeä ja palvelinosoitetta.")}</p>
                <CopyValue value="VALIO:Cosign" label={t("Connector name", "Yhteyden nimi")}>
                  <CosignWordmark />
                </CopyValue>
                <CopyValue value={mcpUrl} label={t("MCP server address", "MCP-palvelimen osoite")} />
              </>
            ) : (
              <>
                <strong>{t("Run the setup command", "Suorita asennuskomento")}</strong>
                <CopyValue value={command} label={t("Terminal command", "Päätekomento")} />
              </>
            )}
          </li>
          <li>
            <strong>{t("Sign in and approve access", "Kirjaudu ja hyväksy käyttöoikeudet")}</strong>
            {custom ? (
              <p>{t(
                "Use OAuth discovery and dynamic client registration (DCR) with the authorization code flow and PKCE (S256). When your agent opens the sign-in page, sign in to this workspace and approve access.",
                "Käytä OAuth-palvelimen automaattista hakua, dynaamista asiakasrekisteröintiä (DCR) ja valtuutuskoodityönkulkua, jossa on käytössä PKCE (S256). Kun agentti avaa kirjautumissivun, kirjaudu tähän työtilaan ja hyväksy käyttöoikeudet.",
              )}</p>
            ) : client === "chatgpt" ? (
              <p>{t(
                "Choose OAuth and use dynamic client registration (DCR). Create and install the plugin, then sign in and approve access when prompted.",
                "Valitse OAuth ja käytä dynaamista asiakasrekisteröintiä (DCR). Luo ja asenna laajennus, kirjaudu sitten pyydettäessä ja hyväksy käyttöoikeudet.",
              )}</p>
            ) : client === "claude" ? (
              <p>{t(
                "Choose Sign in now and Register automatically. Add the connector, then sign in to this workspace and approve access.",
                "Valitse Sign in now ja Register automatically. Lisää yhteys, kirjaudu tähän työtilaan ja hyväksy käyttöoikeudet.",
              )}</p>
            ) : client === "claude-code" ? (
              <p>{t(
                "Open /mcp in Claude Code, select cosign, then follow the browser sign-in.",
                "Avaa /mcp Claude Codessa, valitse cosign ja kirjaudu selaimessa.",
              )}</p>
            ) : (
              <CopyValue value="codex mcp login cosign" label={t("Sign-in command", "Kirjautumiskomento")} />
            )}
          </li>
          {custom && (
            <li>
              <strong>{t("Verify the connection", "Tarkista yhteys")}</strong>
              <p>{t("List the available tools and call", "Listaa käytettävissä olevat työkalut ja kutsu työkalua")} {" "}
                <code>get_account_context</code> {t("with", "parametreilla")} <code>{"{}"}</code>.
                {" "}{t("It returns your account’s purchasing rules without creating a request.", "Se palauttaa tilisi ostosäännöt luomatta hankintapyyntöä.")}
              </p>
            </li>
          )}
        </ol>

        {cloud && usesHttps && (
          <a className="mcp-open-client" href={selected.url} target="_blank" rel="noopener noreferrer">
            {client === "chatgpt" ? t("Open ChatGPT Plugins", "Avaa ChatGPT Plugins")
              : t("Open Claude Connectors", "Avaa Claude Connectors")}
            <ArrowUpRight aria-hidden="true" size={16} />
          </a>
        )}
        {client === "claude" && (
          <details className="mcp-local">
            <summary>{t("Claude Desktop on your computer", "Paikallinen Claude Desktop")}</summary>
            <p>{t(
              "Build the adapters and server in the repository, then run the sign-in command. In your desktop MCP configuration, set the command to Node, add the absolute path to server/dist/trade/stdio.js as its argument and set COSIGN_MCP_URL to this workspace’s server address.",
              "Käännä sovittimet ja palvelin projektin hakemistossa ja suorita sitten kirjautumiskomento. Aseta työpöytäsovelluksen MCP-määrityksessä komennoksi Node ja sen argumentiksi tiedoston server/dist/trade/stdio.js absoluuttinen polku. Aseta COSIGN_MCP_URL tämän työtilan palvelinosoitteeseen.",
            )}</p>
            <CopyValue value={`COSIGN_MCP_URL=${mcpUrl} node server/dist/trade/stdio.js --login`} label={t("Local sign-in command", "Paikallinen kirjautumiskomento")} />
          </details>
        )}
      </div>
    </section>
  );
}

function CopyValue({ value, label, children }: { value: string; label: string; children?: ReactNode }) {
  const { t } = useI18n();
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <div className="mcp-copy">
      <span>{label}</span>
      <div className="mcp-copy-value">
        {children ?? <code>{value}</code>}
        <button type="button" aria-label={`${t("Copy", "Kopioi")}: ${label}`} onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setStatus("copied");
          } catch {
            setStatus("failed");
          }
        }}>
          {status === "copied" ? <Check aria-hidden="true" size={16} /> : <Copy aria-hidden="true" size={16} />}
        </button>
      </div>
      {status === "copied" && <small role="status">{t("Copied", "Kopioitu")}</small>}
      {status === "failed" && (
        <small role="alert">{t("Copy unavailable. Select the text above.", "Kopiointi ei onnistunut. Valitse yllä oleva teksti.")}</small>
      )}
    </div>
  );
}
