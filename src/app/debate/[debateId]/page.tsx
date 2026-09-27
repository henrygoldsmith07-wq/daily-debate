import { notFound } from "next/navigation";
import { createClient } from "@/lib/backend/server";
import AppShell from "@/components/AppShell";
import DebateRoom from "@/components/DebateRoom";
import { assessArgumentGraph, mergeAssessmentGraphs } from "@/lib/observableAssessment";
import type { ObservableAssessment } from "@/lib/observableAssessment";
import { buildResultSnapshot } from "@/lib/resultSnapshot";
import { measurementHonestyFor } from "@/lib/sprint";
import type { CoachingRecord, PersistedSoloResult, SoloDebate, SoloDebateTurn } from "@/lib/types";
import type { CoachDimension } from "@/lib/adaptiveCoach";

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

  // Replay: a finished debate is revisited often, so rebuild the same
  // result story server-side (one strength, one weakness, repair status)
  // instead of dumping the graph and transcript on the user.
  let completedResult:
    | {
        totalScore: number;
        argGraph?: ObservableAssessment["graph"];
        snapshot: ReturnType<typeof buildResultSnapshot> | null;
        repaired: boolean;
        honestyNote: string | null;
        summary?: PersistedSoloResult["summary"];
        bonusXP?: number;
        rewardEvents?: PersistedSoloResult["rewardEvents"];
        trainingSummary?: PersistedSoloResult["trainingSummary"];
        summarySource?: PersistedSoloResult["summarySource"];
      }
    | null = null;
  if (debate.status === "completed") {
    const persisted = debate.result_payload && typeof debate.result_payload === "object"
      ? (debate.result_payload as PersistedSoloResult)
      : null;
    const persistedAssessment = persisted?.assessment && typeof persisted.assessment === "object" && "graph" in persisted.assessment
      ? (persisted.assessment as ObservableAssessment)
      : null;
    const assessments = (turns ?? [])
      .map((t) => t.assessment as ObservableAssessment | null)
      .filter((a): a is ObservableAssessment => !!a);
    const finalAssessment = persistedAssessment ?? (
      assessments.length
        ? assessArgumentGraph(mergeAssessmentGraphs(assessments.map((a) => a.graph)), {
            sideA: "a",
            sideB: "ai",
            extractionSource: "deterministic",
            labelA: "You",
            labelB: "AI opponent",
          })
        : null
    );
    const coaching = (debate.coaching ?? null) as CoachingRecord | null;
    const goalDimension = (coaching?.dimension ?? null) as CoachDimension | null;
    const rebuiltSnapshot = finalAssessment
      ? buildResultSnapshot(finalAssessment, {
          format: debate.format === "sprint" ? "sprint" : "full",
          goalDimension,
        })
      : null;
    const persistedSnapshot = persisted?.snapshot && typeof persisted.snapshot === "object"
      ? (persisted.snapshot as ReturnType<typeof buildResultSnapshot>)
      : null;

    const { data: repair } = await db
      .from("repair_results")
      .select("id, created_at")
      .eq("debate_id", debateId)
      .eq("succeeded", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    completedResult = {
      totalScore: debate.total_score ?? 0,
      argGraph: persistedAssessment?.graph ?? finalAssessment?.graph,
      snapshot: persistedSnapshot ?? rebuiltSnapshot,
      repaired: !!repair,
      honestyNote: persisted?.honesty?.note ?? measurementHonestyFor(debate.format === "sprint" ? "sprint" : "full").note,
      summary: persisted?.summary,
      bonusXP: persisted?.bonusXP,
      rewardEvents: persisted?.rewardEvents,
      trainingSummary: persisted?.trainingSummary,
      summarySource: persisted?.summarySource,
    };
  }

  return (
    <AppShell width="narrow">
      <DebateRoom
        debate={debate as unknown as SoloDebate}
        topic={topic}
        initialTurns={(turns ?? []) as unknown as SoloDebateTurn[]}
        completedResult={completedResult}
      />
    </AppShell>
  );
}
