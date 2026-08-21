// Shareable debate analysis: render a markdown / OG-friendly summary for sharing.
// Replay + share are pure transforms over the verdict + transcript.

import type { PvpVerdict } from "./types";
import type { GraphEvidenceReport } from "./evidenceVerification";

export interface ShareOpts {
  topicTitle: string;
  verdict: PvpVerdict;
  playerAName: string;
  playerBName: string;
  evidenceReport?: GraphEvidenceReport;
  baseUrl?: string; // e.g. https://dailydebate.app — for replay link
  matchId?: string;
}

export function shareText(opts: ShareOpts): string {
  const v = opts.verdict;
  const insufficient = v.scoreStatus === "insufficient_evidence";
  const winner =
    v.winner === "tie" ? "Tie" : v.winner === "a" ? opts.playerAName : opts.playerBName;
  const line1 = insufficient
    ? `Debate: ${opts.topicTitle} — insufficient evidence; no winner assigned.`
    : `Debate: ${opts.topicTitle} — ${winner} won (${v.playerAScore}–${v.playerBScore}).`;
  const line2 = v.decidingFactor ? `Deciding factor: ${v.decidingFactor}` : v.rationale.slice(0, 180);
  const line3 = opts.evidenceReport
    ? `Evidence: coverage ${(opts.evidenceReport.coverage * 100).toFixed(0)}% · quality ${(opts.evidenceReport.avgQuality * 100).toFixed(0)}%`
    : "";
  const link = opts.baseUrl && opts.matchId ? `${opts.baseUrl}/pvp/${opts.matchId}` : "";
  return [line1, line2, line3, link].filter(Boolean).join("\n");
}

export function shareMarkdown(opts: ShareOpts): string {
  const v = opts.verdict;
  const insufficient = v.scoreStatus === "insufficient_evidence";
  const winner =
    v.winner === "tie" ? "**Tie**" : v.winner === "a" ? `**${opts.playerAName}**` : `**${opts.playerBName}**`;
  const rows: string[] = [
    `# ${opts.topicTitle}`,
    ``,
    insufficient ? `**Insufficient evidence** — no winner assigned.` : `${winner} won — ${v.playerAScore}–${v.playerBScore}.`,
    ``,
    `> ${v.rationale}`,
  ];
  if (v.decidingFactor) rows.push(``, `**Deciding factor:** ${v.decidingFactor}`);
  if (v.breakdown) {
    rows.push(
      ``,
      `|  | ${opts.playerAName} | ${opts.playerBName} |`,
      `|---|---:|---:|`,
      `| Claims | ${v.breakdown.a.claims} | ${v.breakdown.b.claims} |`,
      `| Evidence | ${v.breakdown.a.evidence} | ${v.breakdown.b.evidence} |`,
      `| Rebuttals | ${v.breakdown.a.rebuttals} | ${v.breakdown.b.rebuttals} |`,
      `| Fallacies | ${v.breakdown.a.fallacies} | ${v.breakdown.b.fallacies} |`,
    );
  }
  if (opts.evidenceReport) {
    rows.push(
      ``,
      `**Evidence:** coverage ${(opts.evidenceReport.coverage * 100).toFixed(0)}% · quality ${(opts.evidenceReport.avgQuality * 100).toFixed(0)}% · hallucinations ${opts.evidenceReport.hallucinationCount}`,
    );
  }
  if (opts.baseUrl && opts.matchId) rows.push(``, `[Replay](${opts.baseUrl}/pvp/${opts.matchId})`);
  return rows.join("\n");
}

export function replayUrl(baseUrl: string, matchId: string): string {
  return `${baseUrl.replace(/\/$/, "")}/pvp/${matchId}`;
}

