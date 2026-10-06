import "server-only";

import { createServiceClient } from "./backend/server";
import type { RouteLifecycleRow } from "./backend/database.types";
import {
  DEFAULT_ROUTE_LIFECYCLE,
  type RouteLifecycleState,
} from "./routeShadowValidation";

/**
 * Persistent judge-avoidance route lifecycle (migration 017).
 *
 * States are deliberate and durable: promotion to `adopted` is a manual act
 * recorded with its evidence, and an adopted route that later violates its
 * monitoring gate is returned to `suspended` so production fails safe to the
 * ensemble. Absence of a row means `shadow` — never adopted.
 *
 * Nothing in the serving path consults this registry for authority: the
 * established ensemble judges every production debate regardless. The table
 * exists so dashboards, auditors and future operators share one durable
 * source of lifecycle truth instead of a pure function alone.
 */

const VALID_STATES: RouteLifecycleState[] = ["shadow", "eligible", "adopted", "suspended"];

/** Current lifecycle states for every route, defaulting to shadow on any gap. */
export async function getRouteLifecycleStates(): Promise<Record<string, RouteLifecycleState>> {
  const states: Record<string, RouteLifecycleState> = {};
  for (const [route, state] of Object.entries(DEFAULT_ROUTE_LIFECYCLE)) {
    states[route] = state;
  }
  try {
    const service = createServiceClient();
    const rows = await service.from("route_lifecycle").select("route, state");
    if (rows.error) return states;
    for (const row of (rows.data ?? []) as Array<{ route: string; state: string }>) {
      if (VALID_STATES.includes(row.state as RouteLifecycleState)) {
        states[row.route] = row.state as RouteLifecycleState;
      }
    }
  } catch {
    // Registry unreadable: every route reads as its default (shadow, except
    // the permanently adopted ensemble) — uncertainty can never adopt.
  }
  return states;
}

/** Full registry rows for dashboards (empty when unreadable). */
export async function getRouteLifecycleRecords(): Promise<RouteLifecycleRow[]> {
  try {
    const service = createServiceClient();
    const rows = await service.from("route_lifecycle").select("*").order("route", { ascending: true });
    if (rows.error) return [];
    return (rows.data ?? []) as RouteLifecycleRow[];
  } catch {
    return [];
  }
}

/**
 * Deliberate transition rules. Promotion is NEVER an automatic side effect
 * of a passing gate: `eligible` is the highest state this function grants on
 * evidence alone, and `adopted` requires an explicit deliberate act
 * (`adopt: true`, recorded with reason in the registry by an operator).
 * Any monitoring failure of an adopted route suspends it immediately.
 */
export function plannedRouteTransition(params: {
  current: RouteLifecycleState;
  gatePassed: boolean;
  adopt?: boolean;
}): { next: RouteLifecycleState; deliberate: boolean } {
  const { current, gatePassed, adopt = false } = params;
  if (current === "adopted") {
    return gatePassed ? { next: "adopted", deliberate: false } : { next: "suspended", deliberate: false };
  }
  if (!gatePassed) return { next: "shadow", deliberate: false };
  if (adopt) return { next: "adopted", deliberate: true };
  return { next: "eligible", deliberate: false };
}

export interface RouteTransitionAudit {
  route: string;
  registrationVersion: string;
  previousState: RouteLifecycleState;
  newState: RouteLifecycleState;
  evaluatedAt: string;
  sampleN: number | null;
  gateResult: unknown;
  humanResult: unknown;
  reason: string;
  operator: string;
}

const VALID_TRANSITIONS: Record<RouteLifecycleState, RouteLifecycleState[]> = {
  shadow: ["eligible", "shadow"],
  eligible: ["adopted", "shadow", "eligible"],
  adopted: ["suspended", "adopted"],
  suspended: ["eligible", "shadow", "suspended"],
};

/**
 * Persist one deliberate lifecycle transition. Adoption is never automatic:
 * this is an explicit server-side operation that writes the full audit
 * payload (route, registration version, previous/new state, evidence, reason,
 * operator). Invalid edges are rejected so a caller cannot invent a path
 * (e.g. shadow → adopted without passing through eligible).
 */
export async function applyRouteTransition(
  transition: RouteTransitionAudit,
): Promise<{ ok: boolean; error?: string }> {
  if (!VALID_TRANSITIONS[transition.previousState]?.includes(transition.newState)) {
    return { ok: false, error: `invalid transition ${transition.previousState} → ${transition.newState}` };
  }
  if (transition.newState === "adopted" && transition.previousState !== "eligible") {
    return { ok: false, error: "adoption requires current state eligible (never shadow → adopted)" };
  }
  try {
    const service = createServiceClient();
    const row = {
      route: transition.route,
      registration_version: transition.registrationVersion,
      state: transition.newState,
      evaluated_at: transition.evaluatedAt,
      sample_n: transition.sampleN,
      gate_result: transition.gateResult == null ? null : JSON.stringify(transition.gateResult),
      human_result: transition.humanResult == null ? null : JSON.stringify(transition.humanResult),
      reason: transition.reason,
      adopted_at: transition.newState === "adopted" ? transition.evaluatedAt : null,
      suspended_at: transition.newState === "suspended" ? transition.evaluatedAt : null,
      updated_at: new Date().toISOString(),
    };
    const result = await service
      .from("route_lifecycle")
      .upsert(row, { onConflict: "route" });
    if (result.error) return { ok: false, error: result.error.message ?? "upsert failed" };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message ?? e) };
  }
}
