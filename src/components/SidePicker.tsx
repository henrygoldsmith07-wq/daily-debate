"use client";

export type SideChoice = "for" | "against" | "challenge";

/**
 * The two sides of today's motion, face to face. For and Against split the
 * card with a "vs" between them and a bar that leans towards the side you
 * picked; "Challenge me" sits underneath as the third way in. The bar shows
 * only YOUR pick: there is no crowd tally behind it, and it must never be
 * drawn as one.
 */
export default function SidePicker({
  side,
  onChange,
  ariaLabel,
}: {
  side: SideChoice;
  onChange: (side: SideChoice) => void;
  ariaLabel: string;
}) {
  return (
    <div className="side-split" data-side={side} role="group" aria-label={ariaLabel}>
      <div className="side-split-halves">
        <button
          type="button"
          onClick={() => onChange("for")}
          aria-pressed={side === "for"}
          className="side-split-half side-split-for"
        >
          <span className="side-split-label">For</span>
          <span className="side-split-sub">Make the case</span>
        </button>
        <span className="side-split-vs" aria-hidden="true">vs</span>
        <button
          type="button"
          onClick={() => onChange("against")}
          aria-pressed={side === "against"}
          className="side-split-half side-split-against"
        >
          <span className="side-split-label">Against</span>
          <span className="side-split-sub">Push back</span>
        </button>
      </div>
      <div className="side-split-bar" aria-hidden="true">
        <span className="side-split-knob" />
      </div>
      <button
        type="button"
        onClick={() => onChange("challenge")}
        aria-pressed={side === "challenge"}
        className="side-split-challenge"
      >
        <span className="side-split-label">Challenge me</span>
        <span className="side-split-sub">Pick for me</span>
      </button>
    </div>
  );
}
