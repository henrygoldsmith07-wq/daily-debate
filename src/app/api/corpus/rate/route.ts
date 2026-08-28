import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/backend/server";
import { checkRateLimit } from "@/lib/rateLimit";
import { MIN_RATERS_PER_ITEM, validateRating } from "@/lib/corpus";

// Blind rater assignment. Returns the next open corpus item this user is
// eligible to rate: not authored by them, not already rated by them.
// The payload exposes ONLY the anonymised transcript — no contributor id,
// no side mapping, no source pointers.

export async function GET(request: Request) {
  const limited = await checkRateLimit(request, { name: "corpus-rate", limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const service = createServiceClient();

  // Items this user already rated or contributed are excluded.
  const [{ data: myRatings }, { data: candidates }] = await Promise.all([
    service.from("corpus_ratings").select("corpus_id").eq("rater_id", user.id),
    service
      .from("corpus_items")
      .select("id, transcript, topic")
      .eq("status", "open")
      .order("created_at", { ascending: true })
      .limit(100),
  ]);

  const ratedIds = new Set((myRatings ?? []).map((r) => r.corpus_id));
  const myRatingsCount = ratedIds.size;
  // Contributor exclusion: the import stores contributor_id; fetch it for the
  // candidate slice only (service role can read it; we never return it).
  const { data: meta } = await service
    .from("corpus_items")
    .select("id, contributor_id")
    .in("id", (candidates ?? []).length ? (candidates ?? []).map((c) => c.id) : ["00000000-0000-0000-0000-000000000000"]);
  const excludedContributor = new Set(
    (meta ?? []).filter((m) => m.contributor_id === user.id).map((m) => m.id),
  );

  const next = (candidates ?? []).find((c) => !ratedIds.has(c.id) && !excludedContributor.has(c.id));
  if (!next) {
    return NextResponse.json({
      item: null,
      myRatingsCount,
      note: "No unrated items available right now. Import more debates or come back later.",
    });
  }

  return NextResponse.json({
    item: { id: next.id, transcript: next.transcript, topic: next.topic },
    ratersRequired: MIN_RATERS_PER_ITEM,
    myRatingsCount,
  });
}

// Submit a blind verdict for one corpus item. The rater never learns which
// side was the AI or who authored the debate; the server records only the
// rating against the item id.
export async function POST(request: Request) {
  const limited = await checkRateLimit(request, { name: "corpus-rate-post", limit: 30, windowMs: 60_000 });
  if (limited) return limited;

  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const problems = validateRating(body);
  if (problems.length) return NextResponse.json({ error: problems.join("; ") }, { status: 400 });

  const corpusId = typeof body?.corpusId === "string" ? body.corpusId : null;
  if (!corpusId) return NextResponse.json({ error: "corpusId is required." }, { status: 400 });

  const service = createServiceClient();

  // Contributor exclusion + item existence (metadata stays server-side).
  const { data: item } = await service.from("corpus_items").select("id, contributor_id, status").eq("id", corpusId).single();
  if (!item || item.status === "rejected") return NextResponse.json({ error: "Item not found." }, { status: 404 });
  if (item.contributor_id === user.id) {
    return NextResponse.json({ error: "You cannot rate your own debate." }, { status: 403 });
  }

  const payload = {
    corpus_id: corpusId,
    rater_id: user.id,
    scores_a: body.scores_a,
    scores_b: body.scores_b,
    winner: body.winner,
    confidence: body.confidence ?? null,
    rationale: (body.rationale ?? "").slice(0, 1000),
  };
  // unique(corpus_id, rater_id) makes double-submission a no-op conflict.
  const { error } = await service.from("corpus_ratings").upsert(payload, { onConflict: "corpus_id,rater_id" });
  if (error) {
    console.error("Failed to store rating:", error);
    return NextResponse.json({ error: "Failed to store your rating." }, { status: 500 });
  }

  const { count } = await service
    .from("corpus_ratings")
    .select("id", { count: "exact", head: true })
    .eq("corpus_id", corpusId);
  if ((count ?? 0) >= MIN_RATERS_PER_ITEM) {
    await service.from("corpus_items").update({ status: "rated" }).eq("id", corpusId).eq("status", "open");
  }

  return NextResponse.json({ ok: true, ratingsSoFar: count ?? 1 });
}
