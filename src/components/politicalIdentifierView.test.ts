import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(relative: string): string {
  return readFileSync(path.join(process.cwd(), relative), "utf8");
}

describe("political identifier view", () => {
  it("renders a verdict, a division ledger and an honest note", () => {
    const s = source("src/components/PoliticalIdentifierView.tsx");
    expect(s).toContain('<PageHeader');
    expect(s).toContain('title="Political identifier"');
    expect(s).toContain("pattern of choices, not a measure of your beliefs");
    expect(s).toContain('className="pid-verdict-line"');
    expect(s).toContain("The division ledger");
    expect(s).toContain("How to read this");
  });

  it("gates low samples and never invents a fake result", () => {
    const s = source("src/components/PoliticalIdentifierView.tsx");
    expect(s).toContain('model.state !== "ok" || model.total === 0');
    expect(s).toContain("Positions taken");
    expect(s).toContain("Argue today&apos;s motion");
    expect(s).not.toContain("compass");
  });

  it("keeps its styles scoped and respects reduced motion", () => {
    const css = source("src/app/globals.css");
    expect(css).toContain(".pid-verdict-line {");
    expect(css).toContain(".pid-row {");
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]{0,200}\.pid-verdict-line \{ animation: none; \}/);
  });
});
