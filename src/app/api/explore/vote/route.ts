import { NextResponse } from "next/server";
import { createClient } from "@/lib/backend/server";
import { checkRateLimit } from "@/lib/rateLimit";
import { castVote, getExploreDebate, type ExploreKind } from "@/lib/explore";

// One vote per viewer per published debate: which side ARGUED BETTER. The
// database function is the only writer and refuses unpublished debates and a
// participant voting on their own.
export async function POST(request: Request) {
  const limited = await checkRateLimit(request, { name: "explore-vote", limit: 30, windowMs: 60_000 });
  if (limited) return limited;

  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to vote." }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { kind?: unknown; id?: unknown; choice?: unknown } | null;
  const kind = body?.kind === "solo" || body?.kind === "pvp" ? (body.kind as ExploreKind) : null;
  const id = typeof body?.id === "string" ? body.id : null;
  const choice = body?.choice === "for" || body?.choice === "against" ? body.choice : null;
  if (!kind || !id || !choice) return NextResponse.json({ error: "Choose a side to vote for." }, { status: 400 });

  try {
    const outcome = await castVote(user.id, kind, id, choice);
    if (outcome === "not_public") return NextResponse.json({ error: "This debate is not published." }, { status: 404 });
    if (outcome === "own_debate") return NextResponse.json({ error: "You cannot vote on your own debate." }, { status: 403 });
    const debate = await getExploreDebate(user.id, kind, id);
    return NextResponse.json({ outcome, votes: debate?.votes ?? null, myVote: debate?.myVote ?? null });
  } catch (error) {
    console.error("explore vote failed:", error);
    return NextResponse.json({ error: "Could not record your vote. Try again." }, { status: 503 });
  }
}
