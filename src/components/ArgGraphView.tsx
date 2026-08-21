"use client";

import { useState } from "react";
import type { ArgGraph, ArgNode } from "@/lib/argGraph";
import type { PvpVerdict } from "@/lib/types";
import { applyGraphEdits } from "@/lib/graphEnrichers";
import { validateGraph } from "@/lib/argGraph";

const KIND_LABEL: Record<ArgNode["kind"], string> = {
  claim: "Claim",
  evidence: "Evidence",
  counterclaim: "Counterclaim",
  rebuttal: "Rebuttal",
  impact: "Impact",
};

const KIND_DOT: Record<ArgNode["kind"], string> = {
  claim: "bg-[var(--accent-soft)] border-[var(--rule)]",
  evidence: "bg-[var(--good)]/15 border-[var(--good)]/30",
  counterclaim: "bg-[var(--surface-2)] border-[var(--rule)]",
  rebuttal: "bg-[var(--accent-soft)] border-[var(--rule)]",
  impact: "bg-[var(--good)]/10 border-[var(--good)]/25",
};

function nodesByRound(nodes: ArgNode[]) {
  const map = new Map<number, ArgNode[]>();
  for (const n of nodes) {
    const arr = map.get(n.round) ?? [];
    arr.push(n);
    map.set(n.round, arr);
  }
  return [...map.entries()].sort(([a], [b]) => a - b);
}

export function VerdictExplainPanel({ verdict, playerAName, playerBName }: { verdict: PvpVerdict; playerAName: string; playerBName: string }) {
  const g = verdict.argGraph;
  const deciding = verdict.decidingFactor ?? verdict.rationale;

  return (
    <div className="flex flex-col gap-5">
      <div className="surface-card p-5 flex flex-col gap-3">
        <p className="text-xs uppercase tracking-wide text-ink3">Why the debate was won</p>
        <p className="text-sm leading-relaxed">{deciding}</p>
        <p className="text-xs text-ink3 tabular">
          {verdict.scoreStatus === "insufficient_evidence"
            ? "Scores unavailable — insufficient observable evidence"
            : `${playerAName}: ${verdict.playerAScore}/100 · ${playerBName}: ${verdict.playerBScore}/100`}
        </p>
        {verdict.observableAssessment && <ObservableFeaturePanel assessment={verdict.observableAssessment} playerAName={playerAName} playerBName={playerBName} />}
        {verdict.isTie && (
          <div className="rounded-xl border border-[var(--accent-soft)] bg-[var(--accent-soft)]/40 p-3">
            <p className="text-sm font-medium">Too close to call</p>
            <p className="text-xs text-ink3">
              {verdict.tieReason ?? "The judges couldn't separate the two cases — treat it as a draw."}
            </p>
          </div>
        )}
        {verdict.breakdown && (
          <div className="grid grid-cols-2 gap-3 pt-2 text-xs">
            <Breakdown label={playerAName} data={verdict.breakdown.a} winner={verdict.winner === "a"} />
            <Breakdown label={playerBName} data={verdict.breakdown.b} winner={verdict.winner === "b"} />
          </div>
        )}
        {g?.impactComparison && (
          <p className="text-xs text-ink3">
            Impact framing — {playerAName} {g.impactComparison.a} vs {playerBName} {g.impactComparison.b}: {g.impactComparison.rationale}
          </p>
        )}
      </div>

      {typeof verdict.confidence === "number" && <ConfidencePanel verdict={verdict} playerAName={playerAName} playerBName={playerBName} />}

      {g ? (
        <>
          <ArgGraphInline graph={g} playerAName={playerAName} playerBName={playerBName} />
          <TrackingGrid graph={g} />
        </>
      ) : (
        <p className="text-xs text-ink3 surface-card p-4">Structured breakdown will appear on newly judged matches. Older verdicts show only the rationale.</p>
      )}
    </div>
  );
}

