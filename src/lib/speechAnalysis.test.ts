import { describe, it, expect } from "vitest";
import {
  analyseSpeechTurn,
  scoreSpeechQuality,
  rebuttalImmediacy,
} from "./speechAnalysis";

const TIMING = { startedAt: "2026-01-01T00:00:00Z", endedAt: "2026-01-01T00:01:00Z", durationSeconds: 60 };

describe("analyseSpeechTurn", () => {
  it("computes pace for a normal-length response", () => {
    const text = Array.from({ length: 120 }, (_, i) => `word${i}`).join(" ");
    const r = analyseSpeechTurn(text, TIMING);
    expect(r.paceWpm).toBe(120); // 120 words in 60 seconds = 120 wpm
    expect(r.wordCount).toBe(120);
  });

  it("returns null pace for very short recordings (<5s)", () => {
    const r = analyseSpeechTurn("Quick point.", { ...TIMING, durationSeconds: 3 });
    expect(r.paceWpm).toBeNull();
  });

  it("counts filler words and computes density", () => {
    const text = "Um so basically the thing is that like you know people uh don't really think about it.";
    const r = analyseSpeechTurn(text, { ...TIMING, durationSeconds: 30 });
    expect(r.fillerCount).toBeGreaterThan(3);
    expect(r.fillerDensity).toBeGreaterThan(10);
  });

  it("detects structural signposting", () => {
    const text = "First, let me address the economic argument. Furthermore, the social impact matters. In conclusion, both dimensions support my case.";
    const r = analyseSpeechTurn(text, { ...TIMING, durationSeconds: 45 });
    expect(r.structureDensity).toBeGreaterThan(2);
  });

  it("detects contrastive (rebuttal) moves", () => {
    const r1 = analyseSpeechTurn("However, that argument ignores the data.", TIMING);
    expect(r1.hasContrastiveMove).toBe(true);
    const r2 = analyseSpeechTurn("I agree completely with everything said.", TIMING);
    expect(r2.hasContrastiveMove).toBe(false);
  });

  it("measures repetition against previous turn", () => {
    const prev = "The evidence shows that solar energy costs have declined significantly over the past decade.";
    const repetitive = "The evidence shows that solar energy costs have declined significantly over the past decade.";
    const fresh = "Infrastructure investment requires a different policy framework entirely.";
    const rRep = analyseSpeechTurn(repetitive, TIMING, prev);
    const rFresh = analyseSpeechTurn(fresh, TIMING, prev);
    expect(rRep.repetitionScore!).toBeGreaterThan(0.7);
    expect(rFresh.repetitionScore!).toBeLessThan(0.2);
  });

  it("handles empty text without crashing", () => {
    const r = analyseSpeechTurn("", TIMING);
    expect(r.wordCount).toBe(0);
    expect(r.paceWpm).toBe(0);
    expect(r.fillerDensity).toBe(0);
  });
});

describe("scoreSpeechQuality", () => {
  it("scores ideal debate speech highly", () => {
    const text = Array.from({ length: 140 }, (_, i) => `point${i}`).join(" ") +
      " First, however, let me address their core claim. Therefore, the conclusion follows.";
    const analysis = analyseSpeechTurn(text, TIMING);
    const s = scoreSpeechQuality(analysis);
    expect(s.overall).toBeGreaterThan(50);
  });

  it("penalises heavy filler usage", () => {
    const text = Array.from({ length: 50 }, () => "um").join(" ") + " actually like you know basically literally";
    const analysis = analyseSpeechTurn(text, TIMING);
    const s = scoreSpeechQuality(analysis);
    expect(s.breakdown.fillerScore).toBeLessThan(20);
  });

  it("penalises high repetition", () => {
    const prev = "Solar costs have dropped dramatically according to Lazard's latest analysis of energy markets worldwide.";
    const repText = "Solar costs have dropped dramatically according to Lazard's latest analysis showing energy markets shifting toward renewables worldwide.";
    const analysis = analyseSpeechTurn(repText, TIMING, prev);
    const s = scoreSpeechQuality(analysis);
    expect(s.breakdown.repetitionPenalty).toBeGreaterThan(0);
  });

  it("gives contrastive bonus when rebutting", () => {
    const withRebuttal = analyseSpeechTurn("However, the opposing argument fails on three grounds. " + "word ".repeat(80), TIMING);
    const withoutRebuttal = analyseSpeechTurn("The main arguments are as follows. " + "word ".repeat(80), TIMING);
    const sR = scoreSpeechQuality(withRebuttal);
    const sN = scoreSpeechQuality(withoutRebuttal);
    expect(sR.breakdown.contrastiveBonus).toBe(10);
    expect(sN.breakdown.contrastiveBonus).toBe(0);
  });

  it("never goes below zero or above hundred", () => {
    const extreme = analyseSpeechTurn("", TIMING);
    const s = scoreSpeechQuality(extreme);
    expect(s.overall).toBeGreaterThanOrEqual(0);
    expect(s.overall).toBeLessThanOrEqual(100);
  });
});

describe("rebuttalImmediacy", () => {
  it("measures seconds between opponent end and user start", () => {
    expect(rebuttalImmediacy("2026-01-01T00:01:00Z", "2026-01-01T00:01:05Z")).toBe(5);
  });

  it("clamps to zero when user starts before opponent ends", () => {
    expect(rebuttalImmediacy("2026-01-01T00:01:10Z", "2026-01-01T00:01:05Z")).toBe(0);
  });

  it("returns null on invalid timestamps", () => {
    expect(rebuttalImmediacy("not-a-date", "2026-01-01T00:01:05Z")).toBeNull();
  });
});
