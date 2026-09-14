import { NextResponse } from "next/server";
import { createClient } from "@/lib/backend/server";
import { isCorpusAdmin, validateRating } from "@/lib/corpus";
import { appendRatingCorrection } from "@/lib/corpusRatingStore";

// Admin-only correction of a corpus rating. Normal ratings are immutable
// (first submission wins, duplicates rejected with 409); when a verdict is
// genuinely wrong this path overwrites it while appending an immutable audit
// entry (previous values, new values, reason, actor, timestamp) to the
// rating's corrections array. The original record stays reconstructable.

export async function POST(request: Request) {
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isCorpusAdmin(user.email, process.env.CORPUS_ADMIN_EMAILS)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const problems = validateRating(body);
  if (!body?.corpusId || typeof body.corpusId !== "string") {
    return NextResponse.json({ error: "corpusId is required." }, { status: 400 });
  }
  if (!body?.raterId || typeof body.raterId !== "string") {
    return NextResponse.json({ error: "raterId is required." }, { status: 400 });
  }
  if (typeof body?.reason !== "string" || body.reason.trim().length < 10) {
    return NextResponse.json({ error: "A correction reason of at least 10 characters is required." }, { status: 400 });
  }
  if (problems.length) return NextResponse.json({ error: problems.join("; ") }, { status: 400 });

  // Corrections are stored in ORIGINAL item coordinates, same frame as the
  // normalized stored ratings — no presentation transform applies here.
  const result = await appendRatingCorrection({
    corpusId: body.corpusId,
    raterId: body.raterId,
    winner: body.winner,
    scoresA: body.scores_a,
    scoresB: body.scores_b,
    actor: user.email ?? user.id,
    reason: body.reason.trim().slice(0, 500),
    at: new Date().toISOString(),
  });

  if (!result.applied) {
    return NextResponse.json({ error: "Rating not found." }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    corrections: result.corrections,
    note: "Original values are preserved in the correction audit trail.",
  });
}
