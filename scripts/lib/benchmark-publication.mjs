// Judge-benchmark publication health vs benchmark quality (items 21-22).
//
// The benchmark verdict and the artifact-publication verdict are TWO separate
// dimensions and must never contaminate each other in either direction:
//
//   gates pass + PR creation fails  -> quality PASS, publication incomplete
//                                      (a repository-setting failure is an
//                                      automation issue, not judge quality)
//   gates fail   + PR created       -> quality FAIL, publication succeeded
//                                      (a green workflow must never launder
//                                      a gate breach into a pass)
//
// This module is the single tested source of that truth table; the workflow
// summary step renders through it (scripts/benchmark-publication-summary.mjs)
// so what CI prints is exactly what the unit tests pinned.

/**
 * @param {{
 *   ran?: boolean,
 *   usable?: boolean | null,
 *   gatesPassed?: boolean | null,
 *   uploaded?: boolean,
 *   prCreated?: boolean,
 *   merged?: boolean | null,
 * }} input
 *   merged: null/undefined = deferred (separate merge job decides later).
 * @returns {{
 *   benchmarkRan: boolean,
 *   benchmarkUsable: boolean | null,
 *   benchmarkGatesPassed: boolean | null,
 *   artifactUploaded: boolean,
 *   artifactPrCreated: boolean,
 *   artifactMerged: boolean | null,
 *   qualityVerdict: "pass" | "fail" | "unknown",
 *   publicationVerdict: string,
 *   summaryLines: string[],
 * }}
 */
export function benchmarkHealth(input = {}) {
  const ran = input.ran === true;
  const gates = input.gatesPassed === true ? true : input.gatesPassed === false ? false : null;
  const uploaded = input.uploaded === true;
  const prCreated = input.prCreated === true;
  const merged = input.merged === true ? true : input.merged === false ? false : null;

  const qualityVerdict = gates === true ? "pass" : gates === false ? "fail" : "unknown";
  const publicationVerdict = !uploaded
    ? "not-published (no artifact uploaded)"
    : !prCreated
      ? "artifact-only (PR not created — repository setting/bot, not judge quality)"
      : merged === true
        ? "merged (after required checks)"
        : merged === false
          ? "PR open/failed merge (required checks gate it)"
          : "PR created (merge deferred to merge-artifact-pr after checks)";

  const summaryLines = [
    `- benchmarkRan: ${ran}`,
    `- benchmarkUsable: ${input.usable === true ? "yes" : input.usable === false ? "no — see docs/judge-benchmark-attempts.json for this run" : "see docs/judge-benchmark-attempts.json entries for this run"}`,
    `- benchmarkGatesPassed: ${gates === null ? "unknown (benchmark did not complete)" : gates}`,
    `- artifactUploaded: ${uploaded}`,
    `- artifactPrCreated: ${prCreated}`,
    `- artifactMerged: ${merged === null ? "see merge-artifact-pr job" : merged}`,
    `- quality verdict: ${qualityVerdict.toUpperCase()}${
      qualityVerdict === "pass" && !prCreated
        ? " (publication failure does not change judge quality)"
        : qualityVerdict === "fail"
          ? " (gates breached; publication success would not change this)"
          : ""
    }`,
    `- publication verdict: ${publicationVerdict}`,
  ];

  return {
    benchmarkRan: ran,
    benchmarkUsable: input.usable ?? null,
    benchmarkGatesPassed: gates,
    artifactUploaded: uploaded,
    artifactPrCreated: prCreated,
    artifactMerged: merged,
    qualityVerdict,
    publicationVerdict,
    summaryLines,
  };
}
