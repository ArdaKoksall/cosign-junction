import { useI18n, type Translate } from "../i18n";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { CircleAlert, FileImage, FileText, LoaderCircle, Mic, ScanLine, Square, Upload, X } from "lucide-react";
import { analyzeKitchenIntake, formatEuro } from "../api";
import { formatCalendarDay } from "../helsinkiTime";
import { formatProductRequirements, productRequirementLabel } from "../productRequirements";
import { formatQuantity, quantityUnits } from "../quantity";
import { rankingLabel } from "../ranking";
import type { IntakeDraft, IntakeField } from "../types";
import { Button } from "./ui";
import { dictationLanguages, useSpeechDictation, type DictationLanguage } from "./useSpeechDictation";

const noteLimit = 2400;

const labels = (t: Translate): Record<IntakeField, string> => ({
  query: t("Product", "Tuote"), quantity: t("Quantity", "Määrä"), unit: t("Unit", "Yksikkö"), quantityLiters: t("Quantity", "Määrä"), deadline: t("Delivery deadline", "Toimituksen määräaika"),
  deadlineDate: t("Latest delivery date", "Viimeinen toimituspäivä"), budgetCents: t("Budget ex VAT", "Budjetti, alv 0 %"), diet: t("Product requirement", "Tuotevaatimus"),
});

function canApply(result: IntakeDraft) {
  return result.status !== "review_conflict" && Boolean(
    result.evidence.length || result.budgetEstimate || result.draft.requirements?.length || result.draft.rankingObjective,
  );
}

function sourceLabel(source: "note" | "image", t: Translate) {
  return source === "note" ? t("Note", "Muistiinpano") : t("Photo", "Kuva");
}

function validPhoto(file: File) {
  return ["image/png", "image/jpeg"].includes(file.type) && file.size <= 2 * 1024 * 1024;
}

async function readImage(file: File, t: Translate) {
  const url = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(t("Could not read the photo.", "Kuvaa ei voitu lukea.")));
    reader.readAsDataURL(file);
  });
  return { mimeType: file.type, base64: url.slice(url.indexOf(",") + 1) };
}

