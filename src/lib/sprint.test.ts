import { describe, expect, it } from "vitest";
import {
  SPRINT_ROUNDS,
  measurementHonestyFor,
  minRoundsFor,
  resolveDebateFormat,
  roundCapFor,
} from "./sprint";

describe("sprint format rules", () => {
  it("targets three rounds for sprints", () => {
    expect(SPRINT_ROUNDS).toBe(3);
    expect(minRoundsFor("sprint")).toBe(3);
    expect(roundCapFor("sprint")).toBe(3);
  });

  it("keeps the full-debate 5-round minimum and cap", () => {
    expect(minRoundsFor("full")).toBe(5);
    expect(roundCapFor("full")).toBe(12);
  });

  it("marks sprint results with reduced measurement confidence", () => {
    const honesty = measurementHonestyFor("sprint");
    expect(honesty.confidence).toBe("reduced");
    expect(honesty.note).toMatch(/small sample/i);
  });

  it("keeps full debates at standard confidence with no extra note", () => {
    const honesty = measurementHonestyFor("full");
    expect(honesty.confidence).toBe("standard");
    expect(honesty.note).toBeNull();
  });

  it("treats unknown/missing formats as full", () => {
    expect(resolveDebateFormat("sprint")).toBe("sprint");
    expect(resolveDebateFormat("anything")).toBe("full");
    expect(resolveDebateFormat(undefined)).toBe("full");
    expect(measurementHonestyFor(null).format).toBe("full");
    expect(measurementHonestyFor(null).confidence).toBe("standard");
  });
});
