import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient, createServiceClient } from "@/lib/backend/server";
import AppShell from "@/components/AppShell";
import { isValidChallengeCode, opponentSideOf } from "@/lib/friendChallenge";
import AcceptChallengeButton from "@/components/AcceptChallengeButton";

export const dynamic = "force-dynamic";

interface InviteWithJoins {
  id: string;
  code: string;
  status: string;
  challenger_id: string;
  challenger_side: string;
  expires_at: string;
  opponent_id: string | null;
  match_id: string | null;
  daily_topics: { title: string } | null;
  profiles: { username: string | null } | null;
}

type ChallengeStatus = "open" | "accepted" | "expired" | "cancelled";

function challengeStatusFor(invite: InviteWithJoins): ChallengeStatus {
  const expired = new Date(invite.expires_at).getTime() < Date.now();
  return expired && invite.status === "open" ? "expired" : (invite.status as ChallengeStatus);
}

export default async function ChallengePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  if (!isValidChallengeCode(code)) notFound();

  const service = createServiceClient();
  const { data: inviteRow } = await service
    .from("challenge_invites")
    .select("id, code, status, challenger_id, challenger_side, expires_at, opponent_id, match_id, topic_id, daily_topics(title), profiles!challenge_invites_challenger_id_fkey(username)")
    .eq("code", code)
    .maybeSingle();
  if (!inviteRow) notFound();
  const invite = inviteRow as unknown as InviteWithJoins;

  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();

  const effectiveStatus = challengeStatusFor(invite);
  const motion = invite.daily_topics?.title ?? "Today's motion";
  const challengerName = invite.profiles?.username ?? "A debater";
  const isOwn = user?.id === invite.challenger_id;

  // Accepted challenges route straight into the match.
  if (effectiveStatus === "accepted" && invite.match_id) {
    const { data: match } = await db
      .from("pvp_matches")
      .select("id")
      .eq("id", invite.match_id)
      .or(`player_a.eq.${user?.id ?? "00000000-0000-0000-0000-000000000000"},player_b.eq.${user?.id ?? "00000000-0000-0000-0000-000000000000"}`)
      .single();
    if (match) {
      return (
        <AppShell width="narrow">
          <div className="surface-card flex flex-col items-center gap-4 p-8 text-center">
            <h1 className="text-lg font-semibold">Challenge in progress</h1>
            <p className="text-sm text-ink3">{motion}</p>
            <Link href={`/pvp/${match.id}`} className="btn btn-primary px-4 py-2 text-sm">
              Go to the match →
            </Link>
          </div>
        </AppShell>
      );
    }
  }

  const turnNote =
    effectiveStatus === "cancelled"
      ? "This challenge was cancelled."
      : effectiveStatus === "expired"
        ? "This challenge has expired."
        : effectiveStatus === "accepted"
          ? "This challenge has been accepted."
          : `${challengerName} is waiting for a response — you have until ${new Date(invite.expires_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}.`;

  return (
    <AppShell width="narrow">
      <div className="surface-card flex flex-col gap-5 p-6 text-center" data-testid="challenge-card">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--accent)]">Debate challenge</p>
          <h1 className="mt-1 text-xl font-semibold">
            {challengerName} challenges you
          </h1>
        </div>

        <div className="rounded-lg border border-[var(--rule)] bg-surface-2 p-4 text-left">
          <p className="text-xs uppercase tracking-[0.14em] text-ink3">Motion</p>
          <p className="mt-1 text-sm font-semibold">{motion}</p>
          <p className="mt-2 text-sm font-medium">
            {challengerName}: <span className="uppercase">{invite.challenger_side}</span>
            <span className="mx-3 text-ink3">·</span>
            You: <span className="uppercase">{opponentSideOf(invite.challenger_side)}</span>
          </p>
        </div>

        <p className="text-sm text-ink3" role="status">
          {turnNote}
        </p>

        {effectiveStatus === "open" && !isOwn && (
          <AcceptChallengeButton code={code} signedIn={!!user} />
        )}
        {isOwn && effectiveStatus === "open" && (
          <p className="text-sm text-ink3">This is your challenge — share the link <span className="font-mono">/challenge/{code}</span> with a friend.</p>
        )}

        <Link href="/" className="text-xs text-ink3 underline underline-offset-2 hover:text-ink2">
          Back to today&apos;s debate
        </Link>
      </div>
    </AppShell>
  );
}
