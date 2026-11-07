import { NextResponse } from "next/server";
import { createClient } from "@/lib/backend/server";
import { checkRateLimitKey } from "@/lib/rateLimit";
import { isDebateId } from "@/lib/explore";
import { getMotionPrep } from "@/lib/motionPrepServer";

// Prep cards for a motion (migration 052). Signed-in learners only; one AI
// call per motion at most, because the result is cached for everyone.
export async function GET(request: Request) {
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to see prep." }, { status: 401 });

  const limit = await checkRateLimitKey(user.id, { name: "motion-prep", limit: 20, windowMs: 60 * 60_000 });
  if (!limit.ok) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

  const topicId = new URL(request.url).searchParams.get("topicId");
  if (!isDebateId(topicId)) return NextResponse.json({ error: "Unknown motion." }, { status: 400 });

  try {
    const prep = await getMotionPrep(topicId);
    if (!prep) return NextResponse.json({ error: "Unknown motion." }, { status: 404 });
    return NextResponse.json({ prep }, { headers: { "Cache-Control": "private, max-age=3600" } });
  } catch (error) {
    console.error("motion prep failed:", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Prep is not available right now. The debate works without it." }, { status: 503 });
  }
}
