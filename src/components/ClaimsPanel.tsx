"use client";

import { useMemo, useState } from "react";
import { claimCounts, extractClaims, type ClaimKind, type ClaimSource } from "@/lib/claims";

const KIND_LABEL: Record<ClaimKind, string> = {
  checkable: "Checkable",
  opinion: "Opinion",
  claim: "Claim",
};

type Filter = "all" | ClaimKind;

/**
 * Every claim made in a finished debate, attributed to whoever made it and
 * tagged by how it is phrased (src/lib/claims.ts). The note under the heading
 * is not optional: a "Checkable" tag means "could be looked up", and a reader
 * must never take it for "true".
 */
export default function ClaimsPanel({ sources }: { sources: ClaimSource[] }) {
  const claims = useMemo(() => extractClaims(sources), [sources]);
  const counts = useMemo(() => claimCounts(claims), [claims]);
  const [filter, setFilter] = useState<Filter>("all");
  if (claims.length === 0) return null;

  const shown = filter === "all" ? claims : claims.filter((claim) => claim.kind === filter);
  const speakers = [...new Set(shown.map((claim) => claim.speaker))];

  return (
    <details className="claims-panel surface-card" data-testid="claims-panel">
      <summary className="claims-panel-summary">
        <span>
          <span className="claims-panel-kicker">Claims in this debate</span>
          <span className="claims-panel-title">
            {claims.length} claim{claims.length === 1 ? "" : "s"} · {counts.checkable} checkable · {counts.opinion} opinion
          </span>
        </span>
        <span className="claims-panel-chevron" aria-hidden="true">+</span>
      </summary>
      <div className="claims-panel-body">
        <p className="claims-panel-note">
          Tags describe how each claim is phrased, not whether it is true. Checkable means it names something you
          could look up.
        </p>
        <div className="claims-filter" role="group" aria-label="Filter claims">
          {(["all", "checkable", "opinion", "claim"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={filter === option}
              onClick={() => setFilter(option)}
              className="claims-filter-chip"
            >
              {option === "all" ? `All ${claims.length}` : `${KIND_LABEL[option]} ${counts[option]}`}
            </button>
          ))}
        </div>
        {speakers.map((speaker) => (
          <section key={speaker} className="claims-speaker" aria-label={`Claims by ${speaker}`}>
            <h3 className="claims-speaker-name">
              {speaker}
              {shown.find((claim) => claim.speaker === speaker)?.side ? (
                <span className="claims-speaker-side"> · {shown.find((claim) => claim.speaker === speaker)?.side}</span>
              ) : null}
            </h3>
            <ol className="claims-list">
              {shown
                .filter((claim) => claim.speaker === speaker)
                .map((claim) => (
                  <li key={claim.id} className="claims-item">
                    <span className={`claims-tag claims-tag-${claim.kind}`}>{KIND_LABEL[claim.kind]}</span>
                    <span className="claims-text">{claim.text}</span>
                    <span className="claims-round">R{claim.round}</span>
                  </li>
                ))}
            </ol>
          </section>
        ))}
        {shown.length === 0 && <p className="claims-panel-note">No {filter} claims in this debate.</p>}
      </div>
    </details>
  );
}
