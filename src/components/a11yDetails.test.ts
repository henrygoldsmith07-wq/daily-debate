import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(relative: string): string {
  return readFileSync(path.join(process.cwd(), relative), "utf8");
}

/** Return the first opening <div> tag carrying the given class. */
function divTagWithClass(source: string, className: string): string {
  const match = source.match(new RegExp(`<div[^>]*className="${className}"[^>]*>`));
  if (!match) throw new Error(`No opening <div> with class "${className}"`);
  return match[0];
}

/**
 * Assert that an sr-only explanation sits between a span's title attribute and
 * its visible text. Whitespace/nesting tolerant: only the ordering is checked.
 */
function assertHiddenExplanationBetween(
  source: string,
  titleNeedle: string,
  visibleNeedle: string,
  label: string,
  misses: string[],
): void {
  const titleAt = source.indexOf(titleNeedle);
  if (titleAt < 0) {
    misses.push(`${label}: title attribute missing`);
    return;
  }
  const visibleAt = source.indexOf(visibleNeedle, titleAt);
  if (visibleAt < 0) {
    misses.push(`${label}: visible text missing`);
    return;
  }
  if (!source.slice(titleAt, visibleAt).includes('<span className="sr-only">')) {
    misses.push(`${label}: sr-only sibling missing`);
  }
}

describe("accessibility detail guards", () => {
  it("gives the DNA direction glyph an accessible image role with its trend names", () => {
    const s = source("src/components/ArgumentDnaView.tsx");
    const tag = s.match(/<span[^>]*className="dna-direction"[^>]*>/);
    expect(tag).not.toBeNull();
    expect(tag![0]).toContain('role="img"');
    expect(tag![0]).toContain("aria-label=");
    expect(tag![0]).toContain("trending up");
    expect(tag![0]).toContain("needs attention");
    expect(tag![0]).toContain("holding steady");
  });

  it("exposes the two labelled DNA containers as groups", () => {
    const s = source("src/components/ArgumentDnaView.tsx");
    const graphFlow = divTagWithClass(s, "dna-graph-flow");
    expect(graphFlow).toContain('role="group"');
    expect(graphFlow).toContain("aria-label={`${label} argument graph`}");
    const periodRail = divTagWithClass(s, "dna-period-rail");
    expect(periodRail).toContain('role="group"');
    expect(periodRail).toContain('aria-label="Debate periods"');
  });

  it("names the CoachToday readout with visually hidden text, not a generic span aria-label", () => {
    const s = source("src/components/CoachToday.tsx");
    const tag = s.match(/<span[^>]*className="text-right text-ink2"[^>]*>/);
    expect(tag).not.toBeNull();
    expect(tag![0]).not.toContain("aria-label=");
    expect(s).toContain(
      '<span className="text-right text-ink2"><span className="sr-only">{label}: </span>{read}</span>',
    );
  });

  it("mirrors each hover-only ArgGraph explanation in an sr-only sibling", () => {
    const s = source("src/components/ArgGraphView.tsx");
    const misses: string[] = [];
    assertHiddenExplanationBetween(
      s,
      "title={`${evidenceClassLabel(n.evidenceStrength).short}: ${evidenceClassLabel(n.evidenceStrength).description}`}",
      "[{evidenceClassLabel(n.evidenceStrength).short}]",
      "evidence strength",
      misses,
    );
    assertHiddenExplanationBetween(
      s,
      "title={n.citations.map(",
      "↳ {n.citations.map((c) => c.sourceName).join(\", \")}",
      "citations",
      misses,
    );
    assertHiddenExplanationBetween(
      s,
      'title="Cited/strong evidence should carry a citation — the judge omitted one."',
      "⚠ no citation",
      "missing citation",
      misses,
    );
    expect(misses).toEqual([]);
    // The hidden text carries the same explanation as the retained title.
    expect(s).toContain(
      '<span className="sr-only">{`${evidenceClassLabel(n.evidenceStrength).short}: ${evidenceClassLabel(n.evidenceStrength).description}`}</span>',
    );
    expect(s).toContain(
      '<span className="sr-only">{n.citations.map((c) => `${c.sourceName}${c.homepage ? ` — ${c.homepage}` : ""}${c.excerpt ? `: ${c.excerpt}` : ""}`).join(" | ")}</span>',
    );
    expect(s).toContain(
      '<span className="sr-only">Cited/strong evidence should carry a citation — the judge omitted one.</span>',
    );
  });

  it("announces the RateForm loading and empty states as status regions", () => {
    const s = source("src/components/RateForm.tsx");
    const loading = s.match(/<p[^>]*>Loading…<\/p>/);
    expect(loading).not.toBeNull();
    expect(loading![0]).toContain('role="status"');
    const empty = s.match(/<div[^>]*className="surface-card p-8 text-center"[^>]*>/);
    expect(empty).not.toBeNull();
    expect(empty![0]).toContain('role="status"');
    // The existing toggle-group semantics must stay intact.
    expect(s).toContain('role="group" aria-label={`${title} ${DIMENSION_LABELS[dim] ?? dim}`}');
    expect(s).toContain('role="group" aria-label="Overall winner"');
  });
});
