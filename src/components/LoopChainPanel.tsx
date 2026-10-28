import { STAGE_LABEL, type ChainEntry } from "@/lib/loopChain";

export default function LoopChainPanel({ chain }: { chain: ChainEntry[] }) {
  if (chain.length === 0) return null;
  return (
    <section className="surface-card p-5" aria-labelledby="loop-chain-heading" data-testid="loop-chain">
      <h2 id="loop-chain-heading" className="text-sm font-semibold">Your repairs and retests</h2>
      <p className="mt-1 text-xs text-ink3">One line per weakness you repaired. Observational and unvalidated; not proof the repair caused anything.</p>
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
