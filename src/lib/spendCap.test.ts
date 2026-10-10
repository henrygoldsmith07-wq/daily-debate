import { describe, expect, it } from "vitest";
import {
  SPEND_RESERVATION_FALLBACK_USD,
  SpendCapReachedError,
  __clearSpendReservationsForTests,
  ensureSpendWithinCap,
  estimatedSpendUsd,
  isSpendCapError,
  parseSpendCapConfig,
  reserveSpendCall,
  reservedSpendUsd,
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

describe("in-flight reservations", () => {
  const meter = (reportedUsd: number, uncosted = 0) => async () => ({ reportedUsd, uncostedCalls: uncosted });

  it("starts at zero", () => {
    __clearSpendReservationsForTests();
    expect(reservedSpendUsd()).toBe(0);
  });

  it("adds a reservation's declared charge while it is outstanding", () => {
    __clearSpendReservationsForTests();
    const release = reserveSpendCall(SPEND_RESERVATION_FALLBACK_USD);
    expect(reservedSpendUsd()).toBe(SPEND_RESERVATION_FALLBACK_USD);
    release();
    expect(reservedSpendUsd()).toBe(0);
  });

  it("releases exactly once, even if called repeatedly", () => {
    __clearSpendReservationsForTests();
    reserveSpendCall(0.5)();
    reserveSpendCall(0.5)();
    expect(reservedSpendUsd()).toBe(0);
  });

  it("refuses a burst that would overshoot, which the durable meter alone cannot see", async () => {
    __clearSpendReservationsForTests();
    // $9.97 durable against a $10 cap, so it is still under on its own.
    const readMeter = meter(9.97);
    const env = { AI_DAILY_SPEND_CAP_USD: "10" };

    await expect(ensureSpendWithinCap(env, readMeter)).resolves.toBeUndefined();

    // One call in flight: $9.97 + $0.02 = $9.99 — still under, so it passes.
    const releaseA = reserveSpendCall(0.02);
    await expect(ensureSpendWithinCap(env, readMeter)).resolves.toBeUndefined();

    // Two in flight: $10.01 — over. The durable total has NOT moved, so a
    // meter-only check would still pass this call; the reservation is what
    // stops it.
    const releaseB = reserveSpendCall(0.02);
    await expect(ensureSpendWithinCap(env, readMeter)).rejects.toBeInstanceOf(SpendCapReachedError);

    releaseA();
    releaseB();
  });

  it("lets the same caller through again once reservations settle", async () => {
    __clearSpendReservationsForTests();
    const readMeter = meter(9.98);
    const release = reserveSpendCall(0.02);
    await expect(ensureSpendWithinCap({ AI_DAILY_SPEND_CAP_USD: "10" }, readMeter)).rejects.toBeInstanceOf(
      SpendCapReachedError,
    );
    release();
    await expect(ensureSpendWithinCap({ AI_DAILY_SPEND_CAP_USD: "10" }, readMeter)).resolves.toBeUndefined();
  });

  it("sweeps expired reservations so a crashed caller cannot wedge the cap", () => {
    __clearSpendReservationsForTests();
    const release = reserveSpendCall(5);
    expect(reservedSpendUsd()).toBe(5);
    // A leaked reservation (never released) must stop counting after its TTL.
    // Reading at "now" still sees it; reading past the TTL must not.
    expect(reservedSpendUsd(Date.now())).toBe(5);
    expect(reservedSpendUsd(Date.now() + 10 * 60 * 1000 + 1)).toBe(0);
    release();
  });

  it("does not change behaviour when the cap is disabled", async () => {
    __clearSpendReservationsForTests();
    reserveSpendCall(100)();
    await expect(
      ensureSpendWithinCap({ AI_DAILY_SPEND_CAP_USD: "off" }, meter(9999)),
    ).resolves.toBeUndefined();
    __clearSpendReservationsForTests();
  });
});
