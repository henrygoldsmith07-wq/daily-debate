import { describe, expect, it } from "vitest";
import {
  clockLengthLabel,
  formatClock,
  PVP_TURN_GRACE_SECONDS,
  PVP_TURN_SECONDS,
  turnExpired,
  turnMsLeft,
} from "./pvpTurnClock";

const start = "2026-10-27T12:00:00.000Z";
const at = (seconds: number) => Date.parse(start) + seconds * 1000;

describe("pvp turn clock", () => {
  it("counts down from the server stamp and stops at zero", () => {
    expect(turnMsLeft(start, at(0))).toBe(PVP_TURN_SECONDS * 1000);
    expect(turnMsLeft(start, at(PVP_TURN_SECONDS - 5))).toBe(5000);
    expect(turnMsLeft(start, at(PVP_TURN_SECONDS + 60))).toBe(0);
  });

  it("only expires after the deadline plus grace", () => {
    expect(turnExpired(start, at(PVP_TURN_SECONDS))).toBe(false);
    expect(turnExpired(start, at(PVP_TURN_SECONDS + PVP_TURN_GRACE_SECONDS))).toBe(false);
    expect(turnExpired(start, at(PVP_TURN_SECONDS + PVP_TURN_GRACE_SECONDS + 1))).toBe(true);
  });

  it("never expires a turn without a stamp, and reports no time for it", () => {
    expect(turnExpired(null, at(10_000))).toBe(false);
    expect(turnMsLeft(undefined, at(0))).toBeNull();
    expect(turnMsLeft("not a date", at(0))).toBeNull();
  });

  it("formats as m:ss, rounding up so 0:00 means time is really up", () => {
    expect(formatClock(300_000)).toBe("5:00");
    expect(formatClock(65_000)).toBe("1:05");
    expect(formatClock(400)).toBe("0:01");
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(-5)).toBe("0:00");
  });

  it("names its own length for copy", () => {
    expect(clockLengthLabel()).toMatch(/\d+ (minute|minutes|seconds)/);
  });
});
