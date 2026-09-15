// Study statistics + pre-registered decision rule (items 4-5).
//
// A registration fixes, BEFORE any run executes: target metric & direction,
// required improvement margin, protected metrics with maximum tolerated
// regression, runs per arm, minimum usable provider reliability, and the
// adoption rule. The decider below applies exactly that; it cannot be edited
// after seeing results (registrations are committed and their hashes recorded
// in study artifacts).

export const METRIC_DIRECTION = {
  "provider reliability": "up",
  "fixture agreement": "up",
  ECE: "down",
  "fake-citation influence": "down",
  "position stability": "up",
  "names stability": "up",
  "verbosity stability": "up",
  "style stability": "up",
  "whitespace stability": "up",
  "prestige stability": "up",
  "latency p50 ms": "down",
  "prompt tokens": "down",
};

const METRIC_PICKERS = {
  "provider reliability": (m) => m.reliability?.successRatio ?? null,
  "fixture agreement": (m) => m.humanAgreement ?? null,
  ECE: (m) => m.ece ?? null,
  "fake-citation influence": (m) => m.falseCitationInfluence ?? null,
  "position stability": (m) => m.positionMirrorOk ?? null,
  "names stability": (m) => m.stability?.names ?? null,
  "verbosity stability": (m) => m.stability?.["verbosity-up"] ?? null,
  "style stability": (m) => m.stability?.["style-fancy"] ?? null,
  "whitespace stability": (m) => m.stability?.whitespace ?? null,
  "prestige stability": (m) => m.stability?.prestige ?? null,
  "latency p50 ms": (m) => m.latency?.p50Ms ?? null,
  "prompt tokens": (m) => m.promptTokens ?? null,
};

export function metricValue(metric, modelResult) {
  const pick = METRIC_PICKERS[metric];
  return pick ? pick(modelResult) : null;
}

export function basicStats(values) {
  const v = values.filter((x) => typeof x === "number" && Number.isFinite(x)).slice().sort((a, b) => a - b);
  if (!v.length) return null;
  const mean = v.reduce((s, x) => s + x, 0) / v.length;
  const median = v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
  const sd = v.length > 1 ? Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / (v.length - 1)) : 0;
  return { n: v.length, values: v, mean: +mean.toFixed(4), median: +median.toFixed(4), sd: +sd.toFixed(4), min: v[0], max: v[v.length - 1] };
}

/**
 * Non-parametric bootstrap CI of the difference (candidate - baseline) of
 * means. Deterministic: seeded LCG, same seed => same interval (2000 draws,
 * default 90% central). n>=1 per arm; with tiny n this is honest about how
 * little it knows - callers combine it with the pre-registered margin rule.
 */
export function bootstrapDeltaCi(baseValues, candValues, { draws = 2000, alpha = 0.1, seed = 42 } = {}) {
  const b = baseValues.filter((x) => Number.isFinite(x));
  const c = candValues.filter((x) => Number.isFinite(x));
  if (!b.length || !c.length) return null;
  let s = seed >>> 0;
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const mean = (xs) => xs.reduce((t, x) => t + x, 0) / xs.length;
  const diffs = [];
  for (let i = 0; i < draws; i++) {
    const bs = Array.from({ length: b.length }, () => b[Math.floor(rand() * b.length)]);
    const cs = Array.from({ length: c.length }, () => c[Math.floor(rand() * c.length)]);
    diffs.push(mean(cs) - mean(bs));
  }
  diffs.sort((x, y) => x - y);
  const lo = diffs[Math.floor((alpha / 2) * draws)];
  const hi = diffs[Math.floor((1 - alpha / 2) * draws) - 1];
  return { point: +(mean(c) - mean(b)).toFixed(4), ciLower: +lo.toFixed(4), ciUpper: +hi.toFixed(4), draws, alpha };
}

/**
 * Apply the pre-registered adoption rule. Returns
 * { status: supported|rejected|inconclusive, reasons[] }.
 */
