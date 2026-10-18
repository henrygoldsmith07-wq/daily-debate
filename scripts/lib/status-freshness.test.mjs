// status.md staleness guard.
//
// The validation block in docs/status.md quoted a 2026-09-14 artifact while
// dated 2026-10-07, and was still quoting those numbers after the 2026-10-12
// full-pack refresh materially changed them (best agreement 0.583 -> 0.696,
// best ECE 0.189 -> 0.105, and the only usable position measurement fell to
// 0.455). A status table whose numbers do not match the artifact it cites is
// exactly the kind of quiet dishonesty this project's discipline forbids, so
// this test pins every quoted number to docs/latest-judge-benchmark.json and
// fails - with the correct value in the message - whenever a new artifact
// lands without the table being refreshed.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const artifact = JSON.parse(readFileSync(path.join(ROOT, "docs", "latest-judge-benchmark.json"), "utf8"));
const status = readFileSync(path.join(ROOT, "docs", "status.md"), "utf8");

const rows = artifact.results ?? [];
/* The four headline metrics, with the direction "best = closest to its gate". */
const METRICS = [
  { label: "Fixture-label agreement", field: "humanAgreement", direction: "up", gate: "fixture-label agreement" },
  { label: "Calibration error (ECE)", field: "ece", direction: "down", gate: "ECE" },
  { label: "Position-swap stability", field: "positionMirrorOk", direction: "up", gate: "position" },
  { label: "Fake-citation influence", field: "falseCitationInfluence", direction: "down", gate: "fake-citation" },
];

/**
 * A row's metric number only counts when its gate actually measured something:
 * a raw `0` next to an INSUFFICIENT DATA gate (e.g. openrouter's
 * fake-citation gate after its probe phase errored out) is a placeholder, not
 * a measurement, and quoting it as "best measured" would be dishonest.
 */
function usableRows(metric) {
  return rows.filter((m) => {
    const gate = (m.gates ?? []).find((c) => String(c.name).includes(metric.gate));
    if (gate && gate.state === "INSUFFICIENT DATA") return false;
    return typeof m[metric.field] === "number";
  });
}

function bestFor(metric) {
  const measured = usableRows(metric);
  if (!measured.length) return null;
  const best = metric.direction === "up"
    ? measured.reduce((a, b) => (b[metric.field] > a[metric.field] ? b : a))
    : measured.reduce((a, b) => (b[metric.field] < a[metric.field] ? b : a));
  return best;
}

/** The numeric token the status table quotes for one metric row. */
function quotedValue(metric) {
  const line = status.split("\n").find((l) => l.includes(`| ${metric.label} |`));
  if (!line) throw new Error(`status.md no longer quotes "${metric.label}"`);
  const cell = line.split("|")[2] ?? ""; // | label | best measured | gate |
  const num = cell.match(/(\*{2})([\d.]+)\1/); // **0.696**
  return num ? { value: Number(num[2]), cell } : { value: null, cell };
}

test("status.md quotes the published artifact's date", () => {
  const at = artifact.at?.slice(0, 10);
  assert.ok(at, "artifact carries a timestamp");
  const firstCells = status.split("\n").slice(0, 30).join("\n");
  assert.match(firstCells, new RegExp(`${at}\\b`), "the validation block must cite the artifact's date");
});

test("status.md's best-measured table matches the artifact exactly", () => {
  for (const metric of METRICS) {
    const best = bestFor(metric);
    const { value, cell } = quotedValue(metric);
    if (!best) {
      assert.equal(value, null, `${metric.label}: the artifact has no usable measurement, so status.md must not quote a number`);
      assert.match(
        cell,
        /no usable measurement|INSUFFICIENT|only usable measurement/i,
        `${metric.label}: say plainly that the artifact does not measure this metric`,
      );
      continue;
    }
    assert.equal(
      value,
      Math.round(best[metric.field] * 1000) / 1000,
      `${metric.label} stale: artifact says ${best[metric.field]} (${best.model}), shown ${value}`,
    );
    if (metric.field === "humanAgreement") {
      assert.match(cell, new RegExp(`\\bn=${best.agreementN}\\b`), `${metric.label}: the sample size must be the artifact's`);
    }
  }
});

test("status.md claims no judge passes exactly while the artifact has no passing row", () => {
  const allFail = rows.length > 0 && rows.every((m) => !(m.gates ?? []).every((c) => c.pass));
  const claimsNone = /no judge currently passes/i.test(status) || /no model clears the judge gates/i.test(status);
  assert.equal(claimsNone, allFail, "the headline claim and the artifact must agree in both directions");
});
