import { afterEach, describe, expect, it } from "vitest";
import { isNeonHttpUrl, normalizeNumerics, NUMERIC_COLUMNS, sqlstateClass } from "./sql";

/**
 * Pure, offline unit tests for the dual-transport SQL access surface.
 *
 * `normalizeNumerics` and `sqlstateClass` are used by every health surface and
 * every DB-backed route, but their only prior coverage lived inside
 * `*.db.test.ts` suites that auto-skip without a real Postgres — the contracts
 * were effectively unenforced. Everything here is pure: no DATABASE_URL, no
 * executor, no network.
 */

describe("normalizeNumerics", () => {
  it("coerces numeric-typed strings (node-postgres NUMERIC) to numbers", () => {
    expect(normalizeNumerics({ before_score: "85" }).before_score).toBe(85);
    expect(normalizeNumerics({ confidence: "0.75" }).confidence).toBe(0.75);
    expect(normalizeNumerics({ movement: "-4.5" }).movement).toBe(-4.5);
  });

  it("leaves genuine numbers, empty strings, and non-numeric strings untouched", () => {
    expect(normalizeNumerics({ before_score: 85 }).before_score).toBe(85);
    // An empty string is not a number: coercing it to 0 would fabricate data.
    expect(normalizeNumerics({ before_score: "" }).before_score).toBe("");
    expect(normalizeNumerics({ before_score: "  " }).before_score).toBe("  ");
    expect(normalizeNumerics({ confidence: "abc" }).confidence).toBe("abc");
  });

  it("does not touch columns outside the declared numeric set", () => {
    // A string that only LOOKS numeric must survive on a non-numeric column.
    expect(normalizeNumerics({ topic_date: "20261027" }).topic_date).toBe("20261027");
    expect(normalizeNumerics({ winner: "a" }).winner).toBe("a");
  });

  it("returns the same row object and preserves every other field", () => {
    const row = { id: "r1", attempt_score: "70", winner: "a" };
    expect(normalizeNumerics(row)).toBe(row);
    expect(row.id).toBe("r1");
    expect(row.winner).toBe("a");
    expect(row.attempt_score).toBe(70);
  });

  it("covers every declared numeric column", () => {
    for (const column of NUMERIC_COLUMNS) {
      expect(normalizeNumerics({ [column]: "1.25" })[column]).toBe(1.25);
    }
  });
});

describe("sqlstateClass", () => {
  it("extracts the two-character class from a transport error code", () => {
    expect(sqlstateClass({ code: "42P01" })).toBe("42"); // undefined table
    expect(sqlstateClass({ code: "23505" })).toBe("23"); // unique violation
    expect(sqlstateClass({ code: "08006" })).toBe("08"); // connection failure
    expect(sqlstateClass({ code: "42501" })).toBe("42"); // insufficient privilege
  });

  it("walks the cause chain (Neon nests the SQLSTATE on cause)", () => {
    const cause = { code: "28P01" }; // invalid password
    expect(sqlstateClass({ message: "failed", cause })).toBe("28");
  });

  it("prefers the outermost valid code and stops at cycles", () => {
    expect(sqlstateClass({ code: "23505", cause: { code: "08006" } })).toBe("23");
    const cyclic: { code?: unknown; cause?: unknown } = { code: "X" };
    cyclic.cause = cyclic;
    expect(sqlstateClass(cyclic)).toBeNull();
  });

  it("returns null for non-codes, missing fields, and non-object input", () => {
    // Anything that is not a 5-char standard code is NOT a public diagnostic.
    expect(sqlstateClass({ code: "42" })).toBeNull();
    expect(sqlstateClass({ code: "not-a-state" })).toBeNull();
    expect(sqlstateClass({ code: 42501 })).toBeNull();
    expect(sqlstateClass({ message: "permission denied" })).toBeNull();
    expect(sqlstateClass(null)).toBeNull();
    expect(sqlstateClass("boom")).toBeNull();
    expect(sqlstateClass(undefined)).toBeNull();
  });
});

describe("isNeonHttpUrl", () => {
  const originalDriver = process.env.DATABASE_DRIVER;

  afterEach(() => {
    if (originalDriver === undefined) delete process.env.DATABASE_DRIVER;
    else process.env.DATABASE_DRIVER = originalDriver;
  });

  it("detects every Neon host shape", () => {
    expect(isNeonHttpUrl("postgresql://u:p@ep-cool-name-123456.eu-central-1.aws.neon.tech/db")).toBe(true);
    expect(isNeonHttpUrl("postgresql://u:p@ep-cool-name.neon.build/db")).toBe(true);
    expect(isNeonHttpUrl("postgresql://u:p@ep-cool-name.neon.new/db")).toBe(true);
    expect(isNeonHttpUrl("postgresql://u:p@db.neon.databases.example.com/db")).toBe(true);
    // Local override host used by tests/dev.
    expect(isNeonHttpUrl("postgresql://u:p@ep-cool-name.neon.local/db")).toBe(true);
  });

  it("treats plain postgres URLs as TCP transport", () => {
    expect(isNeonHttpUrl("postgresql://u:p@localhost:5432/daily_debate")).toBe(false);
    expect(isNeonHttpUrl("postgresql://u:p@db.internal:5432/app")).toBe(false);
    // A Neon substring away from a real Neon host does not switch transport.
    expect(isNeonHttpUrl("postgresql://u:p@notneon.tech/db")).toBe(false);
  });

  it("honours the explicit DATABASE_DRIVER=neon-http override", () => {
    process.env.DATABASE_DRIVER = "neon-http";
    expect(isNeonHttpUrl("postgresql://u:p@localhost:5432/daily_debate")).toBe(true);
    process.env.DATABASE_DRIVER = "tcp";
    expect(isNeonHttpUrl("postgresql://u:p@localhost:5432/daily_debate")).toBe(false);
  });
});
