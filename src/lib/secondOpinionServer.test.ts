import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { opinionsFromCoaching } from "./secondOpinionServer";
import { summariseSecondOpinions, SECOND_OPINION_MIN_SAMPLE } from "./repairSecondOpinion";

describe("second opinion analytics", () => {
  it("extracts only debates with a stored opinion", () => {
    const o = opinionsFromCoaching([
      { coaching: { retestOutcome: { secondOpinion: { restatesOriginal: true } } } },
      { coaching: { retestOutcome: { secondOpinion: null } } },
      { coaching: null },
    ]);
    expect(o).toEqual([{ repairReused: false, restatesOriginal: true }]);
  });
  it("buckets and gates by sample size", () => {
    const s = summariseSecondOpinions([{ restatesOriginal: true }, { repairReused: false }, { repairReused: true }]);
    expect(s).toMatchObject({ total: 3, restated: 1, notReused: 1, reusedButMissed: 1, insufficient: true });
    const big = summariseSecondOpinions(Array.from({ length: SECOND_OPINION_MIN_SAMPLE }, () => ({ repairReused: true })));
    expect(big.insufficient).toBe(false);
  });
});
