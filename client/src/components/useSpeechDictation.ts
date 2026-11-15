import { useEffect, useRef, useState } from "react";
import { useI18n, type Translate } from "../i18n";

export const dictationLanguages = { "en-US": "English", "fi-FI": "Finnish" } as const;
export type DictationLanguage = keyof typeof dictationLanguages;

type RecognitionResult = { isFinal: boolean; 0: { transcript: string } };
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { resultIndex: number; results: ArrayLike<RecognitionResult> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};

type SpeechWindow = Window & {
  SpeechRecognition?: new () => Recognition;
  webkitSpeechRecognition?: new () => Recognition;
};

function speechError(code: string, t: Translate) {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return t("Microphone or speech access was blocked. Check your browser permissions or type your request.",
        "Mikrofonin tai puhepalvelun käyttö estettiin. Tarkista selaimen käyttöoikeudet tai kirjoita pyyntö.");
    case "audio-capture":
      return t("No microphone was available. Connect a microphone or type your request.",
        "Mikrofonia ei löydy. Liitä mikrofoni tai kirjoita pyyntö.");
    case "language-not-supported":
      return t("Your browser’s speech service does not support this language. Try another language or type your request.",
        "Selaimen puhepalvelu ei tue tätä kieltä. Kokeile toista kieltä tai kirjoita pyyntö.");
    case "no-speech":
      return t("No speech was heard. Try again or type your request.", "Puhetta ei kuulunut. Yritä uudelleen tai kirjoita pyyntö.");
    case "cosign:note-full":
      return t("The note is full. Shorten it before starting another dictation.", "Muistiinpano on täynnä. Lyhennä sitä ennen seuraavaa sanelua.");
    case "cosign:timeout":
      return t("Dictation took too long to finish. Review the note before continuing.", "Sanelun viimeistely kesti liian kauan. Tarkista muistiinpano ennen jatkamista.");
    default:
      return t("Speech recognition is unavailable. Try again or type your request.", "Puheentunnistus ei ole käytettävissä. Yritä uudelleen tai kirjoita pyyntö.");
  }
}

export function useSpeechDictation(disabled: boolean) {
  const { t } = useI18n();
  const browser = window as SpeechWindow;
  const SpeechRecognition = browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
  const supported = Boolean(SpeechRecognition && browser.isSecureContext !== false);
  const [phase, setPhase] = useState<"idle" | "listening" | "finishing">("idle");
  const [error, setError] = useState("");
  const active = useRef<Recognition | null>(null);
  const stopTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (disabled && active.current) {
      const recognition = active.current;
      active.current = null;
      window.clearTimeout(stopTimer.current);
      recognition.abort();
      setPhase("idle");
    }
  }, [disabled]);

  useEffect(() => () => {
    const recognition = active.current;
    active.current = null;
    window.clearTimeout(stopTimer.current);
    recognition?.abort();
  }, []);

  function start(language: DictationLanguage, append: (transcript: string) => boolean) {
    if (disabled || !supported || !SpeechRecognition || active.current) return;
    setError("");
    let recognition: Recognition;
    try {
      recognition = new SpeechRecognition();
    } catch {
      setError("unavailable");
      return;
    }
    active.current = recognition;
    recognition.lang = language;
    recognition.continuous = true;
    recognition.interimResults = false;
    let heard = false;
    let nextFinal = 0;

    function finish(message = "") {
      if (active.current !== recognition) return;
      active.current = null;
      window.clearTimeout(stopTimer.current);
      setPhase("idle");
      setError(message);
    }

    recognition.onresult = ({ resultIndex, results }) => {
      if (active.current !== recognition) return;
      const phrases: string[] = [];
      for (let index = Math.max(resultIndex, nextFinal); index < results.length; index++) {
        const result = results[index];
        if (!result.isFinal) break;
        nextFinal = index + 1;
        const phrase = result[0].transcript.trim();
        if (phrase) phrases.push(phrase);
      }
      if (!phrases.length) return;
      heard = true;
      if (!append(phrases.join(" "))) {
        finish("cosign:note-full");
        recognition.abort();
      }
    };
    recognition.onerror = ({ error: code }) => finish(code);
    recognition.onend = () => finish(heard ? "" : "no-speech");
    try {
      setPhase("listening");
      recognition.start();
    } catch {
      finish("unavailable");
    }
  }

  function stop() {
    const recognition = active.current;
    if (!recognition || phase !== "listening") return;
    setPhase("finishing");
    stopTimer.current = window.setTimeout(() => {
      active.current = null;
      recognition.abort();
      setPhase("idle");
      setError("cosign:timeout");
    }, 5000);
    try {
      recognition.stop();
    } catch {
      active.current = null;
      window.clearTimeout(stopTimer.current);
      setPhase("idle");
      setError("unavailable");
    }
  }

  return { supported, phase, error: error ? speechError(error, t) : "", start, stop };
}
