// Ops health report assembly.
//
// Collects each subsystem assessment, rolls them into one overall state and
// lists what is unresolved. It adds no judgement of its own.

import { rollupOverall, type HealthState } from "./core";
import type { TopicHealth, TopicSlo } from "./topic";
import type { JudgeHealth } from "./judge";
import type { DatabaseHealth } from "./database";
import type { AppHealth } from "./app";
import type { CoachingRuntimeHealth, EvidenceSection, TrainingEvidence } from "./evidence";

export interface OpsHealthReport {
  generatedAt: string;
  topic: TopicHealth;
  /** SQLSTATE (5-char) of the failing daily_topics read, when it fails.
   *  Deliberately public-safe: a standard error class, never a message. */
  topicReadSqlstate?: string | null;
  /** Failure-shape matrix labels+classes for the failing topic read
   *  (plain/star/ordered/eqfilter -> ok | fail | class). Public-safe. */
  topicReadShapeMatrix?: string | null;
  /** Production scheduler SLO - independent of CI evidence. */
  topicSlo: TopicSlo;
  judge: JudgeHealth;
  database: DatabaseHealth;
  app: AppHealth;
  human?: EvidenceSection;
  coach?: CoachingRuntimeHealth;
  training?: TrainingEvidence;
  overall: HealthState;
  unknowns: string[];
  notes: string[];
}

export function buildOpsHealthReport(parts: {
  generatedAt: string;
  topic: TopicHealth;
  topicReadSqlstate?: string | null;
  topicReadShapeMatrix?: string | null;
  topicSlo: TopicSlo;
  judge: JudgeHealth;
  database: DatabaseHealth;
  app: AppHealth;
  human?: EvidenceSection;
  coach?: CoachingRuntimeHealth;
  training?: TrainingEvidence;
}): OpsHealthReport {
  const unknowns: string[] = [];
  if (parts.app.status === "unknown") unknowns.push("app/ci");
  if (parts.topicSlo.status === "unknown") unknowns.push("topic-slo");
  if (parts.coach?.status === "unknown") unknowns.push("coach-runtime");
  const notes = [
    parts.topic.note,
    parts.topicSlo.note,
    parts.judge.note,
    parts.database.note,
    parts.app.note,
    parts.coach?.note,
  ].filter((n): n is string => !!n);
  const overallStates = [
    parts.topic.status,
    parts.topicSlo.status,
    parts.judge.status,
    parts.database.status,
    parts.app.status,
    ...(parts.coach ? [parts.coach.status] : []),
  ];
  return {
    ...parts,
    overall: rollupOverall(overallStates),
    unknowns,
    notes,
  };
}
