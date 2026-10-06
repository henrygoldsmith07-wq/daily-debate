import { describe, expect, it } from "vitest";
import {
  DEFAULT_DIFFICULTY,
  DEFAULT_PERSONA,
  OPPONENT_DIFFICULTIES,
  OPPONENT_PERSONAS,
  openingDirective,
  resolveDifficulty,
  resolvePersona,
  turnDirective,
} from "./opponentPersona";

describe("opponent persona config", () => {
  it("defines the six adversary personalities plus balanced default", () => {
    expect(Object.keys(OPPONENT_PERSONAS).sort()).toEqual(
      ["balanced", "devils-advocate", "economist", "expert", "lawyer", "philosopher", "skeptic"].sort(),
    );
    for (const persona of Object.values(OPPONENT_PERSONAS)) {
      expect(persona.label).toBeTruthy();
      expect(persona.tagline).toBeTruthy();
    }
    expect(OPPONENT_PERSONAS.balanced.directive).toBe("");
  });

  it("gives every non-balanced persona a distinctive directive", () => {
    for (const [id, persona] of Object.entries(OPPONENT_PERSONAS)) {
      if (id === "balanced") continue;
      expect(persona.directive.length).toBeGreaterThan(40);
    }
  });

  it("defines three difficulty dials with escalating directives", () => {
    expect(Object.keys(OPPONENT_DIFFICULTIES).sort()).toEqual(["challenging", "easy", "expert"].sort());
    expect(OPPONENT_DIFFICULTIES.easy.directive).toMatch(/ONE simple challenge/);
    expect(OPPONENT_DIFFICULTIES.challenging.directive).toMatch(/every turn/);
    expect(OPPONENT_DIFFICULTIES.expert.directive).toMatch(/relentless/i);
  });
});

describe("resolvePersona / resolveDifficulty", () => {
  it("accepts known ids and falls back to defaults on anything else", () => {
    expect(resolvePersona("skeptic")).toBe("skeptic");
    expect(resolvePersona("devils-advocate")).toBe("devils-advocate");
    expect(resolvePersona("hacker")).toBe(DEFAULT_PERSONA);
    expect(resolvePersona(undefined)).toBe(DEFAULT_PERSONA);
    expect(resolvePersona(42)).toBe(DEFAULT_PERSONA);

    expect(resolveDifficulty("easy")).toBe("easy");
    expect(resolveDifficulty("expert")).toBe("expert");
    expect(resolveDifficulty("impossible")).toBe(DEFAULT_DIFFICULTY);
    expect(resolveDifficulty(null)).toBe(DEFAULT_DIFFICULTY);
  });
});

describe("directive composition", () => {
  it("balanced + challenging + sprint composes to the legacy behaviour", () => {
    // The legacy pairing must be representable as an empty persona directive
    // plus only the difficulty line, so existing debates keep their meaning.
    expect(openingDirective("balanced", "challenging", "sprint")).toBe(OPPONENT_DIFFICULTIES.challenging.directive);
    expect(turnDirective("balanced", "challenging", "sprint", false)).toBe(
      OPPONENT_DIFFICULTIES.challenging.directive,
    );
  });

  it("combines persona, difficulty, and format style", () => {
    const directive = openingDirective("lawyer", "expert", "sprint");
    expect(directive).toContain("cross-examining EVIDENCE");
    expect(directive).toContain("EXPERT");
  });

  it("cross-examination forces probing questions instead of speeches", () => {
    expect(turnDirective("balanced", "challenging", "cross-examination", false)).toMatch(
      /must be a probing QUESTION/,
    );
    expect(turnDirective("balanced", "challenging", "cross-examination", true)).toMatch(/final round/i);
    expect(openingDirective("balanced", "challenging", "cross-examination")).toMatch(/ONE probing question/);
  });

  it("socratic forbids the opponent from arguing its own case", () => {
    expect(turnDirective("balanced", "challenging", "socratic", false)).toMatch(/never state your own thesis/i);
    expect(openingDirective("balanced", "challenging", "socratic")).toMatch(/questions only/i);
  });

  it("flash is a single-round format on both opening and turn", () => {
    expect(openingDirective("balanced", "challenging", "flash")).toMatch(/single round/);
    expect(turnDirective("balanced", "challenging", "flash", true)).toMatch(/only round/);
  });
});
