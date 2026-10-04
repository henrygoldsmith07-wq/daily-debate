import { describe, expect, it } from "vitest";
import { motionReasonLine, pickPracticeMotion, pickRetestMotion, type MotionCandidate, type MotionContext } from "./topicPersonalisation";

const daily: MotionCandidate = {
  id: "t-daily",
  title: "Should cities ban cars from centres?",
  prompt: "Should urban centres prohibit private cars to cut emissions and noise?",
  category: "Transport",
};

const edu: MotionCandidate = {
  id: "t-edu",
  title: "Should schools teach source verification?",
  prompt: "Would teaching children to fact-check claims reduce misinformation susceptibility?",
  category: "Education",
};

const tech: MotionCandidate = {
  id: "t-tech",
  title: "Should AI content carry disclosure labels?",
  prompt: "Should laws require AI-generated content to carry machine-readable labels?",
  category: "Technology",
};

function ctx(over: Partial<MotionContext> = {}): MotionContext {
  return { daily, alternatives: [daily, edu, tech], recentCategories: [], ...over };
}

describe("pickRetestMotion", () => {
  it("never returns the repaired debate's motion", () => {
    const choice = pickRetestMotion([daily, edu], daily.id, daily.category);
    expect(choice?.motion.id).toBe("t-edu");
    expect(choice?.reason).toMatch(/different topic/i);
  });

  it("prefers a different category for transfer", () => {
    const sameCategory: MotionCandidate = { ...edu, id: "t-edu2", category: "Transport" };
    const choice = pickRetestMotion([sameCategory, edu], daily.id, "Transport");
    expect(choice?.motion.id).toBe("t-edu");
    expect(choice?.reason).toMatch(/transfer/i);
  });

  it("falls back to a different motion in the same category when nothing else exists", () => {
    const sameCategory: MotionCandidate = { ...edu, id: "t-edu2", category: "Transport" };
    const choice = pickRetestMotion([sameCategory], daily.id, "Transport");
    expect(choice?.motion.id).toBe("t-edu2");
  });

  it("returns null when the pool cannot satisfy the different-topic rule", () => {
    expect(pickRetestMotion([daily], daily.id, "Transport")).toBeNull();
  });
});

describe("pickPracticeMotion", () => {
  it("defaults to the shared daily motion for a fresh user", () => {
    const choice = pickPracticeMotion(ctx());
    expect(choice.isDaily).toBe(true);
    expect(choice.motion.id).toBe("t-daily");
  });

  it("keeps the shared motion when it is novel for this user", () => {
    const choice = pickPracticeMotion(ctx({ recentCategories: ["Education", "Technology"] }));
    expect(choice.isDaily).toBe(true);
  });

  it("personalises when the daily category repeats recent debates", () => {
    const choice = pickPracticeMotion(ctx({ recentCategories: ["Transport", "Transport"] }));
    expect(choice.isDaily).toBe(false);
    expect(choice.motion.category).not.toBe("Transport");
    expect(choice.reason).toMatch(/variety/i);
  });

  it("prefers user-selected interests among fresh categories", () => {
    const choice = pickPracticeMotion(
      ctx({ recentCategories: ["Transport"], interests: ["Technology"] }),
    );
    expect(choice.isDaily).toBe(false);
    expect(choice.motion.id).toBe("t-tech");
    expect(choice.reason).toMatch(/interest/i);
  });

  it("is deterministic for the same context", () => {
    const a = pickPracticeMotion(ctx({ recentCategories: ["Transport"] }));
    const b = pickPracticeMotion(ctx({ recentCategories: ["Transport"] }));
    expect(a.motion.id).toBe(b.motion.id);
    expect(a.reason).toBe(b.reason);
  });

  it("never hides that the shared motion exists", () => {
    const choice = pickPracticeMotion(ctx({ recentCategories: ["Transport"] }));
    expect(motionReasonLine(choice, ctx({ recentCategories: ["Transport"] }))).toMatch(/shared motion stays available/i);
  });
});
