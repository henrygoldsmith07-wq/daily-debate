import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/backend/server";
import { isCorpusAdmin } from "@/lib/corpus";
import { consensusLabel } from "@/lib/corpusAdjudication";
import type { RaterVerdict, WinnerLabel } from "@/lib/humanCorpus";

// Admin-only adjudication: settle items whose raters disagree. The consensus
// label (majority vote, tie on split) is written back as the item's
// reference verdict so it can join the agreement-ready set.

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
  const corpusId = typeof body?.corpusId === "string" ? body.corpusId : null;
  if (!corpusId) return NextResponse.json({ error: "corpusId is required." }, { status: 400 });

  // Optional moderator override; otherwise the majority vote decides.
  const override = body?.winner;
  if (override !== undefined && override !== "a" && override !== "b" && override !== "tie") {
    return NextResponse.json({ error: "winner override must be a|b|tie" }, { status: 400 });
  }

  const service = createServiceClient();
  const { data: ratings } = await service.from("corpus_ratings").select("rater_id, winner").eq("corpus_id", corpusId);
  if (!ratings || ratings.length < 2) {
    return NextResponse.json({ error: "Item needs at least two ratings before adjudication." }, { status: 409 });
  }

  let consensusWinner: string;
  let basis: string;
  if (override) {
    consensusWinner = override;
    basis = `moderator override (${user.email})`;
  } else {
    const verdicts: RaterVerdict[] = ratings.map((r) => ({ raterId: r.rater_id, winner: r.winner as WinnerLabel }));
    consensusWinner = consensusLabel(verdicts).winner;
    basis = "rater majority";
  }

  await service
    .from("corpus_items")
    .update({ status: "adjudicated", side_mapping: { consensus_winner: consensusWinner, basis } })
    .eq("id", corpusId);

  return NextResponse.json({ ok: true, corpusId, consensusWinner, basis });
}
