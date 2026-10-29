import Link from "next/link";
import { STAGE_LABEL, type ChainEntry } from "@/lib/loopChain";
import { ladderCopy } from "@/lib/retestLadder";
import { buildWeaknessLibrary } from "@/lib/weaknessLibrary";

/** M10: weakness history grouped by skill. Counts only; recurrence stays unmeasured. */
export default function WeaknessLibraryPanel({ chain }: { chain: ChainEntry[] }) {
  const groups = buildWeaknessLibrary(chain);
  if (groups.length === 0) return null;
  return (
    <section className="surface-card p-5" aria-labelledby="weakness-library-heading" data-testid="weakness-library">
      <h2 id="weakness-library-heading" className="text-sm font-semibold">Weaknesses by skill</h2>
      <p className="mt-1 text-xs text-ink3">Every weakness you repaired, grouped by skill. Counts only: observational and unvalidated, recurrence not measured yet.</p>
      <ul className="mt-3 space-y-3">
        {groups.map((g) => (
          <li key={g.kind} className="text-sm" data-testid="weakness-group" data-kind={g.kind} data-redrill={g.redrillSuggested ? "yes" : "no"}>
            <span className="font-medium capitalize">{g.kind}</span>
            <span className="text-ink3">{` · ${g.total} repair${g.total === 1 ? "" : "s"} · latest: ${STAGE_LABEL[g.latest.stage]}`}</span>
            {ladderCopy(g.ladder) && (
              <span className="block text-xs text-ink3" data-testid="weakness-ladder" data-ladder-status={g.ladder.status}>
                {ladderCopy(g.ladder)}
              </span>
            )}
            {g.redrillSuggested && (
              <>
                {" "}
                <Link href="/solo" className="underline" data-testid="weakness-redrill">Practise again</Link>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
