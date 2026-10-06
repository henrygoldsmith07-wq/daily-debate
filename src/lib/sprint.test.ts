import { describe, expect, it } from "vitest";
import {
  CROSS_EXAMINATION_ROUNDS,
  FLASH_ROUNDS,
  SOCRATIC_ROUNDS,
  SPRINT_ROUNDS,
  formatEstimateLabel,
  formatLabelFor,
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

describe("targeted practice formats — flash, cross-examination, socratic", () => {
  it("flash is a single round", () => {
    expect(FLASH_ROUNDS).toBe(1);
    expect(minRoundsFor("flash")).toBe(1);
    expect(roundCapFor("flash")).toBe(1);
  });

  it("cross-examination and socratic are fixed four-round formats", () => {
    expect(CROSS_EXAMINATION_ROUNDS).toBe(4);
    expect(SOCRATIC_ROUNDS).toBe(4);
    expect(minRoundsFor("cross-examination")).toBe(4);
    expect(roundCapFor("cross-examination")).toBe(4);
    expect(minRoundsFor("socratic")).toBe(4);
    expect(roundCapFor("socratic")).toBe(4);
  });

  it("narrow formats carry reduced measurement confidence with an explicit note", () => {
    for (const format of ["flash", "cross-examination", "socratic"] as const) {
      const honesty = measurementHonestyFor(format);
      expect(honesty.confidence).toBe("reduced");
      expect(honesty.note).toBeTruthy();
      expect(honesty.format).toBe(format);
    }
  });

  it("resolves the new format ids", () => {
    expect(resolveDebateFormat("flash")).toBe("flash");
    expect(resolveDebateFormat("cross-examination")).toBe("cross-examination");
    expect(resolveDebateFormat("socratic")).toBe("socratic");
  });

  it("labels and estimates mention round counts", () => {
    expect(formatLabelFor("sprint")).toBe("Sprint");
    expect(formatLabelFor("flash")).toBe("Flash");
    expect(formatLabelFor("cross-examination")).toBe("Cross-examination");
    expect(formatLabelFor("socratic")).toBe("Socratic");
    expect(formatLabelFor("full")).toBe("Full Debate");
    expect(formatEstimateLabel("flash")).toMatch(/1 round/);
    expect(formatEstimateLabel("cross-examination")).toMatch(/4 rounds/);
  });
});
