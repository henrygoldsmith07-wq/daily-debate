// The honest validation state of one product surface, rendered inline.
//
// Everything on this line comes from judgeValidation.ts's report — the status
// chip is whatever the published benchmark attributes to this surface, and the
// sentence is the report's own claim for it. Host pages pass the value
// through; nothing here rewords, upgrades, or decorates it. `unknown` is
// deliberately styled like a blocked state, not a neutral one — an unreadable
// benchmark is a hole in the evidence, and rendering it as "fine" is exactly
// what this component exists to stop.
//
// Purely presentational (no state, no server-only imports) so it can render
// inside server pages and client components alike.
import type { SurfaceValidation } from "@/lib/judgeValidation";

/**
 * Chip colours: shared soft/ink token pairs (the same mapping /metrics uses),
 * keeping `unknown` distinct from `provisional` at a glance.
 */
function chipClass(status: SurfaceValidation["status"]): string {
  if (status === "validated") return "bg-[var(--success-soft)] text-[var(--success)]";
  if (status === "provisional") return "bg-[var(--review-soft)] text-[var(--review)]";
  return "bg-[var(--danger-soft)] text-[var(--danger)]";
}

export default function ValidationStatusLine({
  validation = null,
  testId,
}: {
  /** The surface's report entry. `null`/absent means the host could not read it — an absent benchmark must read as absent, so the line states that rather than vanishing. */
  validation?: SurfaceValidation | null;
  testId?: string;
}) {
  const status = validation?.status ?? "unknown";
  return (
    <p
      className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs leading-5 text-ink3"
      data-testid={testId}
    >
      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${chipClass(status)}`}>
        validation: {status}
      </span>
      <span>{validation?.claim ?? "This surface's validation status could not be read and may not be described as validated."}</span>
    </p>
  );
}

