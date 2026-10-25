import { describe, expect, it } from "vitest";
import { toIsoOrNull } from "./isoTimestamp";

describe("toIsoOrNull", () => {
  it("converts valid Dates and keeps parseable strings", () => {
    expect(toIsoOrNull(new Date("2026-10-01T10:00:00Z"))).toBe("2026-10-01T10:00:00.000Z");
    expect(toIsoOrNull("2026-10-01T10:00:00Z")).toBe("2026-10-01T10:00:00Z");
  });
  it("never invents a timestamp for missing or invalid input", () => {
    expect(toIsoOrNull(null)).toBeNull();
    expect(toIsoOrNull(undefined)).toBeNull();
    expect(toIsoOrNull("")).toBeNull();
    expect(toIsoOrNull("not a date")).toBeNull();
    expect(toIsoOrNull(new Date("nope"))).toBeNull();
    expect(toIsoOrNull(42)).toBeNull();
  });
});
