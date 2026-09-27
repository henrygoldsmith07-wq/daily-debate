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
