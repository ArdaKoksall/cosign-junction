import { calendarDateInHelsinki } from "@cosign/adapters";
import { z } from "zod";

const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const finnishWeekdays = ["sunnuntai", "maanantai", "tiistai", "keskiviikk", "torstai", "perjantai", "lauantai"];
const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const monthNames = months.join("|");
const namedDayPattern = String.raw`\d{1,2}(?:st|nd|rd|th)?`;
const namedDatePattern = `(?:(?:the\\s+)?${namedDayPattern}\\s+(?:of\\s+)?(?:${monthNames})|(?:${monthNames})\\s+${namedDayPattern})(?:,?\\s+\\d{4})?`;
const monthEndPattern = String.raw`(?:(?:the\s+)?last\s+day\s+of\s+this\s+month|(?:the\s+)?end\s+of\s+this\s+month|month[ -]end)`;
const monthEnd = new RegExp(`^${monthEndPattern}$`, "iu");
const monthDayPattern = String.raw`(?:the\s+)?(\d{1,2})(st|nd|rd|th)\s+of\s+this\s+month`;
const monthDay = new RegExp(`^${monthDayPattern}$`, "iu");
const relativePattern = `(?:(?:next|this|ensi)\\s+)?(?:${weekdays.join("|")}|${finnishWeekdays.map((day) => `${day}\\p{L}*`).join("|")})|today|tomorrow|tänään|huomenna|${monthEndPattern}|${monthDayPattern}`;
export const deadlineDatePattern = `(?:\\d{4}-\\d{2}-\\d{2}|\\d{1,2}\\.\\d{1,2}\\.(?:\\d{4})?|${namedDatePattern}|${relativePattern})`;
const datePattern = new RegExp(`(?<![\\p{L}\\d])(?:(?:before|by|on|for|until|ennen|viimeistään)\\s+)?(${deadlineDatePattern})(?=T\\d|[^\\p{L}\\d]|$)`, "giu");
const writtenTime = /\b(?:(?:at\s+|klo\.?\s*|kello\s+)(?:[01]?\d|2[0-3])\b(?![.,]\d)|(?:[01]?\d|2[0-3]):[0-5]\d\b|(?:0?[1-9]|1[0-2])\s*[ap]\.?m\.?\b|noon\b|midnight\b)/i;
const clockPattern = String.raw`(\d{1,2})(?:[:.]([0-5]\d))?(?:\s*([ap])\.?m\.?)?(?![\p{L}\d]|[:.]\d)`;
const timeAfterDate = new RegExp(String.raw`^(?:T|(?:\s*,\s*|\s+)(?:(?:at|by|before|kello)\s+|klo\.?\s*)?)${clockPattern}`, "iu");
const timeBeforeDate = new RegExp(String.raw`\b(?:at\s+|klo\.?\s*|kello\s+|before\s+|by\s+)?${clockPattern}\s+(?:helsinki\s+time\s+)?$`, "iu");
const alternativeClockAfter = new RegExp(String.raw`^\s*(?:or\b|tai\b|[/–—-])\s*(?:(?:at|kello)\s+|klo\.?\s*)?${clockPattern}`, "iu");
const alternativeClockBefore = new RegExp(String.raw`\b${clockPattern}\s*(?:\bor\b|\btai\b|[/–—-])\s*$`, "iu");
const calendarDate = z.iso.date();

const localClock = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Helsinki", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

function helsinkiInstant(date: string, hour: number, minute: string) {
  if (hour > 23) return null;
  const clock = `${date}T${String(hour).padStart(2, "0")}:${minute}:00`;
  const naive = Date.parse(`${clock}Z`);
  if (!Number.isFinite(naive)) return null;
  const display = (time: number) => localClock.format(time).replace(" ", "T");
  const candidates = new Set([naive - 86_400_000, naive + 86_400_000].map((sample) =>
    naive - (Date.parse(`${display(sample)}Z`) - sample),
  ));
  const matching = [...candidates].filter((candidate) => display(candidate) === clock);
  return matching.length === 1 ? new Date(matching[0]).toISOString() : null;
}

