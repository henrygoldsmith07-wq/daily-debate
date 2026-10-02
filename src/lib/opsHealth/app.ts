// CI / workflow health.
//
// Reads recent workflow runs. An unknown CI state is never reported as green:
// it stays `unknown` and outranks healthy in the roll-up.

import { rollupOverall, type HealthState } from "./core";

export interface WorkflowStatusInput {
  name: string;
  status: "completed" | "in_progress" | "queued" | null;
  conclusion: string | null;
}

export interface AppHealth {
  status: HealthState;
  workflows: Array<WorkflowStatusInput & { state: HealthState }>;
  ciUrl: string;
  note: string | null;
}

export function assessWorkflowState(w: WorkflowStatusInput): HealthState {
  if (w.status === "in_progress" || w.status === "queued") return "degraded";
  if (w.status !== "completed") return "unknown";
  if (w.conclusion === "success") return "healthy";
  if (w.conclusion === "failure" || w.conclusion === "timed_out") return "failed";
  return "unknown";
}

export function assessAppHealth(
  workflows: WorkflowStatusInput[] | null,
  ciUrl: string,
): AppHealth {
  if (!workflows) {
    return {
      status: "unknown",
      workflows: [],
      ciUrl,
      note: "CI status is unknown from this runtime (no token) — see Actions; never read as green.",
    };
  }
  const assessed = workflows.map((w) => ({ ...w, state: assessWorkflowState(w) }));
  return {
    status: rollupOverall(assessed.map((w) => w.state)),
    workflows: assessed,
    ciUrl,
    note: assessed.some((w) => w.state === "unknown")
      ? "At least one workflow has no completed run on record."
      : null,
  };
}
