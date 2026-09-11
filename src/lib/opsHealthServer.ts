import "server-only";
import fs from "node:fs";
import path from "node:path";
import { createServiceClient } from "./backend/server";
import type { TableName } from "./backend/query";
import {
  assessAppHealth,
  assessDatabaseHealth,
  assessJudgeHealth,
  assessTopicHealth,
  buildOpsHealthReport,
  type OpsHealthReport,
  type WorkflowStatusInput,
} from "./opsHealth";

// Server-side data gathering for the operational-health report. All state
// interpretation lives in the pure opsHealth.ts assessors (unit-tested);
// this module only fetches. Every source degrades gracefully: a failed
// source yields "unknown"/"blocked", never green and never a throw.

const REPO = "henrygoldsmith07-wq/daily-debate";
export const CI_ACTIONS_URL = `https://github.com/${REPO}/actions`;

/** Tables the background systems require (topics, corpus, repairs, events, ledger). */
const REQUIRED_TABLES: TableName[] = [
  "daily_topics",
  "topic_evidence",
  "corpus_items",
  "corpus_ratings",
  "repair_results",
  "product_events",
  "app_migrations",
];

const CI_WORKFLOWS = ["daily-debate.yml", "judge-benchmark.yml", "topic-generation.yml"];

async function fetchWorkflowRuns(token: string): Promise<WorkflowStatusInput[] | null> {
  try {
    const runs: WorkflowStatusInput[] = [];
    for (const workflow of CI_WORKFLOWS) {
      const res = await fetch(
        `https://api.github.com/repos/${REPO}/actions/workflows/${workflow}/runs?per_page=1&branch=main`,
        {
          headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
          signal: AbortSignal.timeout(8000),
        },
      );
      if (!res.ok) return null;
      const data = (await res.json()) as {
        workflow_runs?: Array<{ name?: string; status?: string; conclusion?: string | null }>;
      };
      const run = data.workflow_runs?.[0];
      if (!run) return null;
      runs.push({
        name: run.name ?? workflow,
        status: (run.status as WorkflowStatusInput["status"]) ?? null,
        conclusion: run.conclusion ?? null,
      });
    }
    return runs;
  } catch {
    return null;
  }
}

function readJudgeArtifact(): {
  at: string;
  limit: number | null;
  allPass: boolean | null;
  models: string[];
} | null {
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), "docs", "latest-judge-benchmark.json"), "utf8");
    const parsed = JSON.parse(raw) as {
      at?: unknown;
      limit?: unknown;
      allPass?: unknown;
      results?: unknown;
    };
    if (typeof parsed.at !== "string") return null;
    const results = Array.isArray(parsed.results) ? parsed.results : [];
    return {
      at: parsed.at,
      limit: typeof parsed.limit === "number" ? parsed.limit : null,
      allPass: typeof parsed.allPass === "boolean" ? parsed.allPass : null,
      models: results
        .map((r) => (r && typeof r === "object" && "model" in r ? String((r as { model: unknown }).model) : null))
        .filter((m): m is string => !!m),
    };
  } catch {
    return null;
  }
}

export async function loadOpsHealth(nowIso?: string): Promise<OpsHealthReport> {
  const now = nowIso ?? new Date().toISOString();
  const service = createServiceClient();

  // --- Database: connectivity, latency, migrations, required tables --------
  let database;
  try {
    const started = Date.now();
    const migrations = await service.from("app_migrations").select("name");
    const latencyMs = Date.now() - started;
    if (migrations.error) throw new Error(migrations.error.message ?? "migration ledger unreadable");
    const applied = ((migrations.data ?? []) as Array<{ name: string }>).map((r) => r.name);
    const missingTables: string[] = [];
    for (const table of REQUIRED_TABLES) {
      const probed = await service.from(table).select("id").limit(1);
      if (probed.error) missingTables.push(table);
    }
    database = assessDatabaseHealth({
      reachable: true,
      latencyMs,
      migrationsApplied: applied.length,
      missingTables,
    });
  } catch {
    database = assessDatabaseHealth({ reachable: false });
  }

  // --- Topic pipeline: latest rows, provenance, evidence -------------------
  let topic;
  try {
    const rows = await service
      .from("daily_topics")
      .select("id, topic_date, title, generation_source, created_at")
      .order("topic_date", { ascending: false })
      .limit(5);
    if (rows.error) throw new Error(rows.error.message ?? "daily_topics unreadable");
    const list = (rows.data ?? []) as Array<{
      id: string;
      topic_date: string;
      title: string;
      generation_source: string | null;
    }>;
    if (!list.length) {
      topic = assessTopicHealth(null, now);
    } else {
      const latest = list[0];
      const cards = await service
        .from("topic_evidence")
        .select("id", { count: "exact", head: true })
        .eq("topic_id", latest.id);
      topic = assessTopicHealth(
        {
          topic_date: latest.topic_date,
          title: latest.title,
          generation_source: latest.generation_source,
          evidence_cards: typeof cards.count === "number" ? cards.count : null,
        },
        now,
      );
    }
  } catch {
    topic = {
      ...assessTopicHealth(null, now),
      status: "blocked" as const,
      note: "Topic store unreadable — database or permissions failure, not just staleness.",
    };
  }

  // --- Judge validation: checked-in live artifact --------------------------
  const judge = assessJudgeHealth(readJudgeArtifact(), now);

  // --- App CI/E2E: GitHub Actions when a token is available ----------------
  const token = process.env.GITHUB_TOKEN?.trim();
  const app = assessAppHealth(token ? await fetchWorkflowRuns(token) : null, CI_ACTIONS_URL);

  return buildOpsHealthReport({ generatedAt: now, topic, judge, database, app });
}
