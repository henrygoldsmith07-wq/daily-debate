// Controlled judge experiments: single-variable prompt studies.
//
// Every experiment changes exactly ONE material instruction relative to the
// shipped default (today: the citation clause) so a metric movement can be
// attributed. Multi-rule prompt stacks are explicitly banned: they cannot
// say which change did what. Each experiment is evaluated on the FULL
// fixture pack, repeated runs (scripts/judge-variance.mjs) against the same
// baseline, and may only be adopted when it improves its target metric
// WITHOUT materially regressing the protected metrics (agreement, ECE,
// position, names, verbosity, style, prestige, whitespace, reliability).

import { CITATION_CLAUSE_DEFAULT, buildVerdictSystem } from "./judge-providers.mjs";

export const EXPERIMENTS = {
  "baseline": {
    label: "v5 shipped",
    hypothesis: "current shipped prompt (control arm)",
    citationClause: CITATION_CLAUSE_DEFAULT,
  },
  "citation-zero-weight": {
    label: "v5.1 citation-zero-weight",
    status:
      "REJECTED 2026-09-15: measured over 2 clean full-pack runs on kiraai vs 2-run v5 baseline (docs/judge-runs/v51czw-clean-2026-09-15). Target metric did not improve (fake-citation 0.233 -> 0.256, within run noise). H1 falsified: fake-citation influence stays ~0.22-0.26 across ALL prompt arms and both v4/v5 wording variants - it is this model's irreducible behaviour, not a clause defect. Shipped default stays v5.",
    // Evidence: v5 regressed kiraai fake-citation influence 0.143 -> 0.381
    // (single run). Hypothesis: "noise, not strength" still lets a source
    // NAME register as evidence on small models; a DEFAULT-ZERO weight plus
    // an explicit no-confidence-lift instruction removes the shortcut while
    // leaving every other clause byte-identical.
    hypothesis:
      "citations score zero by default unless the transcript shows what the source said and how it supports the claim; a name alone never raises scores or confidence",
    citationClause:
      "Named sources, institutions and statistics carry zero evidential weight unless the transcript itself shows what the source said and how it supports the claim; a source name alone must never raise either side's score or the judge's confidence.",
  },
};

export function experimentSystem(name) {
  const exp = EXPERIMENTS[name];
  if (!exp) {
    throw new Error(`unknown experiment "${name}" (known: ${Object.keys(EXPERIMENTS).join(", ")})`);
  }
  // Single-variable seam: buildVerdictSystem differs from the shipped prompt
  // ONLY through the citation clause (byte-identical frame either way).
  return {
    system: buildVerdictSystem(exp.citationClause),
    isDefault: exp.citationClause === CITATION_CLAUSE_DEFAULT,
  };
}
