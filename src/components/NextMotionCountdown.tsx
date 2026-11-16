"use client";

import { useEffect, useState } from "react";
import { formatCountdown, msUntilNextMotion } from "@/lib/todayStreakLine";

/**
 * "Next motion in 7h 12m", copied from Wordle's countdown to the next puzzle.
 * Shown once today's motion is done, so the day ends on when to come back
 * rather than on nothing. Ticks every 30 seconds; the motion rolls over at
 * 00:00 UTC (todayStreakLine.msUntilNextMotion).
 */
export default function NextMotionCountdown({ initialMs }: { initialMs: number }) {
  const [ms, setMs] = useState(initialMs);
  useEffect(() => {
    const tick = () => setMs(msUntilNextMotion(new Date()));
    tick();
    const timer = setInterval(tick, 30_000);
    return () => clearInterval(timer);
  }, []);
  return (
    <p className="next-motion" data-testid="next-motion-countdown">
      Next motion in <strong suppressHydrationWarning>{formatCountdown(ms)}</strong>
    </p>
  );
}
