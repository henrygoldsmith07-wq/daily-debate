import { describe, expect, it } from "vitest";
import { FALLBACK_TOPICS, pickFallback, pickFallbackExcluding } from "./topicFallbacks";

describe("curated fallback bank", () => {
  it("holds at least 90 motions so a degraded pipeline rotates for a full quarter without repeats", () => {
    expect(FALLBACK_TOPICS.length).toBeGreaterThanOrEqual(90);
  });

  it("keeps every title, prompt and category non-empty and bounded", () => {
    for (const topic of FALLBACK_TOPICS) {
      expect(topic.title.trim().length).toBeGreaterThan(0);
      expect(topic.prompt.trim().length).toBeGreaterThan(0);
      expect(topic.category.trim().length).toBeGreaterThan(0);
      expect(topic.title.length).toBeLessThanOrEqual(200);
      expect(topic.prompt.length).toBeLessThanOrEqual(300);
    }
  });

  it("keeps titles unique — a duplicate would make the date rotation collide", () => {
    const titles = new Set(FALLBACK_TOPICS.map((t) => t.title.toLowerCase()));
    expect(titles.size).toBe(FALLBACK_TOPICS.length);
  });

  it("picks deterministically by date and skips recently served topics", () => {
    expect(pickFallback("2026-10-06")).toEqual(pickFallback("2026-10-06"));
    const recent = [pickFallback("2026-10-06").title];
    const next = pickFallbackExcluding("2026-10-06", recent);
    expect(next.title).not.toEqual(recent[0]);
    // With the whole bank excluded the rotation still returns something.
    const all = pickFallbackExcluding("2026-10-06", FALLBACK_TOPICS.map((t) => t.title));
    expect(FALLBACK_TOPICS).toContainEqual(all);
  });
});
