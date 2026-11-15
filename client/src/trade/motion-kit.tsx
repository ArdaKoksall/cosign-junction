// Motion vocabulary for the buyer workspace.
//
// Rules this file encodes, so every surface moves the same way:
// - Interactions use short ease-out transitions that can be interrupted.
// - One staged entrance per page: words and blocks arrive in sequence, once.
// - A value that changes rolls to its replacement, so the change is seen.
// - Nothing loops. Motion is tied to an event, the pointer or the scroll.
import { AnimatePresence, animate, motion, useReducedMotion } from "motion/react";
import {
  createElement,
  useEffect,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

export const easeOut = [0.22, 1, 0.36, 1] as const;
export const springs = {
  // Panels and layout shifts: quick, no overshoot.
  panel: { type: "spring", duration: 0.45, bounce: 0 },
  // Paper that hangs or lands: a little follow-through.
  hang: { type: "spring", stiffness: 260, damping: 13, mass: 0.9 },
  // Small confirmations.
  pop: { type: "spring", stiffness: 520, damping: 22 },
} as const;

/** A pen stroke drawn under a phrase, in the hand that signs the wordmark. */
export function Scribble({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`cs-scribble ${className}`}
      viewBox="0 0 200 14"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path d="M3 9.5C28 4 58 11.5 96 7S160 3.5 197 8.5" pathLength="1" />
    </svg>
  );
}

/**
 * Page headline. Words arrive in sequence (rise, sharpen, fade in).
 * A phrase in [brackets] is underlined with a pen stroke once the words land.
 */
export function Headline({
  text,
  as = "h1",
  className = "",
}: {
  text: string;
  as?: "h1" | "h2";
  className?: string;
}) {
  const plain = text.replace(/[[\]]/g, "");
  const match = text.match(/^(.*?)\[(.+?)\](.*)$/);
  const before = (match ? match[1] : text).split(" ").filter(Boolean);
  const marked = match ? match[2].split(" ").filter(Boolean) : [];
  const after = match ? match[3] : "";
  let position = 0;
  const word = (value: string, key: string, space: boolean) => (
    <span className="cs-word" key={key} style={{ "--i": position++ } as CSSProperties}>
      {value}
      {space ? " " : ""}
    </span>
  );
  return createElement(
    as,
    { className: `cs-headline ${className}`, "aria-label": plain },
    <span aria-hidden="true">
      {before.map((value, index) => word(value, `b${index}`, true))}
      {marked.length > 0 && (
        <span className="cs-mark" style={{ "--n": before.length + marked.length } as CSSProperties}>
          {marked.map((value, index) => word(value, `m${index}`, index < marked.length - 1))}
          <Scribble />
        </span>
      )}
      {after && word(after.trimStart(), "after", false)}
    </span>,
  );
}

/** A block that joins the page's staged entrance at position `order`. */
export function Enter({
  order = 0,
  className = "",
  children,
  as = "div",
}: {
  order?: number;
  className?: string;
  children: ReactNode;
  as?: "div" | "section" | "p" | "form";
}) {
  return createElement(
    as,
    { className: `cs-enter ${className}`, style: { "--i": order } as CSSProperties },
    children,
  );
}

/** A value that rolls to its replacement. */
export function Roll({ value }: { value: string | number }) {
  const reduced = useReducedMotion();
  if (reduced) return <span className="cs-roll">{value}</span>;
  return (
    <span className="cs-roll">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={value}
          initial={{ y: "70%", opacity: 0, filter: "blur(3px)" }}
          animate={{ y: 0, opacity: 1, filter: "blur(0px)" }}
          exit={{ y: "-70%", opacity: 0, filter: "blur(3px)" }}
          transition={{ duration: 0.24, ease: easeOut }}
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/** Example phrases shown one at a time inside an empty field. */
export function Examples({
  phrases,
  interval = 3400,
}: {
  phrases: string[];
  interval?: number;
}) {
  const reduced = useReducedMotion();
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (reduced || phrases.length < 2) return;
    const timer = setInterval(
      () => setIndex((value) => (value + 1) % phrases.length),
      interval,
    );
    return () => clearInterval(timer);
  }, [reduced, phrases.length, interval]);
  return <Roll value={phrases[index % phrases.length]} />;
}

/** Live status text that types itself out each time it changes. */
export function TypeLine({ text }: { text: string }) {
  const reduced = useReducedMotion();
  const [length, setLength] = useState(text.length);
  useEffect(() => {
    if (reduced) {
      setLength(text.length);
      return;
    }
    setLength(0);
    const controls = animate(0, text.length, {
      duration: Math.min(0.7, text.length * 0.02),
      ease: "linear",
      onUpdate: (latest) => setLength(Math.round(latest)),
    });
    return () => controls.stop();
  }, [text, reduced]);
  return (
    <span aria-label={text}>
      <span aria-hidden="true">{text.slice(0, length)}</span>
    </span>
  );
}

/** The current time, refreshed often enough for a clock that shows minutes. */
export function useNow(everyMs = 20_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}

/** Seconds since the component appeared; used to show how long work has run. */
export function useElapsed(active: boolean) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!active) return;
    setSeconds(0);
    const started = Date.now();
    const timer = setInterval(() => setSeconds(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return seconds;
}

/** Sends a copy of a product photo to a target, so an add is visibly received. */
export function flyTo(source: Element | null | undefined, target: Element | null) {
  if (!source || !target || typeof source.animate !== "function") return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const from = source.getBoundingClientRect();
  const to = target.getBoundingClientRect();
  if (!from.width || !to.width) return;
  const ghost = source.cloneNode(true) as HTMLElement;
  Object.assign(ghost.style, {
    position: "fixed",
    left: `${from.left}px`,
    top: `${from.top}px`,
    width: `${from.width}px`,
    height: `${from.height}px`,
    margin: "0",
    zIndex: "120",
    pointerEvents: "none",
    objectFit: "contain",
    mixBlendMode: "normal",
    transform: "none",
    transition: "none",
  });
  document.body.append(ghost);
  const dx = to.left + to.width / 2 - (from.left + from.width / 2);
  const dy = to.top + to.height / 2 - (from.top + from.height / 2);
  ghost
    .animate(
      [
        { transform: "translate(0,0) scale(1) rotate(0deg)", opacity: 1 },
        {
          transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 40}px) scale(0.55) rotate(-8deg)`,
          opacity: 1,
          offset: 0.5,
        },
        { transform: `translate(${dx}px, ${dy}px) scale(0.12) rotate(6deg)`, opacity: 0.25 },
      ],
      { duration: 520, easing: "cubic-bezier(0.4, 0, 0.2, 1)" },
    )
    .finished.finally(() => {
      ghost.remove();
      // The basket confirms it received the item.
      target.animate?.(
        [{ transform: "scale(1)" }, { transform: "scale(1.08)" }, { transform: "scale(1)" }],
        { duration: 260, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
      );
    });
}
