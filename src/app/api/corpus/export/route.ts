import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/backend/server";
import { getRequestAuthContext } from "@/lib/requestAuth";
import { checkRateLimit } from "@/lib/rateLimit";
import { raterLabelsInOrder } from "@/lib/corpusRaterAnonymity";

// Admin-only CSV export of the human-rating corpus: ratings and items,
// bounded and anonymised exactly like the rater view (no contributor ids and
// no rater account ids -- raters are Rater 1..N in submission order).
// Output is for analysis; it is not a modification path — ratings stay
// append-once and corrections stay on the admin correction route.

const LIMITS = { ratings: 5000, items: 2000 };

function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvRow(cells: unknown[]): string {
  return cells.map(csvCell).join(",");
}

export async function GET(request: Request) {
  // Bounded: a full export is an expensive read of the whole corpus.
  const limited = await checkRateLimit(request, { name: "corpus-export", limit: 10, windowMs: 60_000 });
  if (limited) return limited;

  // Admin access is the TWO-FACTOR gate (database role + allowlist), not the
  // email allowlist alone — see src/lib/adminAccess.ts.
  const auth = await getRequestAuthContext();
  const user = auth.user;
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!auth.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const service = createServiceClient();
  const [{ data: ratings }, { data: items }] = await Promise.all([
    service
      .from("corpus_ratings")
      .select("corpus_id, rater_id, winner, confidence, scores_a, scores_b, presented_first, created_at")
      .order("created_at", { ascending: true })
      .limit(LIMITS.ratings),
    service
      .from("corpus_items")
      .select("id, topic, status, length_bucket, ability_band, dynamics_tier, subject_category, rating_count")
      .order("created_at", { ascending: true })
      .limit(LIMITS.items),
  ]);

  // Same blind labels the item view uses. The SELECT keeps rater_id only to
  // build the stable mapping; the raw account id never reaches the CSV.
  const orderedRatings = (ratings ?? []) as Array<Record<string, unknown>>;
  const raterLabels = raterLabelsInOrder(orderedRatings.map((r) => String(r.rater_id)));
  const lines: string[] = [];
  lines.push("# corpus_ratings (append-once; corrections live on the admin correction route)");
  lines.push(csvRow(["corpus_id", "rater", "winner", "confidence", "scores_a", "scores_b", "presented_first", "created_at"]));
  for (const r of orderedRatings) {
    lines.push(
      csvRow([
        r.corpus_id,
        raterLabels.get(String(r.rater_id)),
        r.winner,
        r.confidence,
        JSON.stringify(r.scores_a ?? {}),
        JSON.stringify(r.scores_b ?? {}),
        r.presented_first ?? "a",
        r.created_at,
      ]),
    );
  }
  if ((ratings ?? []).length >= LIMITS.ratings) {
    lines.push(`# note: ratings export truncated at ${LIMITS.ratings} rows`);
  }

  lines.push("");
  lines.push("# corpus_items (no contributor ids — anonymised like the rater view)");
  lines.push(csvRow(["id", "topic", "status", "length_bucket", "ability_band", "dynamics_tier", "subject_category", "rating_count"]));
  for (const i of (items ?? []) as Array<Record<string, unknown>>) {
    lines.push(
      csvRow([
        i.id,
        i.topic,
        i.status,
        i.length_bucket,
        i.ability_band,
        i.dynamics_tier,
        i.subject_category,
        i.rating_count ?? 0,
      ]),
    );
  }
  if ((items ?? []).length >= LIMITS.items) {
    lines.push(`# note: items export truncated at ${LIMITS.items} rows`);
  }

  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="corpus-export-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
