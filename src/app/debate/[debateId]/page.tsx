import { notFound } from "next/navigation";
import { createClient } from "@/lib/backend/server";
import AppHeader from "@/components/AppHeader";
import DebateRoom from "@/components/DebateRoom";
import { assessArgumentGraph, mergeAssessmentGraphs } from "@/lib/observableAssessment";
import type { ObservableAssessment } from "@/lib/observableAssessment";
import type { SoloDebate, SoloDebateTurn } from "@/lib/types";

export default async function DebatePage({ params }: { params: Promise<{ debateId: string }> }) {
  const { debateId } = await params;
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) notFound();

  const { data: debate } = await db
    .from("solo_debates")
    .select("*")
    .eq("id", debateId)
    .eq("user_id", user.id)
    .single();
  if (!debate) notFound();

  const { data: topic } = await db.from("daily_topics").select("*").eq("id", debate.topic_id).single();
  if (!topic) notFound();

  const { data: turns } = await db
    .from("solo_debate_turns")
    .select("*")
    .eq("debate_id", debateId)
    .order("round_number", { ascending: true });

  // Replay: a finished debate is revisited often, so recompute the merged
  // argument graph + assessment server-side instead of showing a bare transcript.
  let completedResult: { totalScore: number; argGraph?: ObservableAssessment["graph"] } | null = null;
  if (debate.status === "completed") {
    const assessments = (turns ?? [])
      .map((t) => t.assessment as ObservableAssessment | null)
      .filter((a): a is ObservableAssessment => !!a);
    const finalAssessment = assessments.length
      ? assessArgumentGraph(mergeAssessmentGraphs(assessments.map((a) => a.graph)), {
          sideA: "a",
          sideB: "ai",
          extractionSource: "deterministic",
          labelA: "You",
          labelB: "AI opponent",
        })
      : null;
    completedResult = { totalScore: debate.total_score ?? 0, argGraph: finalAssessment?.graph };
  }

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader />
      <main id="main" className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 py-8">
        <DebateRoom
          debate={debate as unknown as SoloDebate}
          topic={topic}
          initialTurns={(turns ?? []) as unknown as SoloDebateTurn[]}
          completedResult={completedResult}
        />
      </main>
    </div>
  );
}
