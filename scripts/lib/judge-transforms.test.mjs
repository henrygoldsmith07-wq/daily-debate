// Guard: every invariance probe must actually perturb the fixture pack.
//
// This exists because `whitespace` was silently inert for the pack's entire
// life. It was `t.replaceAll("  ", " ").trim()`, and no fixture transcript
// contains a double space or surrounding whitespace, so it changed 0/24
// fixtures. The judge received a byte-identical transcript, and the result was
// published as "Whitespace normalised" with the strictest gate in the file
// (0.98). Endpoint sampling noise was therefore reported as a formatting
// sensitivity, and it counted toward every model's list of failed invariances.
//
// Nothing caught it because no test asserted the probes DO anything - they were
// only ever tested for how their results are scored. A probe that measures
// nothing is not a weak probe; it is a mislabelled one, and it corrupts the
// record it writes.

import test from "node:test";
import assert from "node:assert/strict";

import { FIXTURES } from "./judge-fixtures.mjs";
import { PROBES, AUDIT_TRANSFORMS } from "./judge-transforms.mjs";

const ALL = [...PROBES, ...AUDIT_TRANSFORMS];

function effectiveness(transform) {
  const changed = [];
  const unchanged = [];
  for (const f of FIXTURES) {
    const before = f.transcript;
    let after;
    try {
      after = transform(before);
    } catch {
      after = before;
    }
    if (after === before) unchanged.push(f.id);
    else changed.push(f.id);
  }
  return { changed, unchanged };
}

test("no probe is inert across the whole fixture pack", () => {
  const inert = [];
  for (const p of ALL) {
    const { changed } = effectiveness(p.fn);
    if (changed.length === 0) inert.push(p.id);
  }
  assert.deepEqual(
    inert,
    [],
    `these probes changed nothing on any of the ${FIXTURES.length} fixtures, so they measure sampling noise while reporting a named invariance: ${inert.join(", ")}`,
  );
});

test("the whitespace probe perturbs formatting, not nothing", () => {
  // Regression pin for the specific defect: it must touch every fixture, since
  // every transcript is newline-separated.
  const ws = PROBES.find((p) => p.id === "whitespace");
  assert.ok(ws, "whitespace probe must exist");
  const { changed } = effectiveness(ws.fn);
  assert.equal(
    changed.length,
    FIXTURES.length,
    `whitespace probe should reflow every transcript (newlines -> spaces); it only changed ${changed.length}/${FIXTURES.length}`,
  );
});

test("a probe that collapses whitespace leaves no newlines behind", () => {
  const ws = PROBES.find((p) => p.id === "whitespace");
  for (const f of FIXTURES) {
    const out = ws.fn(f.transcript);
    assert.ok(!/\n/.test(out), `${f.id}: newline survived the whitespace probe`);
    assert.ok(!/ {2,}/.test(out), `${f.id}: double space survived the whitespace probe`);
    assert.equal(out, out.trim(), `${f.id}: output is not trimmed`);
    // Content must be preserved: this is an invariance probe, not a rewrite.
    assert.equal(
      out.replace(/\s+/g, " ").trim(),
      f.transcript.replace(/\s+/g, " ").trim(),
      `${f.id}: whitespace probe changed the words, not just the layout`,
    );
  }
});

test("partial coverage is reported, never silently zero", () => {
  // Some probes legitimately cannot fire on some fixtures (style-fancy has no
  // upgradeable word to swap). That is fine and must stay visible, so a future
  // regression to zero is distinguishable from designed partial coverage.
  const report = ALL.map((p) => {
    const { changed } = effectiveness(p.fn);
    return { id: p.id, n: changed.length };
  });
  const full = report.filter((r) => r.n === FIXTURES.length).length;
  const partial = report.filter((r) => r.n > 0 && r.n < FIXTURES.length);
  assert.ok(
    full >= ALL.length - 2,
    `expected almost every probe to fire on every fixture; got ${full}/${ALL.length} full. Partial: ${partial.map((p) => `${p.id}=${p.n}`).join(", ")}`,
  );
  for (const p of partial) {
    assert.ok(p.n > 0, `${p.id} must change at least one fixture`);
  }
});

test("whitespace-only layouts of one transcript collapse to the same string", () => {
  // The old probe was `t.replaceAll("  ", " ").trim()`, which left a
  // newline-separated, single-spaced fixture byte-identical. Two layouts that
  // differ only by a double space, a tab run, and a newline-plus-indent must
  // now both change, and must change into the same transcript.
  const ws = PROBES.find((p) => p.id === "whitespace");
  assert.ok(ws, "whitespace probe must exist");
  const raw = FIXTURES.find((f) => f.transcript.includes("\n") && f.transcript.includes(" "));
  assert.ok(raw, "need a representative newline-separated fixture");
  const mutated = raw.transcript.replace(" ", "  ").replace("\n", "\n\t  ");
  assert.notEqual(mutated, raw.transcript, "mutation must be whitespace-only and non-empty");

  const normRaw = ws.fn(raw.transcript);
  const normMutated = ws.fn(mutated);
  assert.notEqual(normRaw, raw.transcript, "probe must change the raw fixture, not pass it through");
  assert.notEqual(normMutated, mutated, "probe must change the mutated layout, not pass it through");
  assert.equal(normRaw, normMutated);
});
