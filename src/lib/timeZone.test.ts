import { describe, expect, it } from "vitest";
import { normalizeIanaTimeZone } from "./timeZone";

describe("normalizeIanaTimeZone", () => {
  it("keeps valid IANA timezones", () => {
    expect(normalizeIanaTimeZone("Europe/London")).toBe("Europe/London");
    expect(normalizeIanaTimeZone("America/New_York")).toBe("America/New_York");
  });

  it("falls back to UTC for missing or invalid values", () => {
    expect(normalizeIanaTimeZone(null)).toBe("UTC");
    expect(normalizeIanaTimeZone("Not/AZone")).toBe("UTC");
  });
});
