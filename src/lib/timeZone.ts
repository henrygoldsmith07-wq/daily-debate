export function normalizeIanaTimeZone(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "UTC";
  const candidate = value.trim();
  try {
    // Construction validates IANA zone support in the current runtime.
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format(new Date(0));
    return candidate;
  } catch {
    return "UTC";
  }
}


export function dateKeyInTimeZone(timeZone: string, date: Date = new Date()): string {
  const zone = normalizeIanaTimeZone(timeZone);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
}
