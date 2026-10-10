import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { READER_PREFERENCE_OPTIONS } from "./readerPreferences";

// The four accessibility preferences shipped their CSS before any UI applied
// them, so they were unreachable dead code. These tests pin the contract that
// makes that impossible to repeat silently:
//
//   1. every preference the UI offers has a matching CSS rule;
//   2. the inline pre-hydration script in layout.tsx names the same keys.
//
// If someone adds a preference to the options list without writing its CSS, or
// renames a class in the layout script, this fails.

const css = readFileSync(join(process.cwd(), "src/app/le-studio.css"), "utf8");
const layout = readFileSync(join(process.cwd(), "src/app/layout.tsx"), "utf8");

describe("accessibility preference wiring", () => {
  it("every offered preference has CSS behind it", () => {
    for (const option of READER_PREFERENCE_OPTIONS) {
      expect(css, `no CSS rule for .${option.key}`).toContain(`.${option.key}`);
    }
  });

  it("the inline pre-hydration script names every preference key", () => {
    for (const option of READER_PREFERENCE_OPTIONS) {
      expect(layout, `layout script does not know about ${option.key}`).toContain(option.key);
    }
  });

  it("the layout script and the option list agree exactly, with no extras", () => {
    const scripted = layout.match(/daily-debate:reader-preferences[\s\S]*?var k=\[([^\]]*)\]/);
    expect(scripted, "could not find the preference key list in layout.tsx").toBeTruthy();
    const keys = scripted![1]
      .split(",")
      .map((k) => k.trim().replace(/"/g, ""))
      .filter(Boolean)
      .sort();
    expect(keys).toEqual(READER_PREFERENCE_OPTIONS.map((o) => o.key).sort());
  });

  it("does not offer a preference with no visual effect at all", () => {
    // A checkbox that changes nothing is worse than no checkbox.
    for (const option of READER_PREFERENCE_OPTIONS) {
      const selector = new RegExp(`\\.${option.key}[\\s{,:]`);
      expect(selector.test(css), `.${option.key} has no rule body`).toBe(true);
    }
  });
});
