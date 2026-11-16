import { describe, expect, it } from "vitest";
import {
  buildLiveGuestMotion,
  emptyGuestLiveState,
  GUEST_LIVE_FALLBACK_RETEST,
  GUEST_LIVE_MAX_TEXT,
  guestLiveDailyCallCap,
  guestLiveHistory,
  guestLiveIpCallCap,
  validateGuestHistory,
} from "./guestLive";
import { assessGuestPractice } from "./guestAssessment";

const reply = "Schools should keep it because focus improves when notifications stop.";

describe("validateGuestHistory", () => {
  it("accepts an empty transcript as an opening request", () => {
    expect(validateGuestHistory(undefined)).toEqual({ ok: true, history: [], userTurns: 0 });
    expect(validateGuestHistory([])).toEqual({ ok: true, history: [], userTurns: 0 });
  });

  it("accepts opponent/user alternation ending on the user, up to three user turns", () => {
    const history = [
      { role: "ai", text: "Opening." },
      { role: "user", text: reply },
      { role: "ai", text: "Second." },
      { role: "user", text: reply },
      { role: "ai", text: "Third." },
      { role: "user", text: reply },
    ];
    const result = validateGuestHistory(history);
    expect(result.ok && result.userTurns).toBe(3);
  });

  it("rejects every other shape", () => {
    expect(validateGuestHistory("nope").ok).toBe(false);
    expect(validateGuestHistory([{ role: "user", text: reply }]).ok).toBe(false);
    expect(validateGuestHistory([{ role: "ai", text: "Opening." }]).ok).toBe(false);
    expect(validateGuestHistory([{ role: "ai", text: "Opening." }, { role: "ai", text: "Again." }]).ok).toBe(false);
    expect(validateGuestHistory([{ role: "ai", text: "Opening." }, { role: "user", text: "too short" }]).ok).toBe(false);
    expect(validateGuestHistory([{ role: "ai", text: "x".repeat(GUEST_LIVE_MAX_TEXT + 1) }, { role: "user", text: reply }]).ok).toBe(false);
    expect(validateGuestHistory(Array.from({ length: 8 }, (_, i) => ({ role: i % 2 ? "user" : "ai", text: reply }))).ok).toBe(false);
  });
});

describe("guestLiveHistory", () => {
  it("interleaves only complete rounds", () => {
    expect(guestLiveHistory(["A0", "A1"], ["U0", "U1"], 1)).toEqual([
      { role: "ai", text: "A0" },
      { role: "user", text: "U0" },
      { role: "ai", text: "A1" },
      { role: "user", text: "U1" },
    ]);
    expect(guestLiveHistory(["A0"], ["U0", "U1"], 1)).toEqual([
      { role: "ai", text: "A0" },
      { role: "user", text: "U0" },
    ]);
  });
});

describe("buildLiveGuestMotion", () => {
  const motion = { title: "Should cities ban cars?", prompt: "Weigh it.", category: "Policy" };

  it("feeds the generated opponent turns to the shared guest screens", () => {
    const state = { ...emptyGuestLiveState(motion), opponents: ["A0", "A1", "A2"], retest: "Fresh objection." };
    const built = buildLiveGuestMotion(state);
    expect(built.motion).toBe(motion.title);
    expect(built.rounds.map((round) => round.opponent)).toEqual(["A0", "A1", "A2"]);
    expect(built.retest.opponent).toBe("Fresh objection.");
    // The existing deterministic assessment runs unchanged on a live motion.
    const assessment = assessGuestPractice([reply, reply, reply], built.rounds.map((round) => round.opponent));
    expect(assessment.weakness.label).toBeTruthy();
  });

  it("uses a motion-independent retest when the generated one never arrived", () => {
    expect(buildLiveGuestMotion(emptyGuestLiveState(motion)).retest.opponent).toBe(GUEST_LIVE_FALLBACK_RETEST);
  });
});

describe("guestLiveDailyCallCap", () => {
  it("defaults, honours a valid override and ignores junk", () => {
    expect(guestLiveDailyCallCap({})).toBe(400);
    expect(guestLiveDailyCallCap({ GUEST_AI_DAILY_CALLS: "50" })).toBe(50);
    expect(guestLiveDailyCallCap({ GUEST_AI_DAILY_CALLS: "0" })).toBe(0);
    expect(guestLiveDailyCallCap({ GUEST_AI_DAILY_CALLS: "lots" })).toBe(400);
    expect(guestLiveIpCallCap({})).toBe(8);
    expect(guestLiveIpCallCap({ GUEST_AI_IP_CALLS: "500" })).toBe(500);
  });
});
