import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import AppShell from "@/components/AppShell";
import ClaimsPanel from "@/components/ClaimsPanel";
import ExploreVote from "@/components/ExploreVote";
import ReportDebate from "@/components/ReportDebate";
import { getCurrentUser } from "@/lib/currentViewer";
import { getExploreDebate } from "@/lib/explore";

export const dynamic = "force-dynamic";

// A shared link should name the motion and both debaters, not the app.
export async function generateMetadata({ params }: { params: Promise<{ kind: string; id: string }> }): Promise<Metadata> {
  const { kind, id } = await params;
  if (kind !== "solo" && kind !== "pvp") return {};
  const debate = await getExploreDebate(null, kind, id).catch(() => null);
  if (!debate) return {};
  const description = `${debate.for.name} for, ${debate.against.name} against. Read both sides and vote on who argued better.`;
  return {
    title: `${debate.topicTitle} · Daily Debate`,
    description,
    openGraph: { title: debate.topicTitle, description },
  };
}

export default async function ExploreDebatePage({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  if (kind !== "solo" && kind !== "pvp") notFound();
  const user = await getCurrentUser();
  const debate = await getExploreDebate(user?.id ?? null, kind, id);
  if (!debate) notFound();

  const rounds = [...new Set(debate.turns.map((turn) => turn.round))].sort((a, b) => a - b);

  return (
    <AppShell width="narrow">
      <p className="text-xs">
        <Link href="/explore" className="text-ink3 hover:underline">← Explore</Link>
      </p>
      <header className="flex flex-col gap-2">
        <p className="explore-card-kind">{debate.kind === "pvp" ? "Player vs player" : "Versus the AI"}</p>
        <h1 className="page-title">{debate.topicTitle}</h1>
        <p className="text-sm text-ink3">
          <strong className="text-ink">{debate.for.name}</strong> for · <strong className="text-ink">{debate.against.name}</strong> against
        </p>
      </header>

      <section className="explore-transcript surface-card" aria-label="The debate, round by round" data-testid="explore-transcript">
        {rounds.map((round) => (
          <div key={round} className="explore-round">
            <p className="explore-round-label">Round {round}</p>
            <div className="explore-round-sides">
              {(["for", "against"] as const).map((side) => (
                <div key={side} className={`explore-turn explore-turn-${side}`}>
                  {debate.turns
                    .filter((turn) => turn.round === round && turn.side === side)
                    .map((turn, index) => (
                      <p key={index}>
                        <span className="explore-turn-speaker">{turn.speaker}</span>
                        {turn.text}
                      </p>
                    ))}
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>

      <section className="surface-card p-5">
        <ExploreVote
          kind={debate.kind}
          id={debate.id}
          forName={debate.for.name}
          againstName={debate.against.name}
          initialVotes={debate.votes}
          initialMyVote={debate.myVote}
          isParticipant={debate.isParticipant}
          signedIn={Boolean(user)}
        />
        {user && !debate.isParticipant ? <ReportDebate kind={debate.kind} id={debate.id} /> : null}
      </section>

      <ClaimsPanel sources={debate.turns.map((turn) => ({ speaker: turn.speaker, side: turn.side, round: turn.round, text: turn.text }))} />
    </AppShell>
  );
}
