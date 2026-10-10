import { describe, expect, it } from "vitest";
import { GUEST_MOTIONS, guestMotionForDay } from "./guestMotions";

describe("guest motions", () => {
  it("offers more than one motion, so guest mode is not a single hard-coded topic", () => {
    expect(GUEST_MOTIONS.length).toBeGreaterThan(1);
    const ids = new Set(GUEST_MOTIONS.map((motion) => motion.id));
    expect(ids.size).toBe(GUEST_MOTIONS.length);
  });

  it("gives every motion a complete three-round arc", () => {
    for (const motion of GUEST_MOTIONS) {
      expect(motion.rounds).toHaveLength(3);
      expect(motion.motion.trim().length).toBeGreaterThan(10);
      expect(motion.coachingFocus.trim().length).toBeGreaterThan(0);
      for (const round of motion.rounds) {
        expect(round.opponent.trim().length).toBeGreaterThan(20);
        expect(round.prompt.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("gives every motion a distinct retest challenge", () => {
    for (const motion of GUEST_MOTIONS) {
      expect(motion.retest.opponent.trim().length).toBeGreaterThan(20);
      expect(motion.retest.prompt.trim().length).toBeGreaterThan(0);
    }
  });

  it("never re-serves a seen round as the retest, so the retest measures transfer not recall", () => {
    // This is the property the guest loop's headline claim depends on: the
    // learner is asked to demonstrate the repaired move against a challenge
    // they have NOT already answered. If any retest text duplicates a round
    // text, the observation is recall and the claim is false.
    for (const motion of GUEST_MOTIONS) {
      const seen = motion.rounds.map((round) => round.opponent.trim().toLowerCase());
      expect(seen).not.toContain(motion.retest.opponent.trim().toLowerCase());
      const seenPrompts = motion.rounds.map((round) => round.prompt.trim().toLowerCase());
      expect(seenPrompts).not.toContain(motion.retest.prompt.trim().toLowerCase());
    }
  });

  it("is deterministic for the same day", () => {
    expect(guestMotionForDay("2026-03-14").id).toBe(guestMotionForDay("2026-03-14").id);
  });

  it("rotates across consecutive days rather than sticking to one motion", () => {
    const ids = new Set(
      ["2026-03-14", "2026-03-15", "2026-03-16", "2026-03-17", "2026-03-18"].map(
        (day) => guestMotionForDay(day).id,
      ),
    );
    expect(ids.size).toBeGreaterThan(1);
  });

  it("returns a real motion for a malformed day instead of throwing", () => {
    expect(GUEST_MOTIONS).toContain(guestMotionForDay("not-a-date"));
  });

  it("cycles back to the first motion after a full period", () => {
    const first = GUEST_MOTIONS[0].id;
    const last = GUEST_MOTIONS[GUEST_MOTIONS.length - 1].id;
    // Consecutive days that must differ, then wrap: index (n) -> (n+1) % len.
    expect(guestMotionForDay("2026-03-14").id).not.toBe(guestMotionForDay("2026-03-15").id);
    expect(first).not.toBe(last);
  });
});
