// Appeal / report workflow: after a judged match, either player can appeal.
// Pure state machine — persistence lives in Supabase (`match_appeals` table).

export type AppealReason = "scoring_error" | "missed_evidence" | "bias" | "abuse" | "other";
export type AppealStatus = "open" | "under_review" | "upheld" | "denied" | "withdrawn";

export interface Appeal {
  id: string;
  matchId: string;
  filedBy: string;
  reason: AppealReason;
  note: string; // ≤600 chars, must cite transcript moments
  status: AppealStatus;
  createdAt: string;
  resolvedAt?: string;
  resolutionNote?: string;
  // If upheld with a corrected verdict
  correctedWinner?: "a" | "b" | "tie";
}

export function validateAppeal(a: Pick<Appeal, "reason" | "note">): string[] {
  const errs: string[] = [];
  if (!a.reason) errs.push("reason required");
  if (!a.note?.trim()) errs.push("note required — cite the transcript moment");
  else if (a.note.trim().length < 20) errs.push("note too short — explain which moment was misjudged");
  else if (a.note.length > 600) errs.push("note must be ≤600 chars");
  return errs;
}

export function canFileAppeal(match: { status: string; completed_at: string | null }, nowIso: string, windowHours = 48): { ok: boolean; reason?: string } {
  if (match.status !== "completed") return { ok: false, reason: "Match not yet judged" };
  if (!match.completed_at) return { ok: true };
  const diff = new Date(nowIso).getTime() - new Date(match.completed_at).getTime();
  if (diff > windowHours * 3600 * 1000) return { ok: false, reason: `Appeal window closed (${windowHours}h after judging)` };
  return { ok: true };
}

export function transitionAppeal(a: Appeal, next: AppealStatus, actor: "moderator" | "filer"): Appeal {
  const allowed: Record<AppealStatus, AppealStatus[]> = {
    open: ["under_review", "withdrawn"],
    under_review: ["upheld", "denied"],
    upheld: [],
    denied: [],
    withdrawn: [],
  };
  if (next === "withdrawn" && actor !== "filer") throw new Error("Only the filer can withdraw");
  if (next !== "withdrawn" && actor !== "moderator") throw new Error("Only a moderator can resolve");
  if (!allowed[a.status].includes(next)) throw new Error(`Cannot move appeal ${a.status} → ${next}`);
  return { ...a, status: next, resolvedAt: next === "upheld" || next === "denied" ? new Date().toISOString() : a.resolvedAt };
}

// Report (for moderation / abuse) — distinct from appeal (for judging disputes)
export type ReportReason = "harassment" | "spam" | "cheating" | "impersonation" | "other";
export interface Report {
  id: string;
  targetUserId: string;
  matchId?: string;
  reason: ReportReason;
  note: string;
  createdAt: string;
}
export function validateReport(r: Pick<Report, "reason" | "note">): string[] {
  const errs: string[] = [];
  if (!r.reason) errs.push("reason required");
  if (!r.note?.trim()) errs.push("note required");
  else if (r.note.length > 600) errs.push("note must be ≤600 chars");
  return errs;
}
