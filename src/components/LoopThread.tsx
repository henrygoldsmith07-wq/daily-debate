import type { LoopThreadView } from "@/lib/loopThread";

/**
 * The training loop as a visible thread. The learner always sees where they
 * are in practice → diagnose → repair → retest → demonstrate, and what the
 * next move is. Derived entirely from the canonical learner model — a repair
 * is practice, not proof; only an unprompted later demonstration closes a loop.
 */
export default function LoopThread({ thread }: { thread: LoopThreadView }) {
  return (
    <section
      className="surface-card p-5"
      aria-labelledby="loop-thread-heading"
      data-testid="loop-thread"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs uppercase tracking-[0.14em] text-[var(--accent)]">The training loop</p>
        <span className="text-xs tabular text-ink3" data-testid="loop-thread-counts">
          {thread.loopsOpen} open · {thread.loopsDemonstrated} demonstrated
        </span>
      </div>
      <h2 id="loop-thread-heading" className="mt-1 text-base font-semibold">
        {thread.headline}
      </h2>
      <p className="mt-1 text-sm leading-6 text-ink3">{thread.detail}</p>

      <ol
        className="mt-4 grid grid-cols-5 gap-1.5"
        aria-label="Practice loop stages"
        data-testid="loop-thread-stages"
      >
        {thread.stages.map((stage) => (
          <li
            key={stage.id}
            className="flex flex-col gap-1.5"
            data-testid={`loop-stage-${stage.id}`}
            aria-current={stage.status === "active" ? "step" : undefined}
          >
            <span
              className={`h-1.5 rounded-full ${
                stage.status === "done"
                  ? "bg-[var(--success)]"
                  : stage.status === "active"
                    ? "bg-[var(--accent)]"
                    : "bg-[var(--rule)]"
              }`}
              aria-hidden="true"
            />
            <span
              className={`text-[11px] leading-4 ${
                stage.status === "active"
                  ? "font-semibold text-ink"
                  : stage.status === "done"
                    ? "font-medium text-ink2"
                    : "text-ink3"
              }`}
            >
              {stage.status === "done" ? "✓ " : stage.status === "active" ? "→ " : ""}
              {stage.label}
            </span>
          </li>
        ))}
      </ol>

      {thread.stages
        .filter((stage) => stage.status === "active")
        .map((stage) => (
          <p
            key={stage.id}
            className="mt-2 text-xs leading-5 text-ink2"
            data-testid="loop-thread-caption"
          >
            <span className="font-medium text-ink">{stage.label}:</span> {stage.caption}
          </p>
        ))}

      <p className="mt-3 text-[11px] leading-4 text-ink3">
        A repair is practice, not proof. Only a later, unprompted, different-topic debate closes the loop — one
        demonstration is an observation, not a habit.
      </p>
    </section>
  );
}
