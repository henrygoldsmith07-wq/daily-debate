import Link from "next/link";
import { createClient } from "@/lib/backend/server";
import AppShell from "@/components/AppShell";
import SignedOut from "@/components/SignedOut";
import PageHeader from "@/components/PageHeader";
import type { PvpVerdict } from "@/lib/types";
import { normalizeIanaTimeZone } from "@/lib/timeZone";
import { loadJudgeValidation } from "@/lib/judgeValidationServer";
import { allowsCompetitiveClaims } from "@/lib/judgeValidation";
import { framePvpOutcome } from "@/lib/pvpOutcomeFraming";
import { experimentalSurfacesEnabled } from "@/lib/featureFlags";
import { buildJourneyInputsForUser } from "@/lib/skillJourneyServer";
import { historyLoopMap, type HistoryLoopState } from "@/lib/historyLoop";

export const dynamic = "force-dynamic";

const HISTORY_LIMIT = 50;

function formatDate(iso: string | null, timeZone: string): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone,
  }).format(new Date(iso));
}

export default async function HistoryPage() {
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();

  if (!user) {
    return (
      <AppShell width="narrow">
        <SignedOut
          title="Sign in to see your debate history"
          description={
            experimentalSurfacesEnabled()
              ? "Your finished debates, scores and PvP results are kept with your account."
              : "Your finished debates and the feedback on each one are kept with your account."
          }
        />
      </AppShell>
    );
  }

  const [soloRes, pvpRes, profileRes] = await Promise.all([
    db
      .from("solo_debates")
      .select("id, status, side, round_count, total_score, performance_score, bonus_xp, created_at, completed_at, topic_id")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(HISTORY_LIMIT),
    db
      .from("pvp_matches")
      .select("id, status, player_a, player_b, winner_id, judge_verdict, completed_at, topic_id")
      .or(`player_a.eq.${user.id},player_b.eq.${user.id}`)
      .order("created_at", { ascending: false })
      .limit(HISTORY_LIMIT),
    // The timezone only formats dates. A missing profile row is normal (the
    // row is created on first use), so this read must never be able to blank
    // the history: .maybeSingle() does not error on zero rows, and the error
    // is deliberately excluded from loadError below.
    db.from("profiles").select("timezone").eq("id", user.id).maybeSingle(),
  ]);

  const timeZone = normalizeIanaTimeZone(profileRes.data?.timezone);
  const soloDebates = soloRes.data ?? [];
  const pvpMatches = pvpRes.data ?? [];
  // The single gate that unlocks won/lost framing anywhere in the product.
  // Computed once per render from the published benchmark artifact, so the
  // history list and the result screen can never disagree.
  const pvpValidation = loadJudgeValidation().surfaces["pvp-verdict"];
  const competitiveClaimsAllowed = allowsCompetitiveClaims(pvpValidation);
  // A failed read must not look like an empty history. Previously a DB error
  // produced `[]`, which rendered the same "No solo debates yet" empty state as
  // a genuine first visit — indistinguishable data loss.
  // The timezone read is excluded on purpose: it only formats dates, so a
  // missing profile row or a transient failure of that cosmetic read must not
  // replace the learner's whole record with an error card.
  // PvP is parked behind the experimental flag. A new user with the flag off
  // should not see "0 PvP shown" for a mode they cannot reach; anyone with
  // real PvP records still sees them.
  const showPvp = experimentalSurfacesEnabled() || pvpMatches.length > 0;
  const loadError = soloRes.error ?? pvpRes.error ?? null;
  const topicIds = [...new Set([...soloDebates, ...pvpMatches].map((row) => row.topic_id))];
  const topicTitles = new Map<string, string>();
  if (topicIds.length) {
    const { data: topics } = await db.from("daily_topics").select("id, title").in("id", topicIds);
    for (const t of topics ?? []) topicTitles.set(t.id, t.title);
  }

  // Loop state per debate (repaired? finished retest verdict?). Cosmetic and
  // read-only: a failure here must never blank the record, so it degrades to
  // no badges.
  let loopStates = new Map<string, HistoryLoopState>();
  if (!loadError && soloDebates.length) {
    try {
      const journey = await buildJourneyInputsForUser(user.id);
      loopStates = historyLoopMap(soloDebates.map((d) => d.id), journey.repairs);
    } catch {
      loopStates = new Map();
    }
  }

  if (loadError) {
    return (
      <AppShell width="narrow">
        <PageHeader eyebrow="Your practice" title="History" description={showPvp ? "Your solo and PvP debate records" : "Your debate records"} />
        <div className="surface-card p-5" role="alert">
          <p className="text-sm font-semibold text-[var(--bad)]">History could not be loaded</p>
          <p className="mt-1 text-sm text-ink3">
            Your debates are safe — this is a temporary read problem. Reload to try again.
          </p>
          <Link href="/history" className="btn btn-ghost mt-3 px-3 py-1.5 text-xs">
            Reload history
          </Link>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell width="narrow">
      <PageHeader
        eyebrow="Your record"
        title="Your debates"
        description={
          showPvp
            ? `Latest debates, newest first. Up to ${HISTORY_LIMIT} solo and ${HISTORY_LIMIT} PvP records are shown.`
            : `Latest debates, newest first. Up to ${HISTORY_LIMIT} are shown.`
        }
        actions={
          <>
            <span className="pill tabular">{soloDebates.length} solo shown</span>
            {showPvp && <span className="pill tabular">{pvpMatches.length} PvP shown</span>}
          </>
        }
      />

      <section className="flex flex-col gap-3">
        <div className="section-heading">
          <h2>Solo</h2>
          <span className="section-heading-note">Against the AI opponent</span>
        </div>
        {soloDebates.length === 0 ? (
          /* Matches the app's own SignedOut standard: a card with a reason and
             a next action, not a bare sentence. A dead end here is the difference
             between a first-time user finding the debate button and leaving. */
          <div className="surface-card flex flex-col items-start gap-2 p-5">
            <p className="font-semibold">Your first solo debate is waiting</p>
            <p className="text-sm text-ink3">
              Finish a debate and it appears here with its performance, XP and the weakness worth repairing.
            </p>
            <Link href="/" className="btn btn-primary mt-1 px-4 py-2 text-sm">
              Start today&apos;s debate
            </Link>
          </div>
        ) : (
          soloDebates.map((d) => {
            const performance = d.performance_score;
            const xp = (d.total_score ?? 0) + (d.bonus_xp ?? 0);
            return (
            <Link
              key={d.id}
              href={`/debate/${d.id}`}
              className="surface-card flex items-center justify-between gap-3 px-4 py-3 text-sm hover:border-[var(--accent)]"
            >
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-medium">{topicTitles.get(d.topic_id) ?? "Daily topic"}</span>
                <span className="text-xs text-ink3">
                  {formatDate(d.completed_at ?? d.created_at, timeZone)} · arguing {d.side} · {d.round_count} rounds
                </span>
                {d.status === "completed" && loopStates.get(d.id) && (
                  <span className="mt-1 flex flex-wrap gap-1" data-testid="history-loop-state">
                    {loopStates.get(d.id)?.repair && (
                      <span className="pill text-xs">
                        {loopStates.get(d.id)?.repair === "repaired" ? "Weakness repaired" : "Repair attempted"}
                      </span>
                    )}
                    {loopStates.get(d.id)?.retest && (
                      <span className="pill text-xs">Retest: {loopStates.get(d.id)?.retest?.label}</span>
                    )}
                  </span>
                )}
              </span>
              <span className="shrink-0 text-right">
                {d.status === "completed" ? (
                  <>
                    <span className="block tabular font-medium">
                      {performance === null ? "Performance unavailable" : `${performance}/100 performance`}
                    </span>
                    <span className="block text-xs text-ink3">+{xp} XP</span>
                  </>
                ) : (
                  <span className="text-xs text-[var(--accent)]">resume →</span>
                )}
              </span>
            </Link>
            );
          })
        )}
      </section>

      {showPvp && (
      <section className="flex flex-col gap-3">
        <div className="section-heading">
          <h2>Player vs player</h2>
          <span className="section-heading-note">Judged head-to-head</span>
        </div>
        {pvpMatches.length === 0 ? (
          <div className="surface-card flex flex-col items-start gap-2 p-5">
            <p className="font-semibold">No player-vs-player matches yet</p>
            <p className="text-sm text-ink3">
              Challenge a friend to argue today&apos;s motion, or join the queue when PvP is open.
            </p>
            <Link href="/pvp" className="btn btn-ghost mt-1 px-4 py-2 text-sm">
              Go to PvP
            </Link>
          </div>
        ) : (
          pvpMatches.map((m) => {
            const verdict = m.judge_verdict as PvpVerdict | null;
            // Only a judge that cleared every validation gate unlocks
            // won/lost framing anywhere in the product — the same gate the
            // result screen reads, applied to this list too.
            const framed = framePvpOutcome({
              winnerId: m.winner_id,
              currentUserId: user.id,
              nameFor: () => "Opponent",
              competitiveClaimsAllowed,
              isForfeit: verdict?.scoreStatus === "insufficient_evidence" && verdict.isTie !== true,
              isTie: verdict?.isTie === true,
            });
            const isForfeit = verdict?.scoreStatus === "insufficient_evidence" && verdict.isTie !== true;
            // A one-line list label. The row is too narrow for the full
            // attribution sentence (that lives on the match page), so the
            // judge-scored reading keeps who it favoured and drops the
            // justification. "won"/"lost" only ever appear once a benchmarked
            // model has cleared every gate.
            //
            // A forfeit is NOT a judge decision: the framing module's own
            // attribution says no judge score was produced, so the list must
            // not say "judge scored". It ends by forfeit, and says so.
            const outcome =
              m.status !== "completed"
                ? "in progress"
                : isForfeit
                  ? framed.headline
                  : framed.attribution
                    ? m.winner_id === user.id
                      ? "judge scored · for you"
                      : "judge scored · for opponent"
                    : framed.headline;
            // Colour only a real, gated win or loss. A tie, a forfeit and a
            // match still running are neutral: colouring a draw as a loss
            // says something the text does not.
            const gatedOutcome =
              m.status === "completed" && competitiveClaimsAllowed && !isForfeit && m.winner_id !== null;
            const tone = !gatedOutcome ? "neutral" : m.winner_id === user.id ? "win" : "loss";
            return (
              <Link
                key={m.id}
                href={`/pvp/${m.id}`}
                className="surface-card flex items-center justify-between gap-3 px-4 py-3 text-sm hover:border-[var(--accent)]"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">{topicTitles.get(m.topic_id) ?? "Daily topic"}</span>
                  <span className="text-xs text-ink3">{formatDate(m.completed_at, timeZone)}</span>
                </span>
                <span className="shrink-0 text-right">
                  <span
                    className={`tabular font-medium ${
                      tone === "win" ? "text-[var(--accent)]" : tone === "loss" ? "text-[var(--bad)]" : ""
                    }`}
                  >
                    {outcome}
                  </span>
                  {verdict && verdict.scoreStatus !== "insufficient_evidence" && m.winner_id !== null && (
                    <span className="block text-xs text-ink3 tabular">
                      {verdict.playerAScore}–{verdict.playerBScore}
                    </span>
                  )}
                </span>
              </Link>
            );
          })
        )}
      </section>
      )}
    </AppShell>
  );
}
