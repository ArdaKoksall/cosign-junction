const dateTime = {
  en: new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Helsinki", dateStyle: "medium", timeStyle: "short" }),
  fi: new Intl.DateTimeFormat("fi-FI", { timeZone: "Europe/Helsinki", dateStyle: "medium", timeStyle: "short" }),
};
const inputDateTime = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Helsinki", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
const calendarDay = {
  en: new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", dateStyle: "full" }),
  fi: new Intl.DateTimeFormat("fi-FI", { timeZone: "UTC", dateStyle: "full" }),
};

export function formatCalendarDay(date: string, locale: "en" | "fi" = "en") {
  return calendarDay[locale].format(new Date(`${date}T00:00:00Z`));
}

export function helsinkiDateTime(instant: Date | number) {
  return inputDateTime.format(instant).replace(" ", "T");
}

export function parseHelsinkiDateTime(date: string, time: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return;
  const local = `${date}T${time}`;
  const naive = Date.parse(`${local}Z`);
  if (!Number.isFinite(naive)) return;

  // A clock change may give this time two possible offsets or no valid instant.
  const day = 86_400_000;
  const candidates = new Set([naive - day, naive + day].map((sample) => {
    const offset = Date.parse(`${helsinkiDateTime(sample)}Z`) - sample;
    return naive - offset;
  }));
  const matching = [...candidates].filter((candidate) => helsinkiDateTime(candidate) === local);
  if (matching.length === 1) return new Date(matching[0]).toISOString();
}

export function formatHelsinkiTime(value: string, locale: "en" | "fi" = "en") {
  const instant = new Date(value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  return Number.isFinite(instant.getTime()) ? `${dateTime[locale].format(instant)} Helsinki` : locale === "fi" ? "Tuntematon" : "Unknown";
}
