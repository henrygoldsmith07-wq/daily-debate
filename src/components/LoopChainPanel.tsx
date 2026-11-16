import { CHAIN_RATE_MIN_DECIDED, STAGE_LABEL, summarizeChain, type ChainEntry } from "@/lib/loopChain";

export default function LoopChainPanel({ chain }: { chain: ChainEntry[] }) {
  if (chain.length === 0) return null;
  const sum = summarizeChain(chain);
  return (
    <section className="surface-card p-5" aria-labelledby="loop-chain-heading" data-testid="loop-chain">
      <h2 id="loop-chain-heading" className="text-sm font-semibold">Your repairs and retests</h2>
      <p className="mt-1 text-xs text-ink3">One line per weakness you repaired. Observational and unvalidated; not proof the repair caused anything.</p>
      <p className="mt-2 text-sm" data-testid="loop-chain-summary" data-status={sum.status}>
        {sum.status === "ok" && sum.demonstratedShare !== null
          ? `Skill showed up in ${sum.demonstrated} of ${sum.decided} measurable retests (${Math.round(sum.demonstratedShare * 100)}%).`
          : `${sum.decided} of ${CHAIN_RATE_MIN_DECIDED} measurable retests so far: not enough evidence for a rate yet.`}
      </p>
      <ul className="mt-3 space-y-2">
        {chain.map((e) => (
          <li key={e.repairId} className="text-sm" data-testid="loop-chain-row" data-stage={e.stage}>
            <span className="font-medium capitalize">{e.targetKind}</span>
            <span className="text-ink3">{` · ${e.repairedAt.slice(0, 10)} · ${STAGE_LABEL[e.stage]} · Recurrence: not enough evidence yet`}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
