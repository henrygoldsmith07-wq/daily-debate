import { NextResponse } from "next/server";
import { createClient } from "@/lib/backend/server";
import { checkRateLimit } from "@/lib/rateLimit";
import { buildFinishPreview } from "@/lib/solo/finishPreview";

type RouteContext = { params: Promise<{ debateId: string }> };
const NO_STORE = { "Cache-Control": "no-store" };

// Read-only: the deterministic weakness from stored turn assessments, so the
// learner can start reading it while the model summary is still generating.
export async function GET(request: Request, { params }: RouteContext) {
  const limited = await checkRateLimit(request, { name: "solo-preview-ip", limit: 60, windowMs: 60_000, failClosed: true });
  if (limited) return limited;
  const { debateId } = await params;
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });

  const { data: debate } = await db
    .from("solo_debates")
    .select("id, format")
    .eq("id", debateId)
    .eq("user_id", user.id)
    .single();
  if (!debate) return NextResponse.json({ error: "Debate not found." }, { status: 404, headers: NO_STORE });

  const { data: turns, error } = await db
    .from("solo_debate_turns")
    .select("user_message, assessment, round_number")
    .eq("debate_id", debateId)
    .order("round_number", { ascending: true });
  if (error || !turns) return NextResponse.json({ error: "Preview unavailable." }, { status: 503, headers: NO_STORE });

  return NextResponse.json({ preview: buildFinishPreview(turns, debate.format) }, { headers: NO_STORE });
}
