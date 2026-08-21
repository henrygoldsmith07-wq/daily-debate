import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rateLimit";
import { getOrCreateTodayTopic } from "@/lib/dailyTopic";

export async function GET(request: Request) {
  // First request of the day triggers a paid model call; keep that path
  // rate-limited like every other route.
  const limited = await checkRateLimit(request, { name: "daily-topic", limit: 30, windowMs: 60_000 });
  if (limited) return limited;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const topic = await getOrCreateTodayTopic();
    return NextResponse.json({ topic });
  } catch (error) {
    console.error("Failed to load daily topic:", error);
    return NextResponse.json({ error: "Failed to load today's topic." }, { status: 500 });
  }
}
