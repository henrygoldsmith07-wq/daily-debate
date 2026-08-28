// Postgres adapter for the longitudinal Argument DNA view.
//
// The page intentionally reads the already-persisted debate assessments. No
// new judge call is made when somebody opens their profile, so the view stays
// cheap, repeatable, and explainable.

import { createClient } from "./backend/server";
import { assessArgumentGraph, mergeAssessmentGraphs, type ObservableAssessment } from "./observableAssessment";
import type { PvpVerdict } from "./types";
import {
  buildArgumentDna,
  EMPTY_DNA_METRICS,
  graphStatsFor,
  type ArgumentDnaModel,
  type DnaDebateSnapshot,
} from "./argumentDna";
import { extractSkillPoint } from "./skillLedger";
import type { ArgGraph, Owner } from "./argGraph";

type SoloRow = {
  id: string;
  topic_id: string;
  total_score: number | null;
  round_count: number;
  status: string;
  completed_at: string | null;
  created_at: string;
};

type PvpRow = {
  id: string;
  topic_id: string;
  player_a: string;
  player_b: string;
  winner_id: string | null;
  judge_verdict: unknown;
  status: string;
  completed_at: string | null;
  created_at: string;
};

function isAssessment(value: unknown): value is ObservableAssessment {
  return !!value && typeof value === "object" && "graph" in value && !!(value as { graph?: unknown }).graph;
}

function isGraph(value: unknown): value is ArgGraph {
  return !!value && typeof value === "object" && Array.isArray((value as { nodes?: unknown }).nodes) && Array.isArray((value as { edges?: unknown }).edges);
}

function emptySnapshot(params: {
  id: string;
  completedAt: string;
  topicTitle: string;
  format: "solo" | "pvp";
  score: number | null;
  owner: Owner;
  rounds: number;
}): DnaDebateSnapshot {
  return {
    ...params,
    graph: null,
    metrics: EMPTY_DNA_METRICS,
    analysed: false,
    graphStats: graphStatsFor(null, params.owner),
  };
}

function maxRound(graph: ArgGraph | null, fallback: number): number {
  if (!graph?.nodes.length) return fallback;
  return Math.max(fallback, ...graph.nodes.map((node) => node.round));
}

async function soloSnapshots(
  db: Awaited<ReturnType<typeof createClient>>,
  rows: SoloRow[],
  topicTitles: Map<string, string>,
): Promise<DnaDebateSnapshot[]> {
  return Promise.all(
    rows.map(async (row) => {
      const { data: turns } = await db
        .from("solo_debate_turns")
        .select("assessment, scores, round_number")
        .eq("debate_id", row.id)
        .order("round_number", { ascending: true });

      const assessments = (turns ?? [])
        .map((turn) => turn.assessment)
        .filter(isAssessment);
      const completedAt = row.completed_at ?? row.created_at;
      const title = topicTitles.get(row.topic_id) ?? "Daily topic";
      if (!assessments.length) {
        return emptySnapshot({
          id: row.id,
          completedAt,
          topicTitle: title,
          format: "solo",
          score: row.total_score,
          owner: "a",
          rounds: row.round_count,
        });
      }

      const assessment = assessArgumentGraph(mergeAssessmentGraphs(assessments.map((item) => item.graph)), {
        sideA: "a",
        sideB: "ai",
        extractionSource: "deterministic",
        labelA: "You",
        labelB: "AI opponent",
      });
      const clarityValues = (turns ?? [])
        .map((turn) => {
          const scores = turn.scores as { clarity?: unknown } | null;
          return typeof scores?.clarity === "number" ? scores.clarity : null;
        })
        .filter((value): value is number => value !== null);
      const clarity = clarityValues.length
        ? clarityValues.reduce((sum, value) => sum + value, 0) / clarityValues.length
        : null;
      const point = extractSkillPoint(row.id, completedAt, assessment, "a", clarity);
      const graph = assessment.graph;
      return {
        id: row.id,
        completedAt,
        topicTitle: title,
        format: "solo",
        score: row.total_score,
        owner: "a",
        rounds: maxRound(graph, row.round_count),
        graph,
        metrics: point.metrics,
        analysed: true,
        graphStats: graphStatsFor(graph, "a"),
      } satisfies DnaDebateSnapshot;
    }),
  );
}

function pvpSnapshot(row: PvpRow, userId: string, topicTitles: Map<string, string>): DnaDebateSnapshot {
  const verdict = (row.judge_verdict ?? null) as PvpVerdict | null;
  const owner: Owner = row.player_a === userId ? "a" : "b";
  const completedAt = row.completed_at ?? row.created_at;
  const title = topicTitles.get(row.topic_id) ?? "Daily topic";
  const graph = isGraph(verdict?.observableAssessment?.graph)
    ? verdict!.observableAssessment!.graph
    : isGraph(verdict?.argGraph)
      ? verdict!.argGraph
      : null;
  const score = verdict ? (owner === "a" ? verdict.playerAScore : verdict.playerBScore) : null;
  if (!graph) {
    return emptySnapshot({
      id: row.id,
      completedAt,
      topicTitle: title,
      format: "pvp",
      score,
      owner,
      rounds: 0,
    });
  }

  const assessment = isAssessment(verdict?.observableAssessment)
    ? verdict!.observableAssessment!
    : assessArgumentGraph(graph, {
        sideA: "a",
        sideB: "b",
        extractionSource: "deterministic",
        labelA: "Player A",
        labelB: "Player B",
      });
  const point = extractSkillPoint(row.id, completedAt, assessment, owner);
  return {
    id: row.id,
    completedAt,
    topicTitle: title,
    format: "pvp",
    score,
    owner,
    rounds: maxRound(graph, 0),
    graph,
    metrics: point.metrics,
    analysed: true,
    graphStats: graphStatsFor(graph, owner),
  } satisfies DnaDebateSnapshot;
}

export async function buildArgumentDnaForUser(userId: string): Promise<ArgumentDnaModel> {
  const db = await createClient();
  const [{ data: soloRows }, { data: pvpRows }] = await Promise.all([
    db
      .from("solo_debates")
      .select("id, topic_id, total_score, round_count, status, completed_at, created_at")
      .eq("user_id", userId)
      .eq("status", "completed")
      .order("completed_at", { ascending: true })
      .limit(100),
    db
      .from("pvp_matches")
      .select("id, topic_id, player_a, player_b, winner_id, judge_verdict, status, completed_at, created_at")
      .or(`player_a.eq.${userId},player_b.eq.${userId}`)
      .eq("status", "completed")
      .order("completed_at", { ascending: true })
      .limit(100),
  ]);

  const solo = (soloRows ?? []) as unknown as SoloRow[];
  const pvp = (pvpRows ?? []) as unknown as PvpRow[];
  const topicIds = [...new Set([...solo, ...pvp].map((row) => row.topic_id))];
  const topicTitles = new Map<string, string>();
  if (topicIds.length) {
    const { data: topics } = await db.from("daily_topics").select("id, title").in("id", topicIds);
    for (const topic of topics ?? []) topicTitles.set(topic.id, topic.title);
  }

  const [soloDna, pvpDna] = await Promise.all([
    soloSnapshots(db, solo, topicTitles),
    Promise.resolve(pvp.map((row) => pvpSnapshot(row, userId, topicTitles))),
  ]);
  return buildArgumentDna([...soloDna, ...pvpDna]);
}
