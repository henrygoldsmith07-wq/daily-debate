import "server-only";

import type { BackendClient } from "@/lib/backend/client";
import type { ObservableAssessment } from "@/lib/observableAssessment";
import { countWeaknessesForSide } from "@/lib/repairEffectiveness";
import { mergeSoloAssessmentsByDebate } from "@/lib/soloAssessmentHistory";
import { MAX_ROUNDS } from "@/lib/types";

export type SoloFinalizationContextFailureStage =
  | "topic"
  | "prior-debates"
  | "prior-turns";

export type SoloFinalizationContextResult =
  | {
      ok: true;
      topic: { title: string; category: string | null };
      priorAssessments: ObservableAssessment[];
      priorDebateKinds: Array<{ completedAt: string; kinds: Record<string, number> }>;
    }
  | {
      ok: false;
      stage: SoloFinalizationContextFailureStage;
      message: string;
    };

export async function loadSoloFinalizationContext(params: {
  db: BackendClient;
  userId: string;
  debateId: string;
  topicId: string;
}): Promise<SoloFinalizationContextResult> {
  const { db, userId, debateId, topicId } = params;

  const { data: topic, error: topicError } = await db
    .from("daily_topics")
    .select("title, category")
    .eq("id", topicId)
    .single();
  if (topicError || !topic) {
    return {
      ok: false,
      stage: "topic",
      message: topicError?.message ?? "Topic row unavailable.",
    };
  }

  const { data: priorDebates, error: priorDebatesError } = await db
    .from("solo_debates")
    .select("id, completed_at")
    .eq("user_id", userId)
    .eq("status", "completed")
    .neq("id", debateId)
    .order("completed_at", { ascending: false })
    .limit(5);
  if (priorDebatesError) {
    return {
      ok: false,
      stage: "prior-debates",
      message: priorDebatesError.message,
    };
  }

  if (!priorDebates?.length) {
    return { ok: true, topic, priorAssessments: [], priorDebateKinds: [] };
  }

  const { data: priorTurns, error: priorTurnsError } = await db
    .from("solo_debate_turns")
    .select("debate_id, assessment")
    .in("debate_id", priorDebates.map((debate) => debate.id))
    .not("assessment", "is", null)
    .order("round_number", { ascending: true })
    .limit(priorDebates.length * MAX_ROUNDS);
  if (priorTurnsError) {
    return {
      ok: false,
      stage: "prior-turns",
      message: priorTurnsError.message,
    };
  }

  const mergedByDebate = mergeSoloAssessmentsByDebate(
    (priorTurns ?? []) as Array<{ debate_id: string; assessment: unknown }>,
  );

  const priorAssessments = priorDebates
    .map((debate) => mergedByDebate.get(debate.id) ?? null)
    .filter((assessment): assessment is ObservableAssessment => assessment !== null);

  const priorDebateKinds = priorDebates
    .map((debate) => {
      const merged = mergedByDebate.get(debate.id);
      if (!merged) return null;
      return {
        completedAt: debate.completed_at ?? new Date().toISOString(),
        kinds: countWeaknessesForSide(merged.graph, "a"),
      };
    })
    .filter((value): value is { completedAt: string; kinds: Record<string, number> } => value !== null)
    .reverse();

  return { ok: true, topic, priorAssessments, priorDebateKinds };
}
