import { NextResponse } from "next/server";
import { createClient } from "@/lib/backend/server";
import { checkRateLimitKey } from "@/lib/rateLimit";
import { queryRows } from "@/lib/backend/sql";

/**
 * UK GDPR data export: one statement returns a consistent snapshot of every
 * row attributable to the signed-in user (account, debates, turns, matches,
 * events, progress, corpus contributions, reports/appeals they filed or are
 * the subject of). Excludes password hashes and rate-limit buckets.
 */
const EXPORT_SQL = `
select jsonb_build_object(
  'exportedAt', now(),
  'account', (select jsonb_build_object('id', u.id, 'email', u.email, 'createdAt', u.created_at)
                from app_users u where u.id = $1),
  'profile', (select to_jsonb(p) from profiles p where p.id = $1),
  'soloDebates', (select coalesce(jsonb_agg(to_jsonb(d) order by d.created_at), '[]'::jsonb)
                    from solo_debates d where d.user_id = $1),
  'soloTurns', (select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at), '[]'::jsonb)
                  from solo_debate_turns t
                 where t.debate_id in (select id from solo_debates where user_id = $1)),
  'pvpMatches', (select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at), '[]'::jsonb)
                   from pvp_matches m
                  where m.player_a = $1 or m.player_b = $1 or m.current_turn_player = $1 or m.winner_id = $1),
  'pvpTurns', (select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at), '[]'::jsonb)
                 from pvp_turns t
                where t.match_id in (select id from pvp_matches where player_a = $1 or player_b = $1)),
  'productEvents', (select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at), '[]'::jsonb)
                      from product_events e where e.user_id = $1),
  'drillAssignments', (select coalesce(jsonb_agg(to_jsonb(d) order by d.created_at), '[]'::jsonb)
                         from drill_assignments d where d.user_id = $1),
  'repairResults', (select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at), '[]'::jsonb)
                      from repair_results r where r.user_id = $1),
  'repairRetests', (select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at), '[]'::jsonb)
                      from repair_retests r where r.user_id = $1),
  'challengeInvites', (select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at), '[]'::jsonb)
                         from challenge_invites c where c.challenger_id = $1 or c.opponent_id = $1),
  'corpusRatings', (select coalesce(jsonb_agg(to_jsonb(cr) order by cr.created_at), '[]'::jsonb)
                      from corpus_ratings cr where cr.rater_id = $1),
  'corpusContributions', (select coalesce(jsonb_agg(to_jsonb(ci) order by ci.created_at), '[]'::jsonb)
                            from corpus_items ci where ci.contributor_id = $1),
  'reports', (select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at), '[]'::jsonb)
                from reports r where r.filed_by = $1 or r.target_user_id = $1),
  'matchAppeals', (select coalesce(jsonb_agg(to_jsonb(ma) order by ma.created_at), '[]'::jsonb)
                     from match_appeals ma where ma.filed_by = $1),
  'categoryExposure', (select coalesce(jsonb_agg(to_jsonb(uce) order by uce.first_seen_at), '[]'::jsonb)
                         from user_category_exposure uce where uce.user_id = $1)
) as export
`;

export async function GET() {
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limit = await checkRateLimitKey(user.id, { name: "account-export", limit: 5, windowMs: 15 * 60_000 });
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many export requests. Please wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds), "Cache-Control": "no-store" } },
    );
  }

  try {
    const rows = await queryRows<{ export: Record<string, unknown> }>(EXPORT_SQL, [user.id]);
    const payload = rows[0]?.export;
    if (!payload) return NextResponse.json({ error: "Export could not be assembled." }, { status: 500 });
    const stamp = new Date().toISOString().slice(0, 10);
    return NextResponse.json(payload, {
      headers: {
        "Content-Disposition": `attachment; filename="daily-debate-export-${stamp}.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Account export failed:", error);
    return NextResponse.json({ error: "Export failed. Please retry." }, { status: 500 });
  }
}
