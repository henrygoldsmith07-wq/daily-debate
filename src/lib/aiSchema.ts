// Output-schema validation for AI provider responses. A provider returning a
// well-formed HTTP response with garbage/missing fields must count as a
// failure so the caller can fall back to the alternate provider instead of
// persisting junk. Pure functions — unit-tested.

function isNonEmptyString(value: unknown, min: number, max: number): boolean {
  return typeof value === "string" && value.trim().length >= min && value.length <= max;
}

export function isValidGeneratedTopic(v: unknown): boolean {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  if (!isNonEmptyString(o.title, 4, 200)) return false;
  if (!isNonEmptyString(o.prompt, 10, 1000)) return false;
  if (!isNonEmptyString(o.category, 2, 60)) return false;
  if (!Array.isArray(o.sources) || o.sources.length === 0 || o.sources.length > 8) return false;
  return o.sources.every((s) => {
    if (typeof s !== "object" || s === null) return false;
    const src = s as Record<string, unknown>;
    return isNonEmptyString(src.name, 2, 120);
  });
}

export function isValidOpening(v: unknown): boolean {
  // debateOpening returns a bare string.
  return isNonEmptyString(v, 16, 4000);
}

export function isValidDebateTurn(v: unknown): boolean {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return isNonEmptyString(o.aiMessage, 16, 6000) && isNonEmptyString(o.feedback, 4, 2000);
}

export function isValidSummary(v: unknown): boolean {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  if (!isNonEmptyString(o.overallFeedback, 12, 4000)) return false;
  for (const key of ["strengths", "improvements"] as const) {
    const arr = o[key];
    if (!Array.isArray(arr) || arr.length > 6) return false;
    if (!arr.every((s) => isNonEmptyString(s, 1, 500))) return false;
  }
  return true;
}

// --- Judge extraction (PvP) ----------------------------------------------
// The judge returns an argument graph (plus rationale); the application derives
// winner and numeric scores from that graph. The graph is therefore the one
// model-produced artefact that must not pass unvalidated: a malformed or
// truncated graph that reached scoring would silently become an apparently
// valid comparison. Validation is at the provider boundary so an invalid shape
// is a retryable failure, never a favourable verdict. Pure.

const NODE_KINDS = new Set(["claim", "evidence", "counterclaim", "rebuttal", "impact"]);
const OWNERS = new Set(["a", "b", "ai"]);
const EDGE_RELATIONS = new Set(["supports", "counters", "rebuts", "impacts"]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** A single graph node: the identity/ownership fields a scorer relies on. */
function isValidArgNode(v: unknown): boolean {
  if (!isPlainObject(v)) return false;
  return (
    isNonEmptyString(v.id, 1, 64) &&
    typeof v.kind === "string" &&
    NODE_KINDS.has(v.kind) &&
    typeof v.owner === "string" &&
    OWNERS.has(v.owner) &&
    typeof v.round === "number" &&
    Number.isFinite(v.round)
  );
}

function isValidArgEdge(v: unknown): boolean {
  if (!isPlainObject(v)) return false;
  return (
    isNonEmptyString(v.from, 1, 64) &&
    isNonEmptyString(v.to, 1, 64) &&
    typeof v.relation === "string" &&
    EDGE_RELATIONS.has(v.relation)
  );
}

/**
 * The judge's extraction payload. Only the fields the scorer derives truth from
 * are hardened — a graph with a well-formed `nodes` array is what scoring needs.
 * Anything that cannot be scored must be rejected here so it is retried or
 * falls through to an explicit insufficient-evidence outcome downstream.
 */
export function isValidJudgeExtraction(v: unknown): boolean {
  if (!isPlainObject(v)) return false;
  const graph = v.argGraph;
  if (!isPlainObject(graph)) return false;
  if (!Array.isArray(graph.nodes) || !graph.nodes.every(isValidArgNode)) return false;
  if (graph.edges !== undefined && (!Array.isArray(graph.edges) || !graph.edges.every(isValidArgEdge))) {
    return false;
  }
  // A rationale is required for an inspectable diagnosis; an empty one means the
  // model did not produce the analysis we asked for.
  return isNonEmptyString(v.rationale, 1, 8000);
}

/** A stored verdict's winner must be one of the three labels — never a stray string. */
export function isValidWinner(v: unknown): v is "a" | "b" | "tie" {
  return v === "a" || v === "b" || v === "tie";
}

/** A comparable score is a finite number; anything else is not a valid score. */
export function isValidScore(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}
