import { useI18n } from "../i18n";
import { ChevronDown, History } from "lucide-react";
import { useEffect, useState } from "react";
import { getRehearsalQuote, getSavedRequest } from "../api";
import type { DecisionEvent } from "../types";
import { DecisionTimeline } from "./DecisionTimeline";
import { Button } from "./ui";

function RequestEvents({ requestId, rehearsal }: { requestId: string; rehearsal: boolean }) {
  const { t } = useI18n();
  const [events, setEvents] = useState<DecisionEvent[] | null>(null);
  const [error, setError] = useState("");
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const request = rehearsal ? getRehearsalQuote(requestId, controller.signal) : getSavedRequest(requestId, controller.signal);
    request.then((response) => {
      if (!controller.signal.aborted) setEvents(response.events ?? []);
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : t("The decision trail could not be loaded.", "Päätöslokia ei voitu ladata."));
    });
    return () => controller.abort();
  }, [requestId, rehearsal, retryCount]);

  if (error) return (
    <div className="purchase-actions">
      <p className="purchase-note" role="alert">{error}</p>
      <Button variant="secondary" onClick={() => {
        setError("");
        setRetryCount((count) => count + 1);
      }}>{t("Retry", "Yritä uudelleen")}</Button>
    </div>
  );
  if (!events) return <p className="purchase-note" role="status">{t("Loading decision trail…", "Ladataan päätöslokia…")}</p>;
  return events.length ? <DecisionTimeline events={events} /> : <p className="purchase-note">{t("No decisions recorded for this request yet.", "Pyynnölle ei ole vielä kirjattu päätöksiä.")}</p>;
}

export function RequestDecisionTrail({ requestId, revision, approvedVersion, rehearsalRevision }: {
  requestId: string;
  revision?: number;
  approvedVersion: number | null;
  rehearsalRevision?: number;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <details className="purchase-disclosure purchase-request-trail" onToggle={({ currentTarget }) => setOpen(currentTarget.open)}>
      <summary>
        <History size={16} aria-hidden="true" />{t(" Decision trail ", " Päätösloki ")}<ChevronDown size={16} aria-hidden="true" />
      </summary>
      {open && (
        <div className="purchase-request-trail-content">
          <RequestEvents key={`${requestId}:${revision}:${approvedVersion}:${rehearsalRevision}`} requestId={requestId} rehearsal={rehearsalRevision !== undefined} />
        </div>
      )}
    </details>
  );
}