export function decideFromRegistration(registration, armStats) {
  const reasons = [];
  const base = armStats.baseline;
  const cand = armStats.candidate;
  const need = registration.runsPerArm ?? 3;
  const minRel = registration.minimumUsableReliability ?? 0.75;

  const usableRuns = (arm) => (arm?.runs ?? []).filter((r) => (r.reliability ?? 0) >= minRel);
  const bu = usableRuns(base);
  const cu = usableRuns(cand);
  if (bu.length < 2 || cu.length < 2) {
    return {
      status: "inconclusive",
      reasons: [
        `insufficient usable runs (reliability >= ${minRel}): baseline ${bu.length}/${base?.runs?.length ?? 0} usable, candidate ${cu.length}/${cand?.runs?.length ?? 0} usable (registration requires ${need} per arm)`,
      ],
    };
  }
  if (bu.length < need || cu.length < need) {
    reasons.push(`below registered repetitions (${need}): usable baseline ${bu.length}, usable candidate ${cu.length} - verdict treats power as reduced`);
  }

  const target = registration.target;
  const dir = METRIC_DIRECTION[target.metric] ?? "up";
  const bStat = basicStats(base.runs.map((r) => r.metrics[target.metric]));
  const cStat = basicStats(cand.runs.map((r) => r.metrics[target.metric]));
  if (!bStat || !cStat) return { status: "inconclusive", reasons: ["target metric missing data on at least one arm"] };
  const rawDelta = cStat.mean - bStat.mean;
  const signedDelta = dir === "up" ? rawDelta : -rawDelta;
  const ci = bootstrapDeltaCi(
    base.runs.map((r) => r.metrics[target.metric]),
    cand.runs.map((r) => r.metrics[target.metric]),
    { seed: registration.bootstrapSeed ?? 42 },
  );
  const marginOk = signedDelta >= (target.minImprovement ?? 0.05);
  // "exceeds predefined noise margin": with >=2 runs/arm the bootstrap lower
  // bound of the signed improvement must be > 0 (no overlap with no-effect).
  const lowerBoundSigned = ci ? (dir === "up" ? ci.ciLower : -ci.ciUpper) : null;
  const ciOk = lowerBoundSigned !== null && lowerBoundSigned > 0;
  if (!marginOk) reasons.push(`target ${target.metric}: improvement ${signedDelta.toFixed(3)} < registered minimum ${target.minImprovement}`);
  if (ci && !ciOk) reasons.push(`target ${target.metric}: bootstrap ${((1 - 0.1) * 100).toFixed(0)}% CI lower bound ${lowerBoundSigned.toFixed(3)} includes zero - improvement not distinguishable from noise`);
  if (!ci) reasons.push(`target ${target.metric}: bootstrap CI unavailable (empty arm)`);

  const regressions = [];
  for (const [metric, rule] of Object.entries(registration.protected ?? {})) {
    if (metric === target.metric) continue;
    const pb = basicStats(base.runs.map((r) => r.metrics[metric]));
    const pc = basicStats(cand.runs.map((r) => r.metrics[metric]));
    if (!pb || !pc) continue;
    const d = pc.mean - pb.mean;
    const worsened = (METRIC_DIRECTION[metric] ?? "up") === "up" ? -d : d;
    const maxTolerated = rule.maxRegression;
    const pooledSd = Math.max(pb.sd, pc.sd);
    if (worsened > maxTolerated && worsened > pooledSd) {
      regressions.push(`${metric}: regressed by ${worsened.toFixed(3)} beyond max ${maxTolerated} (pooled sd ${pooledSd.toFixed(3)})`);
    } else if (worsened > maxTolerated) {
      reasons.push(`${metric}: mean regression ${worsened.toFixed(3)} beyond max ${maxTolerated} but within run noise - noted, not disqualifying`);
    }
  }
  if (regressions.length) return { status: "rejected", reasons: [...regressions, ...reasons.filter((r) => r.startsWith("target"))] };
  if (marginOk && ciOk) return { status: "supported", reasons: [`target improved ${signedDelta.toFixed(3)} >= ${target.minImprovement}, CI lower bound ${lowerBoundSigned.toFixed(3)} > 0, no protected regression beyond noise`, ...reasons.map((r) => `(note) ${r}`)] };
  return { status: "rejected", reasons: reasons.length ? reasons : ["adoption rule not satisfied"] };
}
