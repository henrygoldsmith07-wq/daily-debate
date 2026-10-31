"use client";

import { useEffect, useId, useState } from "react";
import type { MotionPosition, PositionTallyView } from "@/lib/positionTally";

interface PositionState {
  position: MotionPosition | null;
  tally: PositionTallyView | null;
}

/**
 * "Where do you stand?" — the learner's own view on today's motion, given
 * before any debate (the Geo pattern: state a position first, then meet
 * someone who disagrees). The split across everyone appears only after the
 * learner has answered and only once enough people have (positionTally.ts),
 * so the crowd can neither pull an answer nor identify anyone on a quiet day.
 */
export default function PositionPills({
  onChange,
  compact = false,
}: {
  onChange?: (position: MotionPosition | null) => void;
  compact?: boolean;
}) {
  const [state, setState] = useState<PositionState | null>(null);
  const [saving, setSaving] = useState<MotionPosition | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/positions", { cache: "no-store" })
      .then(async (res) => (res.ok ? ((await res.json()) as PositionState) : null))
      .then((data) => {
        if (!active || !data) return;
        setState({ position: data.position, tally: data.tally });
        onChange?.(data.position);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
    // onChange is a notification hook; reloading positions when a parent
    // re-creates it would refetch on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function choose(position: MotionPosition) {
    setSaving(position);
    setError(null);
    try {
      const res = await fetch("/api/positions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ position }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save your position.");
      setState({ position: data.position, tally: data.tally });
      onChange?.(data.position);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your position.");
    } finally {
      setSaving(null);
    }
  }

  const labelId = useId();
  const position = state?.position ?? null;
  const tally = state?.tally ?? null;

  return (
    <div className={`position-pills${compact ? " is-compact" : ""}`} data-testid="position-pills" data-position={position ?? "none"}>
      <div className="position-pills-row">
        <span className="position-pills-label" id={labelId}>
          {position ? "You stand" : "Where do you stand?"}
        </span>
        <div className="position-pills-choices" role="group" aria-labelledby={labelId}>
          {(["for", "against"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => void choose(option)}
              disabled={saving !== null}
              aria-pressed={position === option}
              className={`position-pill position-pill-${option}`}
            >
              {option === "for" ? "Agree" : "Disagree"}
            </button>
          ))}
        </div>
      </div>
      {tally ? (
        <div className="position-tally">
          <div className="position-tally-bar" aria-hidden="true">
            <span className="position-tally-for" style={{ width: `${tally.forShare}%` }} />
          </div>
          <p className="position-tally-note">
            <span>{tally.forShare}% agree</span>
            <span>{tally.total} positions</span>
            <span>{tally.againstShare}% disagree</span>
          </p>
        </div>
      ) : position ? (
        <p className="position-tally-note">The split appears once more people have answered.</p>
      ) : null}
      {error && <p className="text-xs text-[var(--bad)]" role="alert">{error}</p>}
    </div>
  );
}