function ObservableFeaturePanel({ assessment, playerAName, playerBName }: { assessment: NonNullable<PvpVerdict["observableAssessment"]>; playerAName: string; playerBName: string }) {
  const rows = [
    ["Claims supported", assessment.features.a.claimsDirectlySupported.value, assessment.features.b.claimsDirectlySupported.value],
    ["Cited evidence nodes", assessment.features.a.evidenceActuallyCited.value, assessment.features.b.evidenceActuallyCited.value],
    ["Evidence relevance", assessment.features.a.evidenceRelevance.value.toFixed(2), assessment.features.b.evidenceRelevance.value.toFixed(2)],
    ["Rebuttal coverage", assessment.features.a.rebuttalCoverage.value.toFixed(2), assessment.features.b.rebuttalCoverage.value.toFixed(2)],
    ["Argument responses", assessment.features.a.argumentResponses.value.rate.toFixed(2), assessment.features.b.argumentResponses.value.rate.toFixed(2)],
    ["Unsupported assertions", assessment.features.a.unsupportedAssertions.value, assessment.features.b.unsupportedAssertions.value],
    ["Confident fallacies", assessment.features.a.confidentlyDetectableFallacies.value, assessment.features.b.confidentlyDetectableFallacies.value],
  ] as const;
  return (
    <div className="rounded-xl border border-[var(--rule)] bg-surface-2 p-3 text-xs">
      <p className="font-medium">Observable score inputs</p>
      <p className="mt-1 text-ink3">{assessment.scoreComposition.formula}</p>
      <div className="mt-2 grid grid-cols-[1fr_auto_auto] gap-x-3 gap-y-1 tabular text-ink3">
        <span />
        <span>{playerAName}</span>
        <span>{playerBName}</span>
        {rows.map(([label, a, b]) => <span key={label} className="contents"><span>{label}</span><span>{a}</span><span>{b}</span></span>)}
      </div>
      {assessment.uncertainty.length > 0 && <p className="mt-2 text-amber-700">Uncertainty: {assessment.uncertainty.join(" ")}</p>}
    </div>
  );
}

function ConfidencePanel({ verdict, playerAName, playerBName }: { verdict: PvpVerdict; playerAName: string; playerBName: string }) {
  const confidence = verdict.confidence ?? 0;
  const multiJudge = (verdict.judges?.length ?? 0) > 1;
  return (
    <div className="surface-card p-5 flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <p className="text-xs uppercase tracking-wide text-ink3">Judge confidence</p>
        <p className="tabular text-xs text-ink3">{Math.round(confidence * 100)}%</p>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-ink/30 shadow-[inset_0_1px_2px_rgba(0,0,0,0.4)]">
        <div
          className="h-full rounded-full transition-[width]"
          style={{ width: `${Math.max(0, Math.min(100, confidence * 100))}%`, background: confidence >= 0.7 ? "var(--good)" : confidence >= 0.5 ? "var(--accent)" : "var(--bad)" }}
        />
      </div>
      {verdict.scoreCI && (
        <p className="text-xs text-ink3 tabular">
          Score-gap 95% CI: {verdict.scoreCI.lo}–{verdict.scoreCI.hi} points
        </p>
      )}
      {multiJudge && verdict.winnerCI && (
        <p className="text-xs text-ink3 tabular">
          Judge split — {playerAName}: {Math.round(verdict.winnerCI.a * 100)}% · {playerBName}: {Math.round(verdict.winnerCI.b * 100)}% · tie: {Math.round(verdict.winnerCI.tie * 100)}%
        </p>
      )}
      {multiJudge && (
        <p className="text-xs text-ink3">
          Judges: {verdict.judges!.map((j) => `${j.judgeId} → ${j.winner === "a" ? playerAName : j.winner === "b" ? playerBName : "tie"}`).join(" · ")}
        </p>
      )}
    </div>
  );
}

