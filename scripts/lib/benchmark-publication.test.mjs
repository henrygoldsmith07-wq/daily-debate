import test from "node:test";
import assert from "node:assert/strict";
import { benchmarkHealth } from "./benchmark-publication.mjs";

// Item 22: the two truth-table cases that must never contaminate each other.

test("gates pass + PR creation fails -> quality PASS, publication incomplete", () => {
  const h = benchmarkHealth({ ran: true, gatesPassed: true, uploaded: true, prCreated: false });
  assert.equal(h.qualityVerdict, "pass");
  assert.equal(h.artifactUploaded, true);
  assert.equal(h.artifactPrCreated, false);
  assert.match(h.publicationVerdict, /PR not created/);
  assert.match(h.summaryLines.join("\n"), /quality verdict: PASS \(publication failure does not change judge quality\)/);
});

test("gates fail + PR creation succeeds -> quality FAIL, publication succeeded", () => {
  const h = benchmarkHealth({ ran: true, gatesPassed: false, uploaded: true, prCreated: true, merged: null });
  assert.equal(h.qualityVerdict, "fail");
  assert.equal(h.artifactPrCreated, true);
  assert.match(h.summaryLines.join("\n"), /quality verdict: FAIL \(gates breached; publication success would not change this\)/);
  assert.match(h.publicationVerdict, /PR created/);
});

test("benchmark not executed -> quality unknown, never pass", () => {
  const h = benchmarkHealth({ ran: false, gatesPassed: null, uploaded: true, prCreated: true });
  assert.equal(h.qualityVerdict, "unknown");
  assert.match(h.summaryLines.join("\n"), /benchmarkGatesPassed: unknown/);
});

test("merged state flows through without touching the quality verdict", () => {
  const merged = benchmarkHealth({ ran: true, gatesPassed: true, uploaded: true, prCreated: true, merged: true });
  assert.equal(merged.artifactMerged, true);
  assert.equal(merged.qualityVerdict, "pass");
  const notMerged = benchmarkHealth({ ran: true, gatesPassed: true, uploaded: true, prCreated: true, merged: false });
  assert.equal(notMerged.artifactMerged, false);
  assert.equal(notMerged.qualityVerdict, "pass");
});
