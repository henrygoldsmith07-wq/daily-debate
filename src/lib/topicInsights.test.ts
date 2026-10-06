import { describe, expect, it } from "vitest";
import { bestWorstTopics, type TopicDebateResult } from "./topicInsights";

const rows: TopicDebateResult[] = [
  { category: "Science", totalScore: 80 },
  { category: "Science", totalScore: 70 },
  { category: "Science", totalScore: 90 },
  { category: "Politics", totalScore: 55 },
  { category: "Politics", totalScore: 65 },
  { category: "Ethics", totalScore: 75 },
];

describe("bestWorstTopics", () => {
  it("names best and worst only across categories with enough debates", () => {
    const insights = bestWorstTopics(rows);
    expect(insights.best?.category).toBe("Science");
    expect(insights.best?.averageScore).toBe(80);
    expect(insights.best?.debates).toBe(3);
    expect(insights.worst?.category).toBe("Politics");
    expect(insights.worst?.averageScore).toBe(60);
  });

  it("excludes single-debate categories and null scores/categories", () => {
    const insights = bestWorstTopics([
      ...rows,
      { category: "Economics", totalScore: 100 },
      { category: null, totalScore: 99 },
      { category: "Science", totalScore: null },
    ]);
    expect(insights.ranked.map((r) => r.category)).toEqual(["Science", "Politics"]);
    expect(insights.best?.debates).toBe(3); // the null-score row is excluded
  });

  it("does not name a worst when only one category qualifies", () => {
    const insights = bestWorstTopics([
      { category: "Science", totalScore: 80 },
      { category: "Science", totalScore: 70 },
      { category: "Politics", totalScore: 55 },
    ]);
    expect(insights.best?.category).toBe("Science");
    expect(insights.worst).toBeNull();
    expect(insights.note).toMatch(/at least 2 scored debates/);
  });

  it("returns an empty result with a note when nothing qualifies", () => {
    const insights = bestWorstTopics([{ category: "Science", totalScore: 80 }]);
    expect(insights.best).toBeNull();
    expect(insights.worst).toBeNull();
    expect(insights.ranked).toEqual([]);
    expect(insights.note).toBeTruthy();
  });

  it("respects a custom minimum", () => {
    const insights = bestWorstTopics(rows, { minDebates: 3 });
    expect(insights.ranked.map((r) => r.category)).toEqual(["Science"]);
    expect(insights.worst).toBeNull();
  });
});
