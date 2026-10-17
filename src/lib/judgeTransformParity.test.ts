// Port-drift guard: the live benchmark suite and the offline probe library
// must transform transcripts IDENTICALLY, byte for byte.
//
// This exists because the two implementations drifted while the head comment
// in scripts/lib/judge-transforms.mjs claimed "ported 1:1". Four divergences
// were found in the audit:
//
//   1. deflateVerbosity    — offline also strips " arguably"; the live copy
//                            did not (a hedge then a deflate measured
//                            differently across the two sides).
//   2. sophisticateWording — offline rewrites but→however, so→consequently;
//                            the live copy was missing both swaps, so the
//                            live "style-fancy" stability measurement fed the
//                            judge a different transcript than the offline
//                            one claims it does.
//   3. addConfidentTone    — offline appends " This is absolutely certain and
//                            leaves no doubt."; live truncated the suffix.
//   4. swapPrestige        — offline's known-source regex includes
//                            Stanford HAI; without it a fixture citing
//                            Stanford HAI took the fall-back branch live (an
//                            appended citation instead of a prestige
//                            replacement).
//
// Two of these (2, 4) sit inside measured live probes, so the drift directly
// changed live numbers. That is a published-numbers class of problem once
// before (the whitespace erratum). The moral is the same: a port is an
// implementation, not a comment. This file puts the parity into the test
// suite so drift cannot happen silently again.

import { describe, expect, it } from "vitest";
import * as ts from "./judgeInvariance";
import * as live from "../../scripts/lib/judge-transforms.mjs";
import { FIXTURES } from "../../scripts/lib/judge-fixtures.mjs";

// Every shared transform name, mapped to both implementations. The key list
// IS the parity contract: a transform name present in one file but missing
// here fails the coverage test below, so a rename or an added transform must
// update the contract consciously. The left/right framings are separate
// entries because the live AUDIT_TRANSFORMS wire them as separate ids.
const SHARED_TRANSFORMS: Array<[string, (t: string) => string, (t: string) => string]> = [
  ["swapLabels", ts.swapLabels, live.swapLabels],
  ["stripNames", ts.stripNames, live.stripNames],
  ["inflateVerbosity", ts.inflateVerbosity, live.inflateVerbosity],
  ["deflateVerbosity", ts.deflateVerbosity, live.deflateVerbosity],
  ["sophisticateWording", ts.sophisticateWording, live.sophisticateWording],
  ["addConfidenceHedge", ts.addConfidenceHedge, live.addConfidenceHedge],
  ["addConfidentTone", ts.addConfidentTone, live.addConfidentTone],
  ["swapPrestige", ts.swapPrestige, live.swapPrestige],
  ["injectFakeCitation", ts.injectFakeCitation, live.injectFakeCitation],
  ["normalizeWhitespace", ts.normalizeWhitespace, live.normalizeWhitespace],
  ["applyPoliticalTopic", ts.applyPoliticalTopic, live.applyPoliticalTopic],
  [
    "addIdeologicalFraming(left)",
    (t) => ts.addIdeologicalFraming(t, "left"),
    (t) => live.addIdeologicalFraming(t, "left"),
  ],
  [
    "addIdeologicalFraming(right)",
    (t) => ts.addIdeologicalFraming(t, "right"),
    (t) => live.addIdeologicalFraming(t, "right"),
  ],
];

// Representative transcripts beyond the fixture pack: they exercise each
// branch of each transform (known source present vs absent, hedge wording,
// but/so connectives, post-deflation text, multi-line folding, tabs).
const HAND_TRANSCRIPTS: string[] = [
  [
    "Player A: But cheap energy is arguably bad.",
    "Player B: The essay shows needs; so the big claim stands — Nature says otherwise, and Stanford HAI agrees.",
  ].join("\n"),
  "Player A is arguably right. Indeed, this is unequivocally decisive.\nPlayer B is wrong.   Indented\ttail  ",
  "Player B: No known sources here; so cheap? Yes.",
];

function pack(): string[] {
  const transcripts = (FIXTURES as ReadonlyArray<{ id: string; transcript: string }>).map((f) => f.transcript);
  // The pack drives the whole suite; an empty import means the mirror moved —
  // fail loudly instead of vacuously passing byte-equality over zero cases.
  expect(transcripts.length, "judge-fixtures.mjs must provide the fixture pack").toBe(24);
  return [...transcripts, ...HAND_TRANSCRIPTS];
}

function apply(name: string, fn: (t: string) => string, transcript: string): string {
  const out = fn(transcript);
  if (typeof out !== "string") throw new Error(`${name} must return a string (got ${typeof out})`);
  return out;
}

describe("live↔offline judge-transform parity (byte-identical)", () => {
  it("every shared transform produces byte-identical output on the whole pack", () => {
    for (const t of pack()) {
      for (const [name, offline, bootstrapped] of SHARED_TRANSFORMS) {
        expect(apply(name, bootstrapped, t), `${name} diverged on: ${t.slice(0, 60)}…`).toBe(apply(name, offline, t));
      }
    }
  });

  it("each shared transform actually changes at least one transcript", () => {
    // A parity contract over a no-op would also pass byte-equality over a
    // pass-through: this assertion keeps the contract meaningful.
    for (const [name, offline] of SHARED_TRANSFORMS) {
      const changed = pack().filter((t) => apply(name, offline, t) !== t);
      expect(changed.length, `${name} must change at least one transcript`).toBeGreaterThan(0);
    }
  });

  it("the live PROBES wire the same functions the offline library names", () => {
    // The live harness never calls the transforms directly; it calls PROBES
    // entries. Assert each id's wiring so a stale closure cannot hide a
    // divergence from the per-fixture check above.
    const idToFn: Record<string, (t: string) => string> = {
      position: live.swapLabels,
      names: live.stripNames,
      "verbosity-up": live.inflateVerbosity,
      "style-fancy": live.sophisticateWording,
      "confidence-hedge": live.addConfidenceHedge,
      "confident-tone": live.addConfidentTone,
      prestige: live.swapPrestige,
      "fake-citation": live.injectFakeCitation,
      whitespace: live.normalizeWhitespace,
    };
    for (const p of live.PROBES as ReadonlyArray<{ id: string; fn: (t: string) => string }>) {
      const expected = idToFn[p.id];
      expect(expected, `probe ${p.id} has no parity mapping — extend the parity contract`).toBeDefined();
      for (const t of pack()) {
        expect(p.fn(t), `${p.id} probe wiring diverged`).toBe(apply(p.id, expected, t));
      }
    }
  });

  it("audit transforms stay byte-identical too", () => {
    const idToTransform: Record<string, (t: string) => string> = {
      "political-topic": ts.applyPoliticalTopic,
      "ideology-left": (t) => ts.addIdeologicalFraming(t, "left"),
      "ideology-right": (t) => ts.addIdeologicalFraming(t, "right"),
    };
    for (const a of live.AUDIT_TRANSFORMS as ReadonlyArray<{ id: string; fn: (t: string) => string }>) {
      const expected = idToTransform[a.id];
      expect(expected, `audit transform ${a.id} has no parity mapping`).toBeDefined();
      for (const t of pack()) {
        expect(a.fn(t), `${a.id} wiring diverged`).toBe(apply(a.id, expected, t));
      }
    }
  });
});
