import { HELSINKI_TIME_ZONE, type Instant } from "./types.js";

const helsinkiCalendar = new Intl.DateTimeFormat("en-CA", {
  timeZone: HELSINKI_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

export function nowUtcIso(at = new Date()): Instant {
  return at.toISOString();
}

/** Normalize +0200-style offsets so Date can parse Valio mock timestamps. */
export function parseInstant(value: string): Date {
  const withColon = value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const date = new Date(withColon);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`unparseable instant: ${value}`);
  }
  return date;
}

export function calendarDateInHelsinki(date: Date): string {
  return helsinkiCalendar.format(date);
}

export function supplierInstant(value: string | null | undefined): Date | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/.test(value)
    || !isCalendarDate(value.slice(0, 10))) return undefined;
  try {
    return parseInstant(value);
  } catch {
    return undefined;
  }
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function supplierCalendarDate(value: string | null | undefined): string | undefined {
  if (typeof value === "string" && isCalendarDate(value)) return value;
  const instant = supplierInstant(value);
  return instant ? calendarDateInHelsinki(instant) : undefined;
}
