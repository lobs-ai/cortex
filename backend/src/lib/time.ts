// TZ-aware formatting helpers. Backend may run in UTC while events belong to
// the user's local TZ (e.g. America/Detroit), so never rely on getHours().

export function hmInTz(date: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const hRaw = parts.find((p) => p.type === "hour")?.value ?? "00";
  const m = parts.find((p) => p.type === "minute")?.value ?? "00";
  // Intl sometimes returns "24" for the midnight hour.
  const h = hRaw === "24" ? "00" : hRaw;
  return `${h}:${m}`;
}

export function ymdInTz(date: Date, tz: string): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { y: parseInt(get("year"), 10), m: parseInt(get("month"), 10), d: parseInt(get("day"), 10) };
}

function tzOffsetMinutes(instant: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (t: string) => parseInt(parts.find((p) => p.type === t)?.value ?? "0", 10);
  const hour = get("hour") === 24 ? 0 : get("hour");
  const asIfUtc = Date.UTC(get("year"), get("month") - 1, get("day"), hour, get("minute"), get("second"));
  return (asIfUtc - +instant) / 60_000;
}

// UTC instant corresponding to local midnight (in tz) of the day `anchor` falls on.
export function startOfDayInTz(anchor: Date, tz: string): Date {
  const { y, m, d } = ymdInTz(anchor, tz);
  const naive = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  const offset = tzOffsetMinutes(naive, tz);
  return new Date(+naive - offset * 60_000);
}

export function endOfDayInTz(anchor: Date, tz: string): Date {
  return new Date(+startOfDayInTz(anchor, tz) + 24 * 60 * 60 * 1000);
}