function Breakdown({ label, data, winner }: { label: string; data: { claims: number; evidence: number; rebuttals: number; impacts: number; fallacies: number; droppedSuffered: number }; winner: boolean }) {
  return (
    <div className={`rounded-xl border p-3 ${winner ? "bg-[var(--good)]/10 border-[var(--good)]/20" : "bg-[var(--surface-2)] border-[var(--rule)]"}`}>
      <p className="font-medium text-[var(--foreground)]">
        {label} {winner ? "· winner" : ""}
      </p>
      <p className="tabular text-ink3 mt-1">
        {data.claims} claims · {data.evidence} evidenced · {data.rebuttals} rebuttals · {data.impacts} impacts
      </p>
      <p className="tabular text-ink3">
        {data.fallacies} fallacies · {data.droppedSuffered} of theirs dropped by opponent
      </p>
    </div>
  );
}

export function ArgGraphInline({
  graph,
  playerAName,
  playerBName,
  editable,
  onGraphChange,
}: {
  graph: ArgGraph;
  playerAName: string;
  playerBName: string;
  editable?: boolean;
  onGraphChange?: (g: ArgGraph, audit: string[]) => void;
}) {
  const nameFor = (owner: ArgNode["owner"]) => (owner === "a" ? playerAName : owner === "b" ? playerBName : "AI");
  const byRound = nodesByRound(graph.nodes);
  const [editId, setEditId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  function commitEdit(nodeId: string) {
    const { graph: next, audit } = applyGraphEdits(graph, [{ op: "patchNode", nodeId, patch: { text: editText.trim() || graph.nodes.find((n) => n.id === nodeId)?.text } }]);
    const errs = validateGraph(next);
    if (errs.length) return; // keep invalid edits from propagating
    onGraphChange?.(next, audit);
    setEditId(null);
  }

  return (
    <div className="surface-card p-4 flex flex-col gap-4">
      <p className="text-xs uppercase tracking-wide text-ink3">Argument graph — claim → evidence → counterclaim → rebuttal → impact</p>
      <div className="flex flex-col gap-4">
        {byRound.map(([round, nodes]) => (
          <div key={round} className="flex flex-col gap-2">
            <p className="text-xs font-medium text-ink3">Round {round}</p>
            <div className="flex flex-col gap-2">
              {nodes.map((n) => (
                <div key={n.id} className={`flex gap-2 rounded-xl border px-3 py-2 text-sm ${KIND_DOT[n.kind]}`}>
                  <span className="shrink-0 text-xs font-medium tabular text-ink3 mt-0.5">
                    {n.id} · {KIND_LABEL[n.kind]}
                  </span>
                  {editable && editId === n.id ? (
                    <span className="flex flex-1 gap-2">
                      <input value={editText} onChange={(e) => setEditText(e.target.value)} className="min-w-0 flex-1 rounded border border-[var(--rule)] bg-transparent px-2 py-1 text-sm" aria-label={`Edit ${n.id}`} />
                      <button type="button" onClick={() => commitEdit(n.id)} className="btn btn-primary px-2 py-1 text-xs">Save</button>
                      <button type="button" onClick={() => setEditId(null)} className="btn btn-ghost px-2 py-1 text-xs">Cancel</button>
                    </span>
                  ) : (
                    <span className="flex-1">{n.text}</span>
                  )}
                  <span className="shrink-0 text-xs text-ink3">{nameFor(n.owner)}</span>
                  {editable && editId !== n.id ? (
                    <button type="button" onClick={() => { setEditId(n.id); setEditText(n.text); }} className="shrink-0 text-xs text-ink3 underline">Edit</button>
                  ) : null}
                  {n.evidenceStrength ? <span className="shrink-0 text-xs tabular text-ink3">[{n.evidenceStrength}]</span> : null}
                  {n.kind === "evidence" && n.citations?.length ? (
                    <span className="shrink-0 text-xs tabular text-ink3" title={n.citations.map((c) => `${c.sourceName}${c.homepage ? ` — ${c.homepage}` : ""}${c.excerpt ? `: ${c.excerpt}` : ""}`).join(" | ")}>
                      ↳ {n.citations.map((c) => c.sourceName).join(", ")}
                    </span>
                  ) : n.kind === "evidence" && n.evidenceStrength && !["anecdotal", "general"].includes(n.evidenceStrength) ? (
                    <span className="shrink-0 text-xs text-amber-600" title="Cited/strong evidence should carry a citation — the judge omitted one.">
                      ⚠ no citation
                    </span>
                  ) : null}
                  {n.fallacy && n.fallacy !== "none" ? <span className="shrink-0 text-xs text-[var(--bad)]">{n.fallacy}</span> : null}
                  {n.targets?.length ? <span className="shrink-0 text-xs tabular text-ink3">→ {n.targets.join(", ")}</span> : null}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      {graph.edges.length > 0 && (
        <div className="text-xs text-ink3">
          <span className="font-medium text-ink3">Flow:</span> {graph.edges.map((e) => `${e.from} —${e.relation}→ ${e.to}`).join(" · ")}
        </div>
      )}
    </div>
  );
}

export function TrackingGrid({ graph }: { graph: ArgGraph }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <TrackCard title="Unsupported claims" items={graph.evidenceStats.unsupportedClaimIds.map((id) => graph.nodes.find((n) => n.id === id)?.text ?? id)} empty="Every claim was backed." />
      <TrackCard title="Dropped arguments" items={graph.dropped.map((d) => `${d.text} (r${d.round})`)} empty="Nothing was left unanswered." />
      <TrackCard
        title="Contradictions"
        items={graph.contradictions.map((c) => `${c.explanation} (${c.owner})`)}
        empty="No self-contradictions flagged."
      />
      <TrackCard
        title="Concessions"
        items={graph.concessions.map((c) => `${graph.nodes.find((n) => n.id === c.nodeId)?.text ?? c.nodeId} — by ${c.by}: ${c.note}`)}
        empty="No concessions noted."
      />
      <TrackCard title="Rebuttals" items={graph.nodes.filter((n) => n.kind === "rebuttal").map((n) => `${n.text} ${n.targets?.length ? `→ ${n.targets.join(", ")}` : ""}`)} empty="No direct rebuttals recorded." />
      <TrackCard
        title="Evidence strength"
        items={[
          `anecdotal ${graph.evidenceStats.byStrength.anecdotal}`,
          `general ${graph.evidenceStats.byStrength.general}`,
          `cited ${graph.evidenceStats.byStrength.cited}`,
          `strong ${graph.evidenceStats.byStrength.strong}`,
        ]}
        empty="No evidence tagged."
      />
      <TrackCard
        title="Source grounding"
        items={graph.nodes
          .filter((n) => n.kind === "evidence")
          .map((n) => `${n.id} [${n.evidenceStrength ?? "—"}] ${n.text} — ${(n.citations?.length ?? 0) > 0 ? n.citations!.map((c) => `${c.sourceName}${c.homepage ? ` (${c.homepage})` : ""}`).join(", ") : "⚠ uncited"}`)}
        empty="No evidence to ground."
      />
      <TrackCard
        title="Logical fallacies"
        items={graph.fallacies.filter((f) => f.fallacy !== "none").map((f) => `${f.fallacy} — ${f.note} (${f.nodeId})`)}
        empty="No fallacies flagged."
      />
      <div className="surface-card p-4 text-sm">
        <p className="text-xs uppercase tracking-wide text-ink3">Impact comparison</p>
        <p className="text-ink3 mt-1 text-xs">
          {graph.impactComparison ? graph.impactComparison.rationale : "Compare which impacts actually frame the debate — not who talked more."}
        </p>
      </div>
    </div>
  );
}

function TrackCard({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <div className="surface-card p-4">
      <p className="text-xs uppercase tracking-wide text-ink3">{title}</p>
      {items.length === 0 ? (
        <p className="text-xs text-ink3 mt-2">{empty}</p>
      ) : (
        <ul className="mt-2 list-disc pl-4 text-xs text-ink3 space-y-1">
          {items.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

