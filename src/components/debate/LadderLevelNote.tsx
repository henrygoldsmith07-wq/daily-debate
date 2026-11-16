/** M12: tells the learner a retest runs at an earned, tougher practice level. */
export default function LadderLevelNote({ level }: { level: "tougher" | "hardest" | null }) {
  if (!level) return null;
  return (
    <p
      className="rounded-lg border border-[var(--rule)] bg-surface-2 px-3 py-2 text-xs leading-5 text-ink2"
      data-testid="ladder-level-note"
    >
      <span className="font-semibold text-ink">Retest level: {level}.</span> You passed your recent retests on this
      skill, so the opponent is tougher. This is a practice setting, not a validated skill score.
    </p>
  );
}
