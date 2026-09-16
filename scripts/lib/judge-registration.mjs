// Registration schema: STRUCTURED FIELDS are the only executable rule.
//
// Historical incident (docs/judge-experiments/errata.md): early registrations
// hand-maintained a free-text adoptionRule that could drift from the engine
// (one said "inconclusive if usable < 2/arm" while runsPerArm was 3). From
// now on the prose is GENERATED from the structured fields, and the fields
// are validated before a study can be sealed or executed. Sealed historical
// snapshots are never rewritten - their hashes stand, with errata.

import { createHash } from "node:crypto";
import { METRIC_DIRECTION } from "./judge-stats.mjs";

export const REGISTRATION_SCHEMA_VERSION = 2;

/** Bookkeeping fields the runner writes back after sealing. Excluded from
 *  the canonical hash so a verdict write-back never "drifts" a study. */
const NON_AUTHORITATIVE = new Set(["status", "decidedAt", "registrationHash", "studyDir", "verdict", "capacityAssessment"]);

export function canonicalRegistration(reg) {
  return Object.fromEntries(Object.entries(reg).filter(([k]) => !NON_AUTHORITATIVE.has(k)));
}

export function canonicalHash(reg) {
  return createHash("sha256").update(JSON.stringify(canonicalRegistration(reg))).digest("hex").slice(0, 16);
}

export function deriveAdoptionRule(reg) {
  const dir = reg.target?.direction;
  return (
    `supported iff usable runs >= ${reg.runsPerArm}/arm at reliability >= ${reg.minimumUsableReliability} ` +
    `AND target "${reg.target?.metric}" moves ${dir === "up" ? "up" : "down"} by >= ${reg.target?.minImprovement} ` +
    `AND the bootstrap 90% CI lower bound of the signed improvement is > 0 ` +
    `AND no protected metric regresses beyond its cap AND pooled run sd. Fewer usable runs, any unmet ` +
    `condition or missing data => INCONCLUSIVE. Gate thresholds are untouchable.`
  );
}

const KNOWN_METRICS = new Set(Object.keys(METRIC_DIRECTION));

/**
 * Validate a registration before sealing/executing. Returns { ok, errors[] }.
 * Anything the engine cannot execute authoritatively is an error: a bad
 * registration must never produce a confident-looking verdict.
 */
export function validateRegistration(reg, { experiments } = {}) {
  const errors = [];
  if (!reg || typeof reg !== "object") return { ok: false, errors: ["registration is not an object"] };
  if (typeof reg.name !== "string" || !reg.name.trim()) errors.push("name required");
  if (typeof reg.hypothesis !== "string" || reg.hypothesis.trim().length < 20) errors.push("hypothesis required (>=20 chars)");
  if (typeof reg.singleVariable !== "string" || !reg.singleVariable.trim()) errors.push("singleVariable required");

  if (!Number.isInteger(reg.runsPerArm) || reg.runsPerArm < 2) errors.push("runsPerArm must be an integer >= 2");
  const min = reg.minimumUsableReliability;
  if (typeof min !== "number" || !(min > 0 && min <= 1)) errors.push("minimumUsableReliability must be in (0,1]");

  const t = reg.target;
  if (!t || typeof t !== "object") {
    errors.push("target required");
  } else {
    if (!KNOWN_METRICS.has(t.metric)) errors.push(`target.metric "${t.metric}" is not a known metric`);
    if (t.direction && t.direction !== METRIC_DIRECTION[t.metric]) errors.push(`target.direction "${t.direction}" contradicts the canonical direction "${METRIC_DIRECTION[t.metric]}" for ${t.metric}`);
    if (typeof t.minImprovement !== "number" || t.minImprovement <= 0) errors.push("target.minImprovement must be > 0");
  }

  const prot = reg.protected;
  if (!prot || typeof prot !== "object" || !Object.keys(prot).length) {
    errors.push("protected must declare at least one metric");
  } else {
    for (const [metric, rule] of Object.entries(prot)) {
      if (!KNOWN_METRICS.has(metric)) errors.push(`protected metric "${metric}" is not known`);
      if (t?.metric === metric) errors.push(`protected must not duplicate target metric "${metric}"`);
      if (!rule || typeof rule.maxRegression !== "number" || rule.maxRegression < 0) errors.push(`protected.${metric}.maxRegression must be a number >= 0`);
    }
  }

  for (const armName of ["baseline", "candidate"]) {
    const exp = reg.arms?.[armName]?.experiment;
    if (typeof exp !== "string" || !exp) errors.push(`arms.${armName}.experiment required`);
    else if (experiments && !experiments[exp]) errors.push(`arms.${armName} references unknown experiment "${exp}"`);
    else if (experiments?.[exp]?.implementationPending) errors.push(`arms.${armName} experiment "${exp}" is not implemented yet (refusing to execute a phantom arm)`);
  }
  if (reg.arms?.baseline?.experiment && reg.arms?.baseline?.experiment === reg.arms?.candidate?.experiment) {
    errors.push("baseline and candidate arms must differ");
  }
  if (typeof reg.models !== "string" || !reg.models.trim()) errors.push("models (provider label) required");
  if (reg.bootstrapSeed !== undefined && !Number.isInteger(reg.bootstrapSeed)) errors.push("bootstrapSeed must be an integer");
  const warnings = [];
  const prose = reg.adoptionRule ?? reg.proseAdoptionRule;
  if (prose) {
    const derived = deriveAdoptionRule(reg);
    if (String(prose).trim() !== derived) {
      if (reg.schemaVersion >= REGISTRATION_SCHEMA_VERSION) {
        errors.push("adoptionRule prose conflicts with structured fields - structured fields are authoritative; regenerate the prose");
      } else {
        warnings.push("legacy v1 prose adoptionRule differs from derived rule; structured fields govern (see docs/judge-experiments/errata.md)");
      }
    }
  }
  return { ok: errors.length === 0, errors, warnings };
}
