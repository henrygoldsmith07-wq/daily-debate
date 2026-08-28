import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/backend/server";
import { isCorpusAdmin } from "@/lib/corpus";

// Admin-only review of one corpus item for adjudication: full transcript plus
// its ratings. Rater identities are anonymised to Rater 1..N so the moderator
// decides on arguments, not on who said it.

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isCorpusAdmin(user.email, process.env.CORPUS_ADMIN_EMAILS)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const service = createServiceClient();
  const { data: item } = await service
    .from("corpus_items")
    .select("id, transcript, topic, length_bucket, ability_band, subject_category, status, created_at")
    .eq("id", id)
    .single();
  if (!item) return NextResponse.json({ error: "Item not found." }, { status: 404 });

  const { data: ratings } = await service
    .from("corpus_ratings")
    .select("rater_id, scores_a, scores_b, winner, confidence, rationale, created_at")
    .eq("corpus_id", id)
    .order("created_at", { ascending: true });

  // Blind even to the moderator: raters become Rater 1..N in submission order.
  const raterLabels = new Map<string, string>();
  const anonymised = (ratings ?? []).map((r) => {
    if (!raterLabels.has(r.rater_id)) raterLabels.set(r.rater_id, `Rater ${raterLabels.size + 1}`);
    return {
      rater: raterLabels.get(r.rater_id),
      winner: r.winner,
      confidence: r.confidence,
      rationale: r.rationale,
      scores_a: r.scores_a,
      scores_b: r.scores_b,
    };
  });

  return NextResponse.json(
    { item, ratings: anonymised },
    { headers: { "Cache-Control": "no-store" } },
  );
}
