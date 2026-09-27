import { describe, it, expect } from "vitest";
import { DEBATE_MODES, DEBATE_MODE_LIST, resolveMode, checkModeConstraints, isDebateModeId } from "./debateModes";

describe("debateModes", () => {
  it("defines exactly 4 modes", () => {
    expect(DEBATE_MODE_LIST).toHaveLength(4);
    expect(Object.keys(DEBATE_MODES)).toEqual(["text", "speech", "rapid-rebuttal", "prepared-speech"]);
  });

  it("resolves known mode ids", () => {
    expect(resolveMode("speech").id).toBe("speech");
    expect(resolveMode("rapid-rebuttal").id).toBe("rapid-rebuttal");
    expect(resolveMode("prepared-speech").id).toBe("prepared-speech");
    expect(resolveMode(null)).toEqual(DEBATE_MODES.text); // default
  });

  it("falls back to text mode on unknown ids", () => {
    expect(resolveMode("nonexistent").id).toBe("text");
  });

  it("validates mode ids before server-side resolution", () => {
    expect(isDebateModeId("rapid-rebuttal")).toBe(true);
    expect(isDebateModeId("prepared-speech")).toBe(true);
    expect(isDebateModeId("nonexistent")).toBe(false);
    expect(isDebateModeId(null)).toBe(false);
  });

  it("enforces hard time limits only for timed modes", () => {
    expect(DEBATE_MODES.text.hardTimeLimitSecs).toBeNull();
    expect(DEBATE_MODES.speech.hardTimeLimitSecs).toBe(180);
    expect(DEBATE_MODES["rapid-rebuttal"].hardTimeLimitSecs).toBe(60);
    expect(DEBATE_MODES["prepared-speech"].hardTimeLimitSecs).toBe(300);
  });

  it("flags voice-expected modes when timing data is absent", () => {
    const warnings = checkModeConstraints(DEBATE_MODES.speech, 100, null);
    expect(warnings.some((w) => w.includes("voice input"))).toBe(true);
  });

  it("flags typed responses in voice-expected modes even when elapsed timing exists", () => {
    const warnings = checkModeConstraints(DEBATE_MODES["rapid-rebuttal"], 50, 40, "text");
    expect(warnings.some((w) => w.includes("voice input"))).toBe(true);
  });

  it("does not flag voice usage when the response used speech input", () => {
    const warnings = checkModeConstraints(DEBATE_MODES.speech, 100, 60, "voice");
    expect(warnings.some((w) => w.includes("voice input"))).toBe(false);
  });

  it("flags over-limit turns without blocking", () => {
    const warnings = checkModeConstraints(DEBATE_MODES["rapid-rebuttal"], 30, 90);
    expect(warnings.some((w) => w.includes("time limit"))).toBe(true);
  });

  it("records when timed-mode timing is unavailable", () => {
    const warnings = checkModeConstraints(DEBATE_MODES["rapid-rebuttal"], 30, null, "voice");
    expect(warnings.some((w) => w.includes("timing was unavailable"))).toBe(true);
  });

  it("flags under-length responses", () => {
    const warnings = checkModeConstraints(DEBATE_MODES["prepared-speech"], 20, 200);
    expect(warnings.some((w) => w.includes("Short for"))).toBe(true);
  });

  it("returns no warnings for compliant text-mode turns", () => {
    const warnings = checkModeConstraints(DEBATE_MODES.text, 100, null);
    expect(warnings).toHaveLength(0);
  });
});
