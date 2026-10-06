// Deterministic hash sampling for classifier.dev shadow-validation traffic.
//
// Every judged PvP debate currently triggers a remote classifier.dev call, but
// shadow validation does not need all of them: a uniform random subset yields
// unbiased estimates of every gate metric (agreement, false-decisive rate,
// score-gap MAE, insufficient-evidence rate). Sampling is by SHA-256 of a
// stable debate key (the match id), so:
//
// - inclusion is independent of debate content, length, topic, or labels —
//   the sample is unbiased and the registered gate denominators keep their
//   exact definition (eligible shadow attempts only; skipped debates are never
//   attempts and never enter a denominator);
// - the decision is stable across retries and re-judges of the same debate —
//   there is no re-roll bias;
// - gate N-floors (200/300 eligible attempts) are unchanged, so the evidence
//   bar is identical; only calendar time to N grows roughly 1/rate.
//
// Non-sampled debates take the local fallback path, which can never choose a
// judge-avoidance route, so they stay on the authoritative ensemble and
// produce no shadow record. Sampling changes traffic volume only — it never
// changes what any route may decide, and adoption gates are untouched.
//
// Human-grounded corpus runs (system-comparison) and live response shaping
// (solo turns) are NOT sampled: human labels are too valuable to skip, and
// shaping is a product feature, not validation traffic.

import { createHash } from "node:crypto";

/** Default share of eligible debates that reach the remote classifier. */
export const SHADOW_SAMPLE_RATE_DEFAULT = 0.25;

/** Env override for the shadow sample rate. Parsed as a 0..1 fraction. */
export const SHADOW_SAMPLE_ENV_VAR = "CLASSIFIER_SHADOW_SAMPLE_RATE";

export interface ShadowSampleDecision {
  /** Stable key the decision was derived from. */
  key: string;
  /** Effective rate applied (0..1). */
  rate: number;
  /** Uniform bucket in [0, 1) for the key. NaN when no key was supplied. */
  bucket: number;
  /** Whether this debate is selected for remote classification. */
  sampled: boolean;
}

/**
 * Resolve the effective sample rate. Empty/unset means the default; an
 * unparseable value fails OPEN to 1 (classify every debate, today's
 * behaviour) rather than silently changing validation traffic.
 */
export function resolveShadowSampleRate(raw: string | undefined | null): number {
  if (raw === undefined || raw === null || String(raw).trim() === "") return SHADOW_SAMPLE_RATE_DEFAULT;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 1;
  if (parsed <= 0) return 0;
  if (parsed >= 1) return 1;
  return parsed;
}

/** Uniform bucket in [0, 1) from the first 32 bits of SHA-256(key). */
export function shadowSampleBucket(key: string): number {
  const digest = createHash("sha256").update(key, "utf8").digest();
  return digest.readUInt32BE(0) / 0x1_0000_0000;
}

/**
 * Deterministic sampling decision for one debate key. Rate 1 samples
 * everything, rate 0 (or a missing key) samples nothing — both without
 * hashing, so the boundaries are exact.
 */
export function shadowSampleDecision(key: string, rate: number): ShadowSampleDecision {
  const effective = Number.isFinite(rate) ? Math.min(1, Math.max(0, rate)) : 1;
  if (effective >= 1) return { key, rate: effective, bucket: Number.NaN, sampled: true };
  if (effective <= 0 || !key) return { key, rate: effective, bucket: Number.NaN, sampled: false };
  const bucket = shadowSampleBucket(key);
  return { key, rate: effective, bucket, sampled: bucket < effective };
}
