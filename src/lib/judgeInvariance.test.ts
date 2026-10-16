import { describe, it, expect } from "vitest";
import {
  BIAS_PROBES,
  mockWinner,
  normalizeWhitespace,
  runProbeOffline,
  splitTranscriptClauses,
  swapLabels,
  stripNames,
  inflateVerbosity,
} from "./judgeInvariance";
import { TRANSCRIPTS } from "./benchmark.fixtures";

const texts = TRANSCRIPTS.map((t) => t.transcript);

describe("judgeInvariance instrumentation guard (erratum 2026-10-16)", () => {
  it("whitespace probe is not inert: it changes every fixture and preserves words", () => {
    for (const t of texts) {
      const out = normalizeWhitespace(t);
      expect(out).not.toBe(t);
      expect(out).not.toMatch(/\s{2,}|\n|\t/);
      // Words-only change: token sequence identical when split on whitespace.
      expect(out.split(/\s+/)).toEqual(t.split(/\s+/));
    }
  });

  it("mockWinner is layout-insensitive: whitespace folding never flips the mock", () => {
    for (const t of texts) {
      expect(mockWinner(normalizeWhitespace(t))).toBe(mockWinner(t));
    }
    const report = runProbeOffline(
      texts,
      // biome-ignore lint: probe lookup is the point — the whitespace entry must exist
      BIAS_PROBES.find((p) => p.id === "whitespace")!,
      mockWinner,
    );
    expect(report.flips).toBe(0);
  });

  it("clause splitter matches line splitting on the original newline pack", () => {
    // The splitter fix must not change mock behaviour on un-folded input:
    // every original line starts with a speaker marker, so one clause per line.
    for (const t of texts) {
      const lines = t.split("\n").map((s) => s.trim()).filter(Boolean);
      const clauses = splitTranscriptClauses(t);
      expect(clauses.length).toBe(lines.length);
    }
  });

  it("no offline probe ships inert on the current fixture set", () => {
    for (const p of BIAS_PROBES) {
      if (p.id === "verbosity-simple") {
        // Deflate is the inverse of inflate: its input domain is inflated text,
        // not natural fixtures. Guard it on inflated input instead of demanding
        // it perturb natural debates (where the filler is absent by design).
        const changed = texts.filter((t) => p.transform(inflateVerbosity(t)) !== inflateVerbosity(t)).length;
        expect(changed).toBeGreaterThan(0);
        continue;
      }
      const changed = texts.filter((t) => p.transform(t) !== t).length;
      expect(changed).toBeGreaterThan(0);
    }
  });

  it("name/position/verbosity probes do what their labels claim", () => {
    const t = texts[0];
    expect(stripNames(t)).not.toContain("Player A");
    expect(swapLabels(swapLabels(t))).toBe(t);
    expect(inflateVerbosity(t)).toContain("unequivocally");
  });
});
