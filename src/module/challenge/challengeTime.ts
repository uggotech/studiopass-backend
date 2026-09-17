/**
 * Challenge wall-clock helpers — same model as channel polls.
 * Admin enters station-country local date + HH:mm; we store exact UTC instants.
 */

/** Convert "YYYY-MM-DD" + "HH:mm" in an IANA timezone to a UTC Date. */
export function zonedDateTimeToUtc(
  dateStr: string,
  timeStr: string,
  timeZone: string,
): Date {
  const datePart = (dateStr || "").slice(0, 10);
  const timePart = normalizeHhMm(timeStr);
  if (!datePart || !/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
    return new Date(dateStr);
  }

  const [yearStr, monthStr, dayStr] = datePart.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const [hourStr, minuteStr] = timePart.split(":");
  const hour = Number(hourStr);
  const minute = Number(minuteStr);

  // Interpret components as if they were UTC, then correct by TZ offset
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const tz = timeZone && timeZone.trim() ? timeZone.trim() : "UTC";

  if (tz === "UTC") {
    return utcGuess;
  }

  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const parts = formatter.formatToParts(utcGuess);
    const getPart = (type: string) =>
      Number(parts.find((p) => p.type === type)?.value || 0);
    let tzHour = getPart("hour");
    if (tzHour === 24) tzHour = 0;
    const tzDateAsUtc = Date.UTC(
      getPart("year"),
      getPart("month") - 1,
      getPart("day"),
      tzHour,
      getPart("minute"),
    );
    const offsetMs = tzDateAsUtc - utcGuess.getTime();
    return new Date(utcGuess.getTime() - offsetMs);
  } catch {
    return utcGuess;
  }
}

export function normalizeHhMm(timeStr?: string | null): string {
  if (!timeStr) return "00:00";
  const trimmed = timeStr.trim();
  const m = /^(\d{1,2}):(\d{2})/.exec(trimmed);
  if (!m) return "00:00";
  const h = Math.min(23, Math.max(0, Number(m[1])));
  const min = Math.min(59, Math.max(0, Number(m[2])));
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/** Calendar date (YYYY-MM-DD) of [date]+[time] in a timezone — for display labels. */
export function calendarDateInTz(dateStr: string, timeStr: string, timeZone: string): Date {
  return zonedDateTimeToUtc(dateStr, timeStr, timeZone);
}
