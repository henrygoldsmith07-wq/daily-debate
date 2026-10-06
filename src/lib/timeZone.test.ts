import { describe, expect, it } from "vitest";
import { dateKeyInTimeZone, normalizeIanaTimeZone } from "./timeZone";

describe("timeZone helpers", () => {
  it("keeps valid IANA timezones", () => {
    expect(normalizeIanaTimeZone("Europe/London")).toBe("Europe/London");
    expect(normalizeIanaTimeZone("America/New_York")).toBe("America/New_York");
  });

  it("falls back to UTC for missing or invalid values", () => {
    expect(normalizeIanaTimeZone(null)).toBe("UTC");
    expect(normalizeIanaTimeZone("Not/AZone")).toBe("UTC");
  });

  it("derives a stable YYYY-MM-DD key in the requested timezone", () => {
    const instant = new Date("2026-09-27T23:30:00Z");
    expect(dateKeyInTimeZone("Europe/London", instant)).toBe("2026-09-28");
    expect(dateKeyInTimeZone("America/New_York", instant)).toBe("2026-09-27");
  });
});
