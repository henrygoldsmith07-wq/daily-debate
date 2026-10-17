import { describe, it, expect } from "vitest";
import {
  BIAS_PROBES,
  inflateVerbosity,
  normalizeWhitespace,
  runProbeOffline,
  stripNames,
  swapLabels,
} from "./judgeInvariance";
import { TRANSCRIPTS } from "./benchmark.fixtures";

const texts = TRANSCRIPTS.map((t) => t.transcript);

// Src-side companion to scripts/lib/judge-transforms.test.mjs (which guards
// the live 24-fixture pack). This guards the TS surface instead: the
// BIAS_PROBES transforms and the offline mock over the src fixture set.
// Uses public API only — the mock itself stays private; its
// layout-insensitivity is asserted end-to-end through runProbeOffline.
// See docs/judge-experiments/errata.md (2026-10-16): an inert whitespace
// probe once fed byte-identical transcripts while reporting "normalised".
describe("judgeInvariance src-side instrumentation guard", () => {
  it("whitespace normalisation reflows every transcript without altering words", () => {
    for (const t of texts) {
      const out = normalizeWhitespace(t);
      expect(out).not.toBe(t);
      expect(out).not.toMatch(/\n|\t| {2,}/);
      expect(out.split(/\s+/)).toEqual(t.split(/\s+/));
    }
  });

  it("the offline mock is layout-insensitive: whitespace folding flips nothing", () => {
    const whitespace = BIAS_PROBES.find((p) => p.id === "whitespace");
    expect(whitespace).toBeDefined();
    // Default runner is the private mock: 0 flips proves the mock attributes
    // per clause (speaker markers), not per physical line. A line-split mock
    // would credit a folded single line to one owner and flip here.
    const report = runProbeOffline(texts, whitespace!);
    expect(report.flips).toBe(0);
  });

  it("no offline probe ships inert on the src fixture set", () => {
    for (const p of BIAS_PROBES) {
      if (p.id === "verbosity-simple") {
        // Deflate is the inverse of inflate: its input domain is inflated
        // text, where the filler exists — on natural fixtures it is correctly
        // a no-op, so guard it on inflated input instead.
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