export function KitchenIntake({ onApply, onIncomplete, onReading, onDictating, onReview, photoEnabled, disabled }: {
  onApply: (result: IntakeDraft) => void;
  onIncomplete?: () => void;
  onReading: (reading: boolean) => void;
  onDictating?: (dictating: boolean) => void;
  onReview: () => void;
  photoEnabled: boolean;
  disabled: boolean;
}) {
  const { t, locale } = useI18n();
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File>();
  const [preview, setPreview] = useState<string>();
  const [result, setResult] = useState<IntakeDraft>();
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);
  const [dictationPreference, setDictationLanguage] = useState<DictationLanguage>();
  const dictationLanguage = dictationPreference ?? (locale === "fi" ? "fi-FI" : "en-US");
  const speech = useSpeechDictation(reading || disabled);
  const dictating = speech.phase !== "idle";
  const busy = reading || disabled || dictating;
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const filePicker = useRef<HTMLInputElement>(null);
  const activeRead = useRef<symbol | null>(null);

  useEffect(() => () => { activeRead.current = null; }, []);
  useEffect(() => { onDictating?.(dictating); }, [dictating, onDictating]);

  useEffect(() => {
    if (!file) {
      setPreview(undefined);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function invalidateResult() {
    if (result) onIncomplete?.();
    setResult(undefined);
    setError("");
  }

  function selectPhoto(nextFile?: File) {
    if (nextFile && !validPhoto(nextFile)) {
      setError(t("Choose a PNG or JPEG up to 2 MB.", "Valitse enintään 2 Mt:n PNG- tai JPEG-kuva."));
      return;
    }
    invalidateResult();
    setFile(nextFile);
  }

  function updateNote(next: string) {
    setNote(next);
    invalidateResult();
  }

  function startDictation() {
    let transcript = note.trimEnd();
    speech.start(dictationLanguage, (phrase) => {
      const next = transcript ? `${transcript} ${phrase}` : phrase;
      if (next.length > noteLimit) return false;
      transcript = next;
      updateNote(transcript);
      return true;
    });
  }

  function handleDragEnter(event: DragEvent<HTMLDivElement>) {
    if (!Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault();
    dragDepth.current += 1;
    setDragging(!busy);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (!busy && event.dataTransfer.files.length) selectPhoto(event.dataTransfer.files[0]);
  }

  async function read() {
    if (busy || activeRead.current) return;
    const request = Symbol();
    activeRead.current = request;
    setReading(true);
    onReading(true);
    setError("");
    setResult(undefined);
    try {
      const image = file && await readImage(file, t);
      if (activeRead.current !== request) return;
      const response = await analyzeKitchenIntake(note.trim(), image);
      if (activeRead.current !== request) return;
      setResult(response);
      if (canApply(response)) onApply(response);
      else onIncomplete?.();
    } catch (err) {
      if (activeRead.current === request) {
        onIncomplete?.();
        setError(err instanceof Error ? err.message : t("Could not read the kitchen request.", "Keittiön pyyntöä ei voitu lukea."));
      }
    } finally {
      if (activeRead.current === request) {
        activeRead.current = null;
        setReading(false);
        onReading(false);
      }
    }
  }

  const applied = result && canApply(result);
  const conflict = result?.status === "review_conflict";
  const requirementEvidence = result?.requirementEvidence ?? [];
  const otherRequirements = result?.draft.requirements?.filter((requirement) => !requirementEvidence.some((item) => item.requirement === requirement)) ?? [];
  const fieldEvidence = result?.evidence.filter(({ field }) => field !== "diet" || result.draft.diet !== "lactose-free"
    || !requirementEvidence.some(({ requirement }) => requirement === "lactose-free")) ?? [];

  return (
    <section className="evidence-panel intake-panel" id="request-intake" aria-labelledby="intake-title" tabIndex={-1}>
      <div className="evidence-panel-heading">
        <span className="evidence-icon"><FileText size={18} aria-hidden="true" /></span>
        <div>
          <h2 id="intake-title">{t("Describe your request", "Kuvaile pyyntöäsi")}</h2>
          <p>{t("Enter a short request", "Kirjoita lyhyt pyyntö")}{photoEnabled && t(" or upload a photo", " tai lataa kuva")}{t(". Review and edit the suggested fields before comparing.", ". Tarkista ja muokkaa ehdotettuja kenttiä ennen vertailua.")}</p>
        </div>
      </div>
      <label className="request-field">
        <span>{t("Note in Finnish or English", "Muistiinpano suomeksi tai englanniksi")}</span>
        <textarea rows={3} maxLength={noteLimit} value={note} placeholder={t("e.g. 12 litres of lactose-free cooking cream", "esim. 12 litraa laktoositonta ruokakermaa")}
          disabled={busy} onChange={(event) => updateNote(event.target.value)} />
      </label>
      {speech.supported && <div className="intake-dictation">
        <div className="intake-dictation-controls">
          <label className="request-field">
            <span>{t("Dictation language", "Sanelun kieli")}</span>
            <select value={dictationLanguage} disabled={busy} onChange={({ currentTarget }) =>
              setDictationLanguage(currentTarget.value as DictationLanguage)}>
              {Object.entries(dictationLanguages).map(([value, label]) => <option key={value} value={value}>{value === "fi-FI" ? t(label, "Suomi") : t(label, "Englanti")}</option>)}
            </select>
          </label>
          <Button type="button" variant="secondary" onClick={dictating ? speech.stop : startDictation}
            disabled={disabled || reading || speech.phase === "finishing" || !dictating && note.length >= noteLimit}>
            {dictating ? <Square size={16} aria-hidden="true" /> : <Mic size={16} aria-hidden="true" />}
            {speech.phase === "finishing" ? t("Finishing dictation…", "Viimeistellään sanelua…") : dictating ? t("Stop dictation", "Lopeta sanelu") : t("Dictate note", "Sanele muistiinpano")}
          </Button>
        </div>
        <small>{t("Your browser may send microphone audio to its speech service. Review the transcript before filling the form.", "Selain voi lähettää mikrofonin äänen puhepalveluun. Tarkista teksti ennen lomakkeen täyttämistä.")}</small>
        {dictating && <p className="intake-dictation-status" role="status">
          {speech.phase === "finishing" ? t("Finishing dictation.", "Viimeistellään sanelua.") : t("Listening…", "Kuunnellaan…")}
        </p>}
        {speech.error && <p className="intake-dictation-status" role="alert">{speech.error}</p>}
      </div>}
      {photoEnabled && <div className="intake-upload" onDragEnter={handleDragEnter} onDragOver={(event) => event.preventDefault()} onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (!dragDepth.current) setDragging(false);
      }} onDrop={handleDrop} data-dragging={dragging}>
        <div className="intake-upload-row">
          <input
            id="intake-photo" className="intake-file sr-only" ref={filePicker} type="file" accept="image/png,image/jpeg"
            aria-label={t("Photo", "Kuva")} aria-describedby="intake-photo-help" tabIndex={-1} disabled={busy} onChange={(event) => {
              if (event.target.files?.[0]) selectPhoto(event.target.files[0]);
              event.target.value = "";
            }}
          />
          <button className="intake-file-action" type="button" disabled={busy} onClick={() => filePicker.current?.click()}>
            <span className="evidence-icon">{file ? <FileImage size={18} aria-hidden="true" /> : <Upload size={18} aria-hidden="true" />}</span>
            <span>
              <strong>{file ? t("Replace photo", "Vaihda kuva") : t("Upload a photo", "Lataa kuva")}</strong>
              <small>{file?.name ?? t("Choose a file or drop it here", "Valitse tiedosto tai pudota se tähän")}</small>
            </span>
          </button>
          {file && (
            <button className="comparison-remove" type="button" aria-label={t("Remove photo", "Poista kuva")} disabled={busy} onClick={() => selectPhoto()}>
              <X size={17} aria-hidden="true" />
            </button>
          )}
        </div>
        <small id="intake-photo-help" className="intake-upload-help">{t("PNG or JPEG, up to 2 MB.", "PNG tai JPEG, enintään 2 Mt.")}</small>
      </div>}
      {preview && (
        <div className="intake-photo-preview" key={preview}>
          <img className="intake-thumb" src={preview} alt={t("Selected kitchen note", "Valittu muistiinpano")} />
          {reading && <span className="intake-photo-scan" aria-hidden="true" />}
        </div>
      )}
      <div className="intake-submit">
        <Button type="button" variant="secondary" onClick={() => void read()} disabled={busy || (!note.trim() && !file)}>
          {reading ? <LoaderCircle className="intake-spinner" size={16} aria-hidden="true" /> : <ScanLine size={17} aria-hidden="true" />}
          {reading ? t("Reading…", "Luetaan…") : t("Fill request fields", "Täytä pyynnön kentät")}
        </Button>
        {photoEnabled && <small>{t("Notes and photos may be sent to NVIDIA to read the request.", "Muistiinpanot ja kuvat voidaan lähettää NVIDIAlle pyynnön lukemista varten.")}</small>}
      </div>
      {error && (
        <div className="evidence-note evidence-note--attention" role="alert">
          <CircleAlert size={17} aria-hidden="true" /><p>{error}</p>
        </div>
      )}
      <div className="intake-announcement" aria-live="polite">
        {reading && (
          <div className="intake-progress">
            <p>{t("Reading the request details.", "Luetaan pyynnön tietoja.")}</p>
            <span aria-hidden="true" />
          </div>
        )}
        {result && (
          <div className="intake-result">
            {result.model.startsWith("nvidia/nemotron-") && <p className="intake-reader">{t("Read by NVIDIA Nemotron", "Lukija: NVIDIA Nemotron")}</p>}
            {conflict ? (
              <>
                <p><strong>{result.question ?? t("Confirm the conflicting details in the request form.", "Vahvista ristiriitaiset tiedot pyyntölomakkeessa.")}</strong></p>
                {!!result.conflictEvidence?.length && <dl className="intake-source-fields intake-conflict-evidence">
                  {result.conflictEvidence.map(({ source, excerpt }) => (
                    <div key={`${source}:${excerpt}`}><dt>{sourceLabel(source, t)}</dt><dd>“{excerpt}”</dd></div>
                  ))}
                </dl>}
                <Button variant="secondary" onClick={onReview} disabled={busy}>{t("Review request fields", "Tarkista pyynnön kentät")}</Button>
              </>
            ) : (
              <>
                <p><strong>{applied ? t("Review the suggested fields in the request form.", "Tarkista ehdotetut kentät pyyntölomakkeessa.")
                  : result.question ?? t("Enter the details in the request form.", "Syötä tiedot pyyntölomakkeeseen.")}</strong></p>
                {applied && result.question && <p>{result.question}</p>}
              </>
            )}
            {!conflict && (fieldEvidence.length > 0 || requirementEvidence.length > 0 || otherRequirements.length > 0 || result.draft.rankingObjective) && (
              <dl className="intake-source-fields">
                {fieldEvidence.map(({ field, source, excerpt }) => {
                  const value = result.draft[field];
                  const display = field === "budgetCents" && typeof value === "number" ? formatEuro(value, locale)
                    : field === "deadline" && typeof value === "string"
                      ? new Date(value).toLocaleString(locale === "fi" ? "fi-FI" : "en-FI", { timeZone: "Europe/Helsinki" })
                      : field === "deadlineDate" && typeof value === "string" ? formatCalendarDay(value, locale)
                        : field === "quantityLiters" && typeof value === "number" ? formatQuantity(value, "L", locale)
                          : field === "unit" ? quantityUnits.find(({ value: unit }) => unit === value)?.[locale === "fi" ? "finnish" : "label"]
                            : field === "diet" ? (value === "none" ? t("No dietary restriction", "Ei ruokavaliorajoituksia") : t("Lactose-free", "Laktoositon"))
                              : value;
                  return (
                    <div key={field}>
                      <dt>{labels(t)[field]}</dt>
                      <dd>{display}<small>{sourceLabel(source, t)} · “{excerpt}”</small></dd>
                    </div>
                  );
                })}
                {requirementEvidence.map(({ requirement, source, excerpt }) => (
                  <div key={`${requirement}:${source}:${excerpt}`}>
                    <dt>{t("Product requirement", "Tuotevaatimus")}</dt>
                    <dd>{productRequirementLabel(requirement, locale)}<small>{sourceLabel(source, t)} · “{excerpt}”</small></dd>
                  </div>
                ))}
                {otherRequirements.length > 0 && (
                  <div><dt>{t("Product requirements", "Tuotevaatimukset")}</dt><dd>{formatProductRequirements(otherRequirements, locale)}</dd></div>
                )}
                {result.draft.rankingObjective && (
                  <div>
                    <dt>{t("Comparison priority", "Vertailun painotus")}</dt>
                    <dd>{rankingLabel(result.draft.rankingObjective, locale)}{result.rankingEvidence && (
                      <small>{sourceLabel(result.rankingEvidence.source, t)} · “{result.rankingEvidence.excerpt}”</small>
                    )}</dd>
                  </div>
                )}
              </dl>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