function shiftDay(date: string, days: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

function readCalendarDate(phrase: string) {
  const dotted = phrase.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})?$/u);
  const named = phrase.toLowerCase().match(/^(?:(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([a-z]+)|([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?)(?:,?\s+(\d{4}))?$/u);
  if (dotted || named) {
    const day = dotted?.[1] ?? named?.[1] ?? named?.[4];
    const month = dotted?.[2] ?? String(months.indexOf(named?.[2] ?? named?.[3] ?? "") + 1);
    return { monthAndDay: `${month.padStart(2, "0")}-${day?.padStart(2, "0")}`, year: dotted?.[3] ?? named?.[5] };
  }
}

function resolveCalendarDate({ monthAndDay, year }: NonNullable<ReturnType<typeof readCalendarDate>>, earliest: string) {
  if (year) return calendarDate.safeParse(`${year}-${monthAndDay}`).data;
  if (!calendarDate.safeParse(`2000-${monthAndDay}`).success) return;
  const startYear = Number(earliest.slice(0, 4));
  // February 29 can be eight years apart when a century year is skipped.
  for (let candidateYear = startYear; candidateYear <= startYear + 8; candidateYear++) {
    const candidate = `${candidateYear}-${monthAndDay}`;
    if (candidate >= earliest && calendarDate.safeParse(candidate).success) return candidate;
  }
}

function calendarDay(phrase: string, today: string) {
  if (/^\d{4}-/.test(phrase)) return calendarDate.safeParse(phrase).data;
  if (/^(?:today|tänään)$/iu.test(phrase)) return today;
  if (/^(?:tomorrow|huomenna)$/iu.test(phrase)) return shiftDay(today, 1);
  const ordinal = phrase.match(monthDay);
  if (ordinal) {
    const [, day, suffix] = ordinal;
    const number = Number(day);
    const ending = number >= 11 && number <= 13 ? "th" : ["th", "st", "nd", "rd"][number % 10] ?? "th";
    if (suffix.toLowerCase() !== ending) return;
    return calendarDate.safeParse(`${today.slice(0, 7)}-${day.padStart(2, "0")}`).data;
  }
  if (monthEnd.test(phrase)) {
    const first = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
    first.setUTCMonth(first.getUTCMonth() + 1, 0);
    return first.toISOString().slice(0, 10);
  }

  const day = phrase.toLowerCase().replace(/^(?:next|this|ensi)\s+/, "");
  const english = weekdays.indexOf(day);
  const weekday = english >= 0 ? english : finnishWeekdays.findIndex((name) => day.startsWith(name));
  const offset = (weekday - new Date(`${today}T00:00:00Z`).getUTCDay() + 7) % 7;
  return shiftDay(today, offset || (/^(?:next|ensi)\s/i.test(phrase) ? 7 : 0));
}

export function readDeadline(text: string, now: Date): {
  recognized: boolean;
  deadline?: string;
  deadlineDate?: string;
  expectedDate?: string;
  excerpt?: string;
  standalone?: boolean;
} {
  const explicit = text.match(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})\b/i);
  const matches = [...text.matchAll(datePattern)].filter(({ index }) => !/\b(?:at|klo\.?|kello)\s*$/iu.test(text.slice(0, index)));
  if (matches.length !== 1) return { recognized: matches.length > 0 };
  const [match] = matches;
  const today = calendarDateInHelsinki(now);
  const annualDate = readCalendarDate(match[1]);
  const date = annualDate ? resolveCalendarDate(annualDate, today) : calendarDay(match[1], today);
  const prefix = text.slice(0, match.index);
  const after = text.slice(match.index + match[0].length);
  const standalone = !prefix.trim() && /^[\s.!?]*$/u.test(after);
  if (!date || /\b(?:last|previous|either|or|not|after|from|between|jälkeen)\s*$/iu.test(prefix)
    || /^\s*(?:or|tai)\b/iu.test(after)) return { recognized: true, standalone };
  if (explicit) {
    const instant = Date.parse(explicit[0]);
    return instant > now.getTime() ? { recognized: true, deadline: new Date(instant).toISOString(), excerpt: explicit[0], standalone: text.trim() === explicit[0] }
      : { recognized: true, standalone: text.trim() === explicit[0] };
  }

  const time = after.match(timeAfterDate);
  const timeBefore = prefix.match(timeBeforeDate);
  const before = timeBefore && (timeBefore[2] || timeBefore[3] || /\b(?:at|klo|kello)\b/iu.test(timeBefore[0])) ? timeBefore : null;
  const clock = time && (time[2] || time[3] || /\b(?:at|by|before|klo|kello)\b/iu.test(time[0])) ? time : before;
  if (clock) {
    const tail = time === clock ? after.slice(clock[0].length) : after;
    const ambiguousTime = time === clock ? alternativeClockAfter.test(tail) : alternativeClockBefore.test(prefix.slice(0, clock.index));
    if (ambiguousTime) return date >= today
      ? { recognized: true, deadlineDate: date, excerpt: match[0] } : { recognized: true };
    if (/^\s*(?:UTC|GMT|[+-]\d{2}:?\d{2})\b/iu.test(tail)) return { recognized: true };
    const hour = Number(clock[1]);
    const meridiem = clock[3]?.toLowerCase();
    const correctedHour = meridiem ? hour % 12 + (meridiem === "p" ? 12 : 0) : hour;
    let deadline = meridiem && (hour < 1 || hour > 12) ? null : helsinkiInstant(date, correctedHour, clock[2] ?? "00");
    if (deadline && Date.parse(deadline) <= now.getTime() && annualDate && !annualDate.year) {
      const nextDate = resolveCalendarDate(annualDate, shiftDay(date, 1));
      deadline = nextDate ? helsinkiInstant(nextDate, correctedHour, clock[2] ?? "00") : null;
    }
    const excerpt = time === clock ? match[0] + clock[0] : clock[0] + match[0];
    const standaloneClock = time === clock ? !prefix.trim() && /^[\s.!?]*$/u.test(tail)
      : clock.index === 0 && /^[\s.!?]*$/u.test(after);
    return deadline && Date.parse(deadline) > now.getTime() ? { recognized: true, deadline, excerpt, standalone: standaloneClock }
      : { recognized: true, standalone: standaloneClock };
  }
  // A clock outside the supported syntax can still be interpreted by Nemotron.
  if (writtenTime.test(text)) return { recognized: true, expectedDate: date };
  const exclusive = /^(?:before|ennen)\b/iu.test(match[0]);
  const targetDate = exclusive && annualDate && !annualDate.year ? resolveCalendarDate(annualDate, shiftDay(today, 1)) : date;
  const deadlineDate = exclusive && targetDate ? shiftDay(targetDate, -1) : targetDate;
  return deadlineDate && deadlineDate >= today ? { recognized: true, deadlineDate, excerpt: match[0], standalone }
    : { recognized: true, standalone };
}
