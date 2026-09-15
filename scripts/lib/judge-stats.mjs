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
 * A run is USABLE for inference iff its provider reliability clears the
 * registered floor. Excluded runs stay in raw evidence and descriptive
 * reporting; they never enter means, CIs or regression comparisons.
 */
export function runUsability(run, registration) {
  const min = registration.minimumUsableReliability ?? 0.75;
  const rel = run.reliability;
  if (typeof rel !== "number" || !Number.isFinite(rel)) return { usable: false, reason: "reliability unreported" };
  if (rel < min) return { usable: false, reason: `reliability ${rel} < registered minimum ${min}` };
  return { usable: true, reason: null };
}

/**
 * Apply the pre-registered adoption rule EXACTLY. Returns
 * { status: supported|rejected|inconclusive, reasons[], audit }.
 *
 * Inference uses ONLY usable runs; the registered runsPerArm is a hard
 * requirement, not advice: usable < runsPerArm on ANY arm => INCONCLUSIVE,
 * always. No reduced-power inference.
 */
export function decideFromRegistration(registration, armStats) {
  const reasons = [];
  const base = armStats.baseline;
  const cand = armStats.candidate;
  const need = registration.runsPerArm ?? 3;
  const minRel = registration.minimumUsableReliability ?? 0.75;

  const classify = (arm) =>
    (arm?.runs ?? []).map((r) => ({ ...r, ...runUsability(r, registration) }));
  const baseClass = classify(base);
  const candClass = classify(cand);
  const bu = baseClass.filter((r) => r.usable);
  const cu = candClass.filter((r) => r.usable);

  const audit = {
    minimumUsableReliability: minRel,
    runsPerArmRequired: need,
    baseline: {
      totalRuns: baseClass.length,
      usableRuns: bu.length,
      excluded: baseClass
        .filter((r) => !r.usable)
        .map((r) => ({ file: r.file, at: r.at, reliability: r.reliability, reason: r.reason })),
    },
    candidate: {
      totalRuns: candClass.length,
      usableRuns: cu.length,
      excluded: candClass
        .filter((r) => !r.usable)
        .map((r) => ({ file: r.file, at: r.at, reliability: r.reliability, reason: r.reason })),
    },
  };

  if (bu.length < need || cu.length < need) {
    return {
      status: "inconclusive",
      reasons: [
        `registered requirement not met: usable runs baseline ${bu.length}/${need}, candidate ${cu.length}/${need} (reliability >= ${minRel}); INCONCLUSIVE - fewer usable runs never proceed to inference`,
      ],
      audit,
    };
  }

  const target = registration.target;
  if (!target?.metric) {
    return { status: "inconclusive", reasons: ["registration declares no target metric"], audit };
  }
  const dir = METRIC_DIRECTION[target.metric] ?? "up";
  // Usable-only values, in stable order.
  const bVals = bu.map((r) => r.metrics?.[target.metric] ?? null);
  const cVals = cu.map((r) => r.metrics?.[target.metric] ?? null);
  const bStat = basicStats(bVals);
  const cStat = basicStats(cVals);
  if (!bStat || !cStat) {
    return { status: "inconclusive", reasons: [`target metric ${target.metric} missing on at least one usable arm`], audit };
  }
  // usable RUNS is not enough - the target metric needs registered-count
  // usable VALUES, or the comparison is thinner than the seal allows.
  if (bStat.n < need || cStat.n < need) {
    return {
      status: "inconclusive",
      reasons: [`target ${target.metric}: usable values baseline ${bStat.n}/${need}, candidate ${cStat.n}/${need}`],
      audit,
    };
  }
  const rawDelta = cStat.mean - bStat.mean;
  const signedDelta = dir === "up" ? rawDelta : -rawDelta;
  const ci = bootstrapDeltaCi(bVals, cVals, { seed: registration.bootstrapSeed ?? 42 });
  const marginOk = signedDelta >= (target.minImprovement ?? 0.05);
  const lowerBoundSigned = ci ? (dir === "up" ? ci.ciLower : -ci.ciUpper) : null;
  const ciOk = lowerBoundSigned !== null && lowerBoundSigned > 0;
  if (!marginOk) reasons.push(`target ${target.metric}: improvement ${signedDelta.toFixed(3)} < registered minimum ${target.minImprovement}`);
  if (ci && !ciOk) reasons.push(`target ${target.metric}: bootstrap 90% CI lower bound ${lowerBoundSigned.toFixed(3)} includes zero - improvement indistinguishable from run noise`);
  if (!ci) reasons.push(`target ${target.metric}: bootstrap CI unavailable`);

  const regressions = [];
  for (const [metric, rule] of Object.entries(registration.protected ?? {})) {
    if (metric === target.metric) continue;
    const pb = basicStats(bu.map((r) => r.metrics?.[metric] ?? null));
    const pc = basicStats(cu.map((r) => r.metrics?.[metric] ?? null));
    if (!pb || !pc) continue;
    const d = pc.mean - pb.mean;
    const worsened = (METRIC_DIRECTION[metric] ?? "up") === "up" ? -d : d;
    const maxTolerated = rule.maxRegression;
    const pooledSd = Math.max(pb.sd, pc.sd);
    if (worsened > maxTolerated && worsened > pooledSd) {
      regressions.push(`${metric}: usable-run mean regressed by ${worsened.toFixed(3)} beyond max ${maxTolerated} and pooled sd ${pooledSd.toFixed(3)}`);
    } else if (worsened > maxTolerated) {
      reasons.push(`${metric}: mean regression ${worsened.toFixed(3)} beyond max ${maxTolerated} but within usable-run noise - noted, not disqualifying`);
    }
  }
  const decision = { status: "rejected", reasons, audit };
  if (regressions.length) return { ...decision, reasons: [...regressions, ...reasons] };
  if (marginOk && ciOk) {
    return { status: "supported", reasons: [`target ${target.metric} improved ${signedDelta.toFixed(3)} >= ${target.minImprovement}, CI lower bound ${lowerBoundSigned.toFixed(3)} > 0, no protected regression beyond usable-run noise`], audit };
  }
  return { ...decision, reasons: reasons.length ? reasons : ["adoption rule not satisfied"] };
}

/**
 * Balanced interleave planner for (re)sumed studies: returns the exact arm
 * sequence that keeps A/B alternation and per-arm counts within one of each
 * other while both approach `reps`. Completed counts resume mid-study; the
 * plan never runs two reps of one arm while the other trails (item 5).
 */
export function nextArmPlan(baselineCount, candidateCount, reps) {
  const plan = [];
  let b = baselineCount;
  let c = candidateCount;
  while (b < reps || c < reps) {
    if (b <= c && b < reps) { plan.push("baseline"); b += 1; }
    else if (c < reps) { plan.push("candidate"); c += 1; }
    else { plan.push("baseline"); b += 1; }
    if (plan.length > reps * 2 + 2) break; // paranoia against drift
  }
  return plan;
}
