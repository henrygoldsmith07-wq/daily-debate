// Weekly recap: plain-language sentences summarising a WeeklyLoop. Pure.
// Observational only; outcome sentences appear only past the sample gate,
// otherwise an insufficient_evidence line is shown instead.
import { MIN_RETESTS_FOR_RATE, type WeeklyLoop } from "./weeklyLoop";

export interface WeeklyRecap {
  state: "empty" | "counts_only" | "ok";
  lines: string[];
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export function buildWeeklyRecap(loop: WeeklyLoop): WeeklyRecap {
  if (loop.debates === 0 && loop.repairAttempts === 0 && loop.retestsCompleted === 0) {
    return { state: "empty", lines: ["No loop activity in the last 7 days yet."] };
  }
  const lines: string[] = [];
  const delta = loop.debates - loop.previousDebates;
  const trend = delta === 0 ? "the same as" : delta > 0 ? `${plural(delta, "debate")} more than` : `${plural(-delta, "debate")} fewer than`;
  lines.push(`You finished ${plural(loop.debates, "debate")} on ${plural(loop.activeDays, "day")}, ${trend} the 7 days before.`);
  if (loop.repairAttempts > 0) {
    lines.push(`You tried ${plural(loop.repairAttempts, "repair")}; ${loop.repairsSucceeded} landed.`);
  }
  if (loop.retestsCompleted > 0) {
    lines.push(`You finished ${plural(loop.retestsCompleted, "retest")}.`);
  }
  if (loop.rateState === "ok" && loop.demonstratedRate !== null) {
    lines.push(`Across ${loop.observableTotal} measured retests the skill showed up unprompted ${Math.round(loop.demonstratedRate * 100)}% of the time. Unvalidated; observational.`);
    return { state: "ok", lines };
  }
  lines.push(`Not enough measured retests to say whether repairs held (${loop.observableTotal} of ${MIN_RETESTS_FOR_RATE}).`);
  return { state: "counts_only", lines };
}
