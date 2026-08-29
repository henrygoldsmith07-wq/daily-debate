"use client";

import Link from "next/link";
import PageHeader from "./PageHeader";
import { useMemo, useState } from "react";
import SkillProfileBars from "./SkillProfileBars";
import type {
  ArgumentDnaInsight,
  ArgumentDnaModel,
  DnaDebateSnapshot,
  DnaPeriodSummary,
  InsightTone,
} from "@/lib/argumentDna";

type Range = "all" | "6" | "3";

const KIND_META = [
  { key: "claim", stat: "claims", label: "Claim", color: "dna-node-claim" },
  { key: "evidence", stat: "evidence", label: "Evidence", color: "dna-node-evidence" },
  { key: "counterclaim", stat: "counterclaims", label: "Counter", color: "dna-node-counter" },
  { key: "rebuttal", stat: "rebuttals", label: "Rebuttal", color: "dna-node-rebuttal" },
  { key: "impact", stat: "impacts", label: "Impact", color: "dna-node-impact" },
] as const;

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function formatMonth(key: string): string {
  if (key === "unknown") return "Unknown month";
  const date = new Date(`${key}-01T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? key : date.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
}

function formatScore(score: number | null): string {
  return score === null ? "—" : `${Math.round(score)}`;
}

function insightToneClass(tone: InsightTone): string {
  return tone === "positive" ? "dna-insight-positive" : tone === "attention" ? "dna-insight-attention" : "dna-insight-neutral";
}

function Direction({ direction }: { direction: ArgumentDnaInsight["direction"] }) {
  return (
    <span className="dna-direction" aria-label={direction === "up" ? "trending up" : direction === "down" ? "needs attention" : "holding steady"}>
      {direction === "up" ? "↗" : direction === "down" ? "↘" : "→"}
    </span>
  );
}

function InsightCard({ item }: { item: ArgumentDnaInsight }) {
  return (
    <article className={`dna-insight ${insightToneClass(item.tone)}`}>
      <div className="dna-insight-meta">
        <span>{item.label}</span>
        <Direction direction={item.direction} />
      </div>
      <h3>{item.title}</h3>
      <p>{item.body}</p>
      <div className="dna-insight-evidence">{item.evidence}</div>
    </article>
  );
}

function TimelineChart({ periods }: { periods: DnaPeriodSummary[] }) {
  const width = 720;
  const height = 220;
  const pad = { left: 42, right: 18, top: 18, bottom: 34 };
  const measured = periods.filter((period) => period.score !== null);
  if (!measured.length) {
    return (
      <div className="dna-chart-empty" role="status">
        Complete a graph-scored debate to start the timeline.
      </div>
    );
  }

  const values = measured.map((period) => period.score ?? 0);
  const min = Math.max(0, Math.floor(Math.min(...values) / 10) * 10 - 10);
  const max = Math.min(100, Math.ceil(Math.max(...values) / 10) * 10 + 10);
  const span = Math.max(1, max - min);
  const x = (index: number) => pad.left + (index / Math.max(1, measured.length - 1)) * (width - pad.left - pad.right);
  const y = (value: number) => pad.top + (1 - (value - min) / span) * (height - pad.top - pad.bottom);
  const line = measured.map((period, index) => `${x(index)},${y(period.score ?? min)}`).join(" ");

  return (
    <div className="dna-chart-wrap">
      <svg className="dna-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Average debate score by month">
        {[0, 0.5, 1].map((ratio) => {
          const value = min + span * (1 - ratio);
          return (
            <g key={ratio}>
              <line x1={pad.left} x2={width - pad.right} y1={pad.top + ratio * (height - pad.top - pad.bottom)} y2={pad.top + ratio * (height - pad.top - pad.bottom)} className="dna-grid-line" />
              <text x={pad.left - 10} y={pad.top + ratio * (height - pad.top - pad.bottom) + 4} textAnchor="end" className="dna-axis-label">{Math.round(value)}</text>
            </g>
          );
        })}
        <polyline points={line} className="dna-chart-line" />
        {measured.map((period, index) => (
          <g key={period.key}>
            <circle cx={x(index)} cy={y(period.score ?? min)} r="5" className="dna-chart-point" />
            <title>{`${formatMonth(period.key)} · ${Math.round(period.score ?? 0)}/100 average`}</title>
            {(index === 0 || index === measured.length - 1 || measured.length < 6) && (
              <text x={x(index)} y={height - 10} textAnchor={index === 0 ? "start" : index === measured.length - 1 ? "end" : "middle"} className="dna-axis-label">{formatMonth(period.key)}</text>
            )}
          </g>
        ))}
      </svg>
      <p className="dna-chart-note">Average debate score · the line is a view of movement, not a verdict on a single round.</p>
    </div>
  );
}

function graphNodeText(snapshot: DnaDebateSnapshot, key: (typeof KIND_META)[number]["key"]): string {
  const text = snapshot.graph?.nodes.find((node) => node.owner === snapshot.owner && node.kind === key)?.text;
  if (!text) return "No node recorded";
  return text.length > 74 ? `${text.slice(0, 71)}…` : text;
}

function GraphPreview({ snapshot, label }: { snapshot: DnaDebateSnapshot | null; label: string }) {
  if (!snapshot || !snapshot.graph) {
    return (
      <div className="dna-graph-card dna-graph-card-empty">
        <div className="dna-graph-card-top"><span>{label}</span><span className="dna-muted">No graph yet</span></div>
        <p>Older debates without a structured assessment still count in history, but do not change the DNA profile.</p>
      </div>
    );
  }

  return (
    <div className="dna-graph-card">
      <div className="dna-graph-card-top">
        <div>
          <span className="dna-overline">{label}</span>
          <strong>{formatDate(snapshot.completedAt)}</strong>
        </div>
        <span className="dna-graph-score">{formatScore(snapshot.score)}<small>/100</small></span>
      </div>
      <div className="dna-graph-flow" aria-label={`${label} argument graph`}>
        {KIND_META.map((kind, index) => (
          <div key={kind.key} className="dna-graph-step">
            <div className={`dna-node-dot ${kind.color}`} aria-hidden="true">{snapshot.graphStats[kind.stat]}</div>
            <span>{kind.label}</span>
            <p>{graphNodeText(snapshot, kind.key)}</p>
            {index < KIND_META.length - 1 && <span className="dna-flow-arrow" aria-hidden="true">→</span>}
          </div>
        ))}
      </div>
      <div className="dna-graph-footer">
        <span>{snapshot.graphStats.unsupportedClaims} unsupported</span>
        <span>{snapshot.graphStats.droppedArguments} dropped</span>
        <span>{snapshot.graphStats.citedEvidence} cited</span>
        <span>{snapshot.graphStats.fallacies} {snapshot.graphStats.fallacies === 1 ? "fallacy" : "fallacies"}</span>
      </div>
    </div>
  );
}

function ChangeList({ model }: { model: ArgumentDnaModel }) {
  return (
    <div className="dna-change-list">
      {model.comparison.dimensions.map((dimension) => {
        const delta = dimension.delta;
        return (
          <div key={dimension.key} className="dna-change-row">
            <span>{dimension.label}</span>
            <span className="dna-change-values"><b>{dimension.latest ?? "—"}</b><span className={delta === null ? "dna-muted" : delta > 0 ? "dna-up" : delta < 0 ? "dna-down" : "dna-muted"}>{delta === null ? "—" : `${delta > 0 ? "+" : ""}${delta}`}</span></span>
          </div>
        );
      })}
    </div>
  );
}

function periodCountLabel(period: DnaPeriodSummary): string {
  return `${period.debates} debate${period.debates === 1 ? "" : "s"}${period.analysedDebates < period.debates ? ` · ${period.analysedDebates} graphed` : ""}`;
}

export default function ArgumentDnaView({ model }: { model: ArgumentDnaModel }) {
  const [range, setRange] = useState<Range>("all");
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string | null>(model.comparison.latest?.id ?? null);
  const latest = model.comparison.latest;
  const selected = model.snapshots.find((snapshot) => snapshot.id === selectedSnapshotId) ?? latest;
  const periods = useMemo(() => {
    if (range === "all") return model.periods;
    return model.periods.slice(-Number(range));
  }, [model.periods, range]);

  return (
    <div className="dna-page">
      <PageHeader
        eyebrow="Persistent reasoning profile"
        title="Argument DNA"
        description="Every debate adds another layer to the map — what holds, what gets dropped, and how your moves change when the pressure is on."
        actions={
          <>
            <div
              className="dna-score-chip"
              aria-label={`${model.profile.overallScore ?? "No"} overall argument skill score`}
            >
              <span>Argument skill</span>
              <strong className="tabular">{model.profile.overallScore ?? "—"}</strong>
              <small className="tabular">{model.analysedDebates} graphed</small>
            </div>
            <Link href="/" className="btn btn-primary px-3 py-1.5 text-xs">
              Start today&apos;s debate <span aria-hidden="true">→</span>
            </Link>
            <Link href="/progress" className="btn btn-secondary px-3 py-1.5 text-xs">
              Full ledger
            </Link>
          </>
        }
      />

      <section className="dna-stat-grid" aria-label="Argument DNA summary">
        <div className="dna-stat-card"><span>Debates tracked</span><strong>{model.totalDebates}</strong><small>solo + PvP</small></div>
        <div className="dna-stat-card"><span>Months in view</span><strong>{model.periods.length}</strong><small>of persistent history</small></div>
        <div className="dna-stat-card"><span>Current read</span><strong>{latest?.score === null || latest?.score === undefined ? "—" : `${Math.round(latest.score)}/100`}</strong><small>{latest ? formatDate(latest.completedAt) : "No debate yet"}</small></div>
        <div className="dna-stat-card"><span>Pattern confidence</span><strong>{model.analysedDebates >= model.ledger.minimumForClaims ? "Pattern" : "Baseline"}</strong><small>{model.analysedDebates >= model.ledger.minimumForClaims ? "enough repetition to coach" : `reliable after ${model.ledger.minimumForClaims}`}</small></div>
      </section>

      <section className="dna-section">
        <div className="dna-section-heading">
          <div><p className="dna-overline">Signals, not labels</p><h2>What your graph keeps noticing</h2></div>
          <span className="dna-heading-note">Recomputed from observable moves</span>
        </div>
        <div className="dna-insight-grid">{model.insights.map((item) => <InsightCard key={item.id} item={item} />)}</div>
      </section>

      <section className="dna-section dna-profile-section">
        <div className="dna-section-heading">
          <div><p className="dna-overline">Your current baseline</p><h2>Argument skill profile</h2></div>
          <Link href="/progress" className="dna-inline-link">See metric detail →</Link>
        </div>
        <div className="dna-profile-grid">
          <div className="dna-panel dna-profile-panel"><SkillProfileBars profile={model.profile} /></div>
          <div className="dna-panel dna-change-panel">
            <div className="dna-panel-heading"><h3>Since your first read</h3><span className="dna-muted">latest score · movement</span></div>
            <ChangeList model={model} />
          </div>
        </div>
      </section>

      <section className="dna-section">
        <div className="dna-section-heading dna-section-heading-stack-mobile">
          <div><p className="dna-overline">The long view</p><h2>How your reasoning has changed</h2><p className="dna-section-sub">A monthly view of the moves behind the score. Tap a period below to inspect its graph.</p></div>
          <div className="dna-range-switch" aria-label="Timeline range">
            {(["all", "6", "3"] as Range[]).map((option) => <button key={option} type="button" className={range === option ? "active" : ""} onClick={() => setRange(option)}>{option === "all" ? "All time" : `${option} months`}</button>)}
          </div>
        </div>
        <div className="dna-panel dna-timeline-panel">
          <TimelineChart periods={periods} />
          <div className="dna-period-rail" aria-label="Debate periods">
            {periods.map((period) => <button key={period.key} type="button" className={selected?.id === period.lastSnapshotId ? "active" : ""} onClick={() => setSelectedSnapshotId(period.lastSnapshotId)} aria-pressed={selected?.id === period.lastSnapshotId}><span>{formatMonth(period.key)}</span><small>{periodCountLabel(period)}</small></button>)}
          </div>
        </div>
      </section>

      <section className="dna-section">
        <div className="dna-section-heading">
          <div><p className="dna-overline">Graph evolution</p><h2>See the argument, not just the number</h2><p className="dna-section-sub">The same five moves, rendered at two points in time. This is where a score becomes a habit you can change.</p></div>
        </div>
        <div className="dna-graph-compare">
          <GraphPreview snapshot={model.comparison.first} label="First recorded" />
          <div className="dna-compare-arrow" aria-hidden="true">→</div>
          <GraphPreview snapshot={selected} label={selected?.id === latest?.id ? "Latest read" : "Selected period"} />
        </div>
      </section>

      <section className="dna-section dna-recent-section">
        <div className="dna-section-heading"><div><p className="dna-overline">Your evidence trail</p><h2>Recent debates</h2></div><span className="dna-heading-note">Newest first</span></div>
        <div className="dna-recent-list">
          {model.snapshots.length === 0 ? <p className="dna-empty-copy">Your first completed debate will appear here.</p> : model.snapshots.slice().reverse().slice(0, 8).map((snapshot) => (
            <Link key={snapshot.id} href={`/${snapshot.format === "solo" ? "debate" : "pvp"}/${snapshot.id}`} className={`dna-recent-row ${selected?.id === snapshot.id ? "selected" : ""}`} onClick={() => setSelectedSnapshotId(snapshot.id)}>
              <span className="dna-recent-format">{snapshot.format === "solo" ? "Solo" : "PvP"}</span>
              <span className="dna-recent-topic"><strong>{snapshot.topicTitle}</strong><small>{formatDate(snapshot.completedAt)} · {snapshot.rounds || "—"} rounds</small></span>
              <span className="dna-recent-score">{formatScore(snapshot.score)}<small>{snapshot.analysed ? " / 100" : ""}</small></span>
              <span className="dna-recent-chevron" aria-hidden="true">↗</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="dna-footer-cta">
        <div><p className="dna-overline">Next rep</p><h2>Make one move explicit in the next round.</h2><p>Pick the pattern above, then watch whether the graph changes with you.</p></div>
        <Link href="/" className="btn btn-primary">Debate now <span aria-hidden="true">→</span></Link>
      </section>
    </div>
  );
}
