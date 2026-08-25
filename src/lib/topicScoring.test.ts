import { describe, it, expect } from "vitest";
import {
  scoreTopic,
  pickBestCandidate,
  scoreDebatableBalance,
  scoreNovelty,
  scoreSpecificity,
  scoreIdeologicalLoading,
  scoreAgeAppropriateness,
  type TopicCandidate,
} from "./topicScoring";
import { FALLBACK_TOPICS, pickFallbackExcluding } from "./topicFallbacks";

const good: TopicCandidate = {
  title: "Cities should eliminate minimum parking requirements",
  prompt: "Should urban planning rules stop requiring developers to build parking spaces alongside new housing projects?",
  category: "Policy",
};

const vague: TopicCandidate = {
  title: "The future of things in our society",
  prompt: "How will things change for people in society going forward into the future?",
  category: "General",
};

const loaded: TopicCandidate = {
  title: "Should abortion be banned and gun control expanded?",
  prompt: "Everyone knows these are the most important issues facing America today.",
  category: "Ethics",
};

describe("scoreDebatableBalance", () => {
  it("scores policy-lever topics higher than vague framings", () => {
    expect(scoreDebatableBalance(good)).toBeGreaterThan(scoreDebatableBalance(vague));
  });
  it("penalises one-sided framings", () => {
    expect(scoreDebatableBalance(loaded)).toBeLessThan(scoreDebatableBalance(good));
  });
});

describe("scoreNovelty + recentSimilarity", () => {
  const recent = ["Renewables have become cheaper than fossil fuels"];
  it("gives full novelty to a unique topic", () => {
    expect(scoreNovelty(good, recent)).toBeGreaterThan(7);
  });
  it("gives low novelty to a near-duplicate topic", () => {
    expect(scoreNovelty({ ...good, title: "Renewables have become cheaper than fossil fuels" }, recent)).toBeLessThan(3);
  });
});

describe("scoreSpecificity", () => {
  it("rewards concrete policy language over vague placeholders", () => {
    expect(scoreSpecificity(good)).toBeGreaterThan(scoreSpecificity(vague));
  });
});

describe("scoreIdeologicalLoading", () => {
  it("flags multi-flashpoint topics as heavily loaded", () => {
    expect(scoreIdeologicalLoading(loaded)).toBeLessThan(5);
  });
  it("gives clean topics a high score", () => {
    expect(scoreIdeologicalLoading(good)).toBeGreaterThanOrEqual(9);
  });
});

describe("scoreAgeAppropriateness", () => {
  it("returns 10 for safe general-audience topics", () => {
    expect(scoreAgeAppropriateness(good)).toBe(10);
  });
});

describe("pickBestCandidate", () => {
  it("picks the specific, balanced topic over the vague one", () => {
    const best = pickBestCandidate([vague, good], []);
    expect(best?.candidate.title).toBe(good.title);
  });

  it("avoids heavily loaded topics when a balanced alternative exists", () => {
    const best = pickBestCandidate([loaded, good], []);
    expect(best?.candidate.title).not.toBe(loaded.title);
  });

  it("returns null on empty candidates", () => {
    expect(pickBestCandidate([], [])).toBeNull();
  });

  it("produces notes explaining weaknesses", () => {
    const b = scoreTopic(vague, []);
    expect(b.notes.length).toBeGreaterThan(0);
  });
});

describe("topicFallbacks", () => {
  it("has exactly 30 curated fallbacks", () => {
    expect(FALLBACK_TOPICS).toHaveLength(30);
  });

  it("every fallback has non-empty title, prompt, and category", () => {
    for (const fb of FALLBACK_TOPICS) {
      expect(fb.title.trim().length).toBeGreaterThan(5);
      expect(fb.prompt.trim().length).toBeGreaterThan(10);
      expect(fb.category.trim().length).toBeGreaterThan(2);
    }
  });

  it("no two fallbacks share the same title", () => {
    const titles = new Set(FALLBACK_TOPICS.map((f) => f.title));
    expect(titles.size).toBe(FALLBACK_TOPICS.length);
  });

  it("pickFallbackExcluding skips titles that overlap recent topics", () => {
    // Use the first fallback's own title as "recent" — should skip it
    const first = FALLBACK_TOPICS[0];
    const picked = pickFallbackExcluding("2026-08-24", [first.title]);
    expect(picked.title).not.toBe(first.title);
  });
});
