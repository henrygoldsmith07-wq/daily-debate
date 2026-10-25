import { describe, expect, it } from "vitest";
import { compareIsoAsc, toIsoOrNull } from "./isoTimestamp";

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

describe("compareIsoAsc", () => {
  it("orders valid timestamps ascending and puts unparseable ones last, even when mixed", () => {
    const rows = ["2026-10-03T00:00:00Z", "garbage", "2026-10-01T00:00:00Z", "", "2026-10-02T00:00:00Z"];
    expect([...rows].sort(compareIsoAsc)).toEqual([
      "2026-10-01T00:00:00Z",
      "2026-10-02T00:00:00Z",
      "2026-10-03T00:00:00Z",
      "garbage",
      "",
    ]);
  });
});

import { compareIsoDesc as __desc } from "./isoTimestamp";
describe("compareIsoDesc", () => {
  it("sorts newest first with unparseable values last", () => {
    const rows = ["bad", "2026-01-01T00:00:00Z", null, "2026-03-01T00:00:00Z", "2026-02-01T00:00:00Z"];
    expect([...rows].sort(__desc)).toEqual([
      "2026-03-01T00:00:00Z", "2026-02-01T00:00:00Z", "2026-01-01T00:00:00Z", "bad", null,
    ]);
  });
});
