import { describe, expect, it } from "vitest";
import {
  SKILL_LEDGER_DEBATE_LIMIT,
  resolveLedgerSourceWindow,
} from "./skillLedgerWindow";

describe("resolveLedgerSourceWindow", () => {
  it("uses the loaded count as the lifetime total when the window is not full", () => {
    expect(resolveLedgerSourceWindow(12, null)).toEqual({
      limit: SKILL_LEDGER_DEBATE_LIMIT,
      completedDebatesLoaded: 12,
      totalCompletedDebates: 12,
      truncated: false,
    });
  });

  it("reports when the latest-100 window truncates a longer history", () => {
    expect(resolveLedgerSourceWindow(100, 143)).toEqual({
      limit: 100,
      completedDebatesLoaded: 100,
      totalCompletedDebates: 143,
      truncated: true,
    });
  });

  it("keeps truncation unknown when the cap is full and exact count is unavailable", () => {
    expect(resolveLedgerSourceWindow(100, null)).toEqual({
      limit: 100,
      completedDebatesLoaded: 100,
      totalCompletedDebates: null,
      truncated: null,
    });
  });
});
