import { describe, expect, it } from "vitest";
import {
  SpendCapReachedError,
  ensureSpendWithinCap,
  estimatedSpendUsd,
  isSpendCapError,
  parseSpendCapConfig,
  retryAfterSecondsToReset,
  spendCapMessage,
} from "./spendCap";

describe("parseSpendCapConfig", () => {
  it("defaults to a $10 daily cap and a declared $0.02 uncosted-call charge", () => {
    expect(parseSpendCapConfig({})).toEqual({ capUsd: 10, uncostedCallUsd: 0.02 });
  });

  it('accepts "off" (any case) as an explicit disable', () => {
    expect(parseSpendCapConfig({ AI_DAILY_SPEND_CAP_USD: "off" }).capUsd).toBeNull();
    expect(parseSpendCapConfig({ AI_DAILY_SPEND_CAP_USD: "OFF" }).capUsd).toBeNull();
    expect(parseSpendCapConfig({ AI_DAILY_SPEND_CAP_USD: "disabled" }).capUsd).toBeNull();
  });

  it("accepts numeric caps, including 0 (block every paid call)", () => {
    expect(parseSpendCapConfig({ AI_DAILY_SPEND_CAP_USD: "25.5" }).capUsd).toBe(25.5);
    expect(parseSpendCapConfig({ AI_DAILY_SPEND_CAP_USD: "0" }).capUsd).toBe(0);
  });

  it("falls back to the default on a nonsense cap rather than disabling the guard", () => {
    expect(parseSpendCapConfig({ AI_DAILY_SPEND_CAP_USD: "lots" }).capUsd).toBe(10);
    expect(parseSpendCapConfig({ AI_DAILY_SPEND_CAP_USD: "-3" }).capUsd).toBe(10);
  });

  it("tunes the uncosted-call assumption and rejects nonsense there too", () => {
    expect(parseSpendCapConfig({ AI_SPEND_UNCOSTED_CALL_USD: "0.5" }).uncostedCallUsd).toBe(0.5);
    expect(parseSpendCapConfig({ AI_SPEND_UNCOSTED_CALL_USD: "cheap" }).uncostedCallUsd).toBe(0.02);
  });
});

describe("estimatedSpendUsd", () => {
  it("sums provider-reported cost with the declared charge for uncosted calls", () => {
    expect(estimatedSpendUsd({ reportedUsd: 1.25, uncostedCalls: 10 }, 0.02)).toBeCloseTo(1.45, 6);
    expect(estimatedSpendUsd({ reportedUsd: 0, uncostedCalls: 0 }, 0.02)).toBe(0);
  });

  it("never produces NaN from malformed meter rows", () => {
    expect(estimatedSpendUsd({ reportedUsd: Number.NaN, uncostedCalls: Number.NaN }, 0.02)).toBe(0);
  });
});

describe("retryAfterSecondsToReset", () => {
  it("always returns a bounded, positive delay to the next UTC midnight", () => {
    const now = new Date("2026-10-06T23:59:59.000Z");
    const retryAfter = retryAfterSecondsToReset(now);
    expect(retryAfter).toBeGreaterThanOrEqual(60);
    expect(retryAfter).toBeLessThanOrEqual(86_400);
    const morning = retryAfterSecondsToReset(new Date("2026-10-06T00:00:01.000Z"));
    expect(morning).toBeGreaterThan(80_000);
  });
});

describe("ensureSpendWithinCap", () => {
  const meter = (reportedUsd: number, uncostedCalls: number) => async () => ({ reportedUsd, uncostedCalls });

  it("passes when today's spend is below the cap", async () => {
    await expect(
      ensureSpendWithinCap({ AI_DAILY_SPEND_CAP_USD: "10" }, meter(5, 10)),
    ).resolves.toBeUndefined();
  });

  it("throws SpendCapReachedError once reported + assumed spend reaches the cap", async () => {
    await expect(
      ensureSpendWithinCap({ AI_DAILY_SPEND_CAP_USD: "10" }, meter(10, 0)),
    ).rejects.toBeInstanceOf(SpendCapReachedError);
    // Uncosted calls count at the declared assumption — provider-silent calls
    // must never let the meter read $0 and pass silently.
    await expect(
      ensureSpendWithinCap({ AI_DAILY_SPEND_CAP_USD: "0.1" }, meter(0, 6)),
    ).rejects.toBeInstanceOf(SpendCapReachedError);
  });

  it("blocks every call when the cap is 0", async () => {
    await expect(
      ensureSpendWithinCap({ AI_DAILY_SPEND_CAP_USD: "0" }, meter(0, 0)),
    ).rejects.toBeInstanceOf(SpendCapReachedError);
  });

  it("never consults the meter when the cap is off", async () => {
    let called = false;
    await expect(
      ensureSpendWithinCap({ AI_DAILY_SPEND_CAP_USD: "off" }, async () => {
        called = true;
        return { reportedUsd: 999, uncostedCalls: 999 };
      }),
    ).resolves.toBeUndefined();
    expect(called).toBe(false);
  });

  it("fails OPEN with the call allowed when the meter cannot be read", async () => {
    await expect(
      ensureSpendWithinCap({ AI_DAILY_SPEND_CAP_USD: "10" }, async () => {
        throw new Error("ai_call_log unreachable");
      }),
    ).resolves.toBeUndefined();
  });

  it("skips the database entirely under NODE_ENV=test unless a meter is injected", async () => {
    expect(process.env.NODE_ENV).toBe("test");
    await expect(ensureSpendWithinCap({ NODE_ENV: "test", AI_DAILY_SPEND_CAP_USD: "0" })).resolves.toBeUndefined();
  });
});

describe("error surface", () => {
  it("spendCapMessage states the amount, the cap and the reset", () => {
    const message = spendCapMessage(10, 10);
    expect(message).toContain("Daily AI limit reached");
    expect(message).toContain("$10.00");
    expect(message).toContain("daily reset");
  });

  it("isSpendCapError recognises the error across module instances by name too", () => {
    expect(isSpendCapError(new SpendCapReachedError("x"))).toBe(true);
    const foreign = Object.assign(new Error("x"), { name: "SpendCapReachedError" });
    expect(isSpendCapError(foreign)).toBe(true);
    expect(isSpendCapError(new Error("other"))).toBe(false);
    expect(isSpendCapError(null)).toBe(false);
  });
});
