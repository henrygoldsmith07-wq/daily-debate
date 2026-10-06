import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/backend/server";
import { CALIBRATION_RATERS_PER_ITEM } from "@/lib/corpus";
import type { WinnerLabel } from "@/lib/humanCorpus";
import { resolveHumanGroundTruth } from "@/lib/humanGroundTruth";
import { getRequestAuthContext } from "@/lib/requestAuth";
import { writeCorpusAdjudication } from "@/lib/corpusVerdictStore";
import { invalidatePublicCorpusMetrics } from "@/lib/publicCorpusMetrics";

// Admin-only adjudication: after the 3-rater collection target, record either
// a strict rater majority or an explicit moderator resolution as canonical
// human ground truth without overwriting system-verdict provenance.

export async function POST(request: Request) {
  const auth = await getRequestAuthContext();
  const user = auth.user;
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!auth.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const corpusId = typeof body?.corpusId === "string" ? body.corpusId : null;
  if (!corpusId) return NextResponse.json({ error: "corpusId is required." }, { status: 400 });

  // Optional moderator override; otherwise the majority vote decides.
  const override = body?.winner;
  if (override !== undefined && override !== "a" && override !== "b" && override !== "tie") {
    return NextResponse.json({ error: "winner override must be a|b|tie" }, { status: 400 });
  }

  const service = createServiceClient();
  const { data: ratings } = await service.from("corpus_ratings").select("rater_id, winner").eq("corpus_id", corpusId);
  if (!ratings || ratings.length < CALIBRATION_RATERS_PER_ITEM) {
    return NextResponse.json(
      { error: `Item needs at least ${CALIBRATION_RATERS_PER_ITEM} ratings before adjudication.` },
      { status: 409 },
    );
  }

  let consensusWinner: WinnerLabel;
  let basis: string;
  if (override) {
    consensusWinner = override as WinnerLabel;
    basis = `moderator override (${user.email})`;
  } else {
    const resolved = resolveHumanGroundTruth(
      { status: "rated", side_mapping: {} },
      ratings.map((r) => ({ rater_id: r.rater_id, winner: r.winner })),
    );
    if (resolved.state !== "consensus" || !resolved.winner) {
      return NextResponse.json(
        { error: "This disagreement needs an explicit moderator winner override." },
        { status: 409 },
      );
    }
    consensusWinner = resolved.winner;
    basis = "rater majority";
  }

  const applied = await writeCorpusAdjudication({
    corpusId,
    winner: consensusWinner,
    basis,
    actor: user.email ?? user.id,
    at: new Date().toISOString(),
    minimumRatings: CALIBRATION_RATERS_PER_ITEM,
  });
  if (!applied) {
    return NextResponse.json({ error: "Item is not ready for adjudication." }, { status: 409 });
  }
  invalidatePublicCorpusMetrics();

  return NextResponse.json({ ok: true, corpusId, consensusWinner, basis });
}
