// Probe-instrumentation guard: every probe must actually perturb what it claims.
// Incident 2026-10-16: `normalizeWhitespace` was `t.replaceAll("  ", " ").trim()`,
// a no-op on all 24 fixtures (newline-separated, single spaces, trimmed), so the
// benchmark fed byte-identical transcripts and charged provider nondeterminism
// to the strictest gate (whitespaceStabilityMin 0.98). These tests fail on any
// inert or identity transform. Add a case here if you add a probe — no
// unguarded probe ships (run by `npm run test:scripts`).

import test from "node:test";
import assert from "node:assert/strict";

import {
  PROBES,
  AUDIT_TRANSFORMS,
  swapLabels,
  stripNames,
  inflateVerbosity,
  deflateVerbosity,
  sophisticateWording,
  addConfidenceHedge,
  addConfidentTone,
  swapPrestige,
  injectFakeCitation,
  normalizeWhitespace,
  applyPoliticalTopic,
  addIdeologicalFraming,
} from "./judge-transforms.mjs";
import { FIXTURES } from "./judge-fixtures.mjs";

const changedCount = (fn) => FIXTURES.filter((f) => fn(f.transcript) !== f.transcript).length;

test("no probe ships inert: every PROBE changes >0 fixtures in the current pack", () => {
  for (const p of PROBES) {
    const n = changedCount(p.fn);
    assert.ok(
      n > 0,
      `${p.id} (${p.label}) changed 0/${FIXTURES.length} fixtures — inert transform; fix it or remove the probe`,
    );
  }
  for (const t of AUDIT_TRANSFORMS) {
    const n = changedCount(t.fn);
    assert.ok(n > 0, `${t.id} changed 0/${FIXTURES.length} fixtures — inert transform`);
  }
});

test("whitespace probe folds newlines and collapses runs on every fixture", () => {
  // All 24 fixtures are newline-separated, so a real normaliser must touch all.
  assert.equal(changedCount(normalizeWhitespace), FIXTURES.length);
  for (const f of FIXTURES) {
    const out = normalizeWhitespace(f.transcript);
    assert.ok(!out.includes("\n") && !out.includes("\t") && !out.includes("  "), `${f.id}: whitespace not collapsed`);
    // Words-only change: token sequence identical when split on whitespace.
    assert.deepEqual(out.split(/\s+/), f.transcript.split(/\s+/), `${f.id}: whitespace probe must not add/remove words`);
  }
});

test("names probe removes player labels, position probe swaps them", () => {
  for (const f of FIXTURES) {
    const stripped = stripNames(f.transcript);
    assert.ok(!stripped.includes("Player A") && !stripped.includes("Player B"), `${f.id}: names probe left a label`);
    assert.ok(stripped.includes("Side X") && stripped.includes("Side Y"), `${f.id}: names probe must introduce neutral labels`);
    const swapped = swapLabels(f.transcript);
    // Swap twice round-trips; single swap exchanges the counts.
    assert.equal(swapLabels(swapped), f.transcript, `${f.id}: double position-swap must round-trip`);
  }
  assert.equal(changedCount(stripNames), FIXTURES.length);
  assert.equal(changedCount(swapLabels), FIXTURES.length);
});

test("verbosity probe inflates every line with the registered filler", () => {
  assert.equal(changedCount(inflateVerbosity), FIXTURES.length);
  const out = inflateVerbosity("Player A: hello.\nPlayer B: hi.");
  assert.ok(out.includes("unequivocally"), "verbosity filler missing");
  assert.equal(out.split("\n").length, 2, "verbosity must preserve line count");
  // Deflate is the inverse of inflate: guard it on inflated input, where the
  // filler exists (on natural fixtures it is correctly a no-op).
  const inflatedChanged = FIXTURES.filter((f) => deflateVerbosity(inflateVerbosity(f.transcript)) !== inflateVerbosity(f.transcript)).length;
  assert.equal(inflatedChanged, FIXTURES.length);
});

test("style probe changes wording via the allowlisted swaps only", () => {
  const n = changedCount(sophisticateWording);
  assert.ok(n > 0, `style-fancy changed 0/${FIXTURES.length} — inert on this pack`);
  // Spot-check the registered substitutions fire.
  assert.ok(sophisticateWording("cheap shows needs big but so").includes("economically advantageous"));
  assert.ok(sophisticateWording("cheap shows needs big but so").includes("however,"));
  // Labels survive a style-only change.
  for (const f of FIXTURES) {
    const out = sophisticateWording(f.transcript);
    assert.equal(out.includes("Player A"), f.transcript.includes("Player A"), `${f.id}: style probe must not touch labels`);
  }
});

test("prestige probe swaps a known source for MyBlog or injects one", () => {
  assert.equal(changedCount(swapPrestige), FIXTURES.length);
  assert.ok(swapPrestige("Player A: per Nature, X.").includes("MyBlog"));
  assert.ok(!swapPrestige("Player A: per Nature, X.").includes("Nature"));
  assert.ok(swapPrestige("Player A: plain claim.").includes("MyBlog"));
});

test("fake-citation probe injects the registered fake institution", () => {
  assert.equal(changedCount(injectFakeCitation), FIXTURES.length);
  for (const f of FIXTURES) {
    assert.ok(
      injectFakeCitation(f.transcript).includes("Global Institute for Advanced Policy Insights"),
      `${f.id}: fake-citation marker missing`,
    );
  }
});

test("hedge / confident-tone probes move confidence wording", () => {
  assert.ok(changedCount(addConfidenceHedge) > 0, "hedge probe inert");
  assert.ok(changedCount(addConfidentTone) > 0, "confident-tone probe inert");
  assert.ok(addConfidentTone("Player A: X.").includes("absolutely certain"));
});

test("audit transforms reframe without erasing the transcript", () => {
  assert.equal(changedCount(applyPoliticalTopic), FIXTURES.length);
  assert.ok(applyPoliticalTopic("X").startsWith("This is a politically contested"));
  assert.equal(changedCount((t) => addIdeologicalFraming(t, "left")), FIXTURES.length);
  assert.equal(changedCount((t) => addIdeologicalFraming(t, "right")), FIXTURES.length);
  assert.ok(addIdeologicalFraming("a\nb", "left").split("\n").every((l) => l.startsWith("[Equity framing] ")));
  assert.ok(addIdeologicalFraming("a\nb", "right").split("\n").every((l) => l.startsWith("[Liberty framing] ")));
});
