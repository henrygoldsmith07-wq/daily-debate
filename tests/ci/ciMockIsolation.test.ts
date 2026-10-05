import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * CI must not reach a real provider.
 *
 * `src/lib/aiE2eMock.ts` documents the intent directly: "CI must not spend
 * tokens or hold API keys." The Playwright app-server env honoured that, but
 * both `npm test` steps did not. The gap was invisible until it cost something:
 * the DB invariant suite reached nvidia and classifier.dev for real, a 504 and
 * a 60s timeout failed that step, and the Playwright step behind it was skipped
 * — so a green-looking PR got blocked by an outage that had nothing to do with
 * the change under review.
 *
 * The other half of the value is the guard itself. This repository's recurring
 * failure mode is a silent gap: the critical ops alert that never fired for two
 * weeks because it only ran on failures, the benchmark staleness nothing
 * watched, the e2e spec that passed one day in seven. Each was invisible
 * because nothing asserted the invariant. This asserts it.
 *
 * Deliberately parsed line-wise rather than with a YAML library: js-yaml is not
 * a declared dependency here, so importing it would make this guard depend on
 * whatever happens to be hoisted into node_modules.
 */

const WORKFLOW = path.resolve(__dirname, "../../.github/workflows/daily-debate.yml");

const RUNS_NPM_TEST = /^\s+run:\s*npm test\s*$/;
const STARTS_A_STEP = /^\s*-\s+(name|uses|run|env|id)\b/;
const STEP_NAME = /^\s*-\s+name:\s*(.+?)\s*$/;
const MOCK_FLAG = /E2E_MOCK_AI:\s*"?1"?\s*$/;

type TestStep = { line: number; name: string; mocked: boolean };

function npmTestSteps(): TestStep[] {
  const lines = readFileSync(WORKFLOW, "utf8").split(/\r?\n/);
  const found: TestStep[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    if (!RUNS_NPM_TEST.test(lines[i])) continue;

    // Walk back to the start of this step, then read its own block.
    let start = i;
    while (start > 0 && !STARTS_A_STEP.test(lines[start])) start -= 1;
    const block = lines.slice(start, i + 1);

    found.push({
      line: i + 1,
      name: block.map((l) => STEP_NAME.exec(l)?.[1]).find(Boolean) ?? "unnamed step",
      mocked: block.some((l) => MOCK_FLAG.test(l.trim())),
    });
  }

  return found;
}

describe("CI provider isolation", () => {
  const steps = npmTestSteps();

  it("finds the npm test steps it is meant to guard", () => {
    // If this ever finds nothing, the guard below passes vacuously — which is
    // exactly the class of silent gap this file exists to prevent.
    expect(steps.length).toBeGreaterThanOrEqual(2);
  });

  it("mocks provider calls in every step that runs npm test", () => {
    const unmocked = steps.filter((step) => !step.mocked);
    expect(
      unmocked,
      unmocked
        .map((s) => `  - "${s.name}" (line ${s.line}) runs npm test without E2E_MOCK_AI=1`)
        .join("\n") +
        "\nWithout it these tests can reach a real provider and inherit that provider's latency and outages.",
    ).toEqual([]);
  });
});