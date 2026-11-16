import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(relative: string): string {
  return readFileSync(path.join(process.cwd(), relative), "utf8");
}

describe("reader preferences keyboard accessibility", () => {
  const component = source("src/components/ReaderPreferences.tsx");

  it("uses roving tabindex so only the checked theme radio is in the tab order", () => {
    expect(component).toContain("tabIndex={selected ? 0 : -1}");
  });

  it("handles arrow keys on the theme radios and focuses the newly selected option", () => {
    expect(component).toContain("onKeyDown={onThemeKeyDown}");
    // The handler must walk THEME_OPTIONS and move focus, per the WAI-ARIA
    // radio pattern documented in RateForm.
    expect(component).toMatch(/onThemeKeyDown[\s\S]*ArrowRight[\s\S]*ArrowLeft[\s\S]*THEME_OPTIONS[\s\S]*\.focus\(\)/);
  });

  it("does not square off buttons in the :focus-visible rule", () => {
    const css = source("src/app/le-studio.css");
    const focusVisible = css.match(/:focus-visible\s*\{([^}]*)\}/);
    expect(focusVisible).not.toBeNull();
    expect(focusVisible![1]).toContain("outline: 2px solid var(--ink)");
    expect(focusVisible![1]).toContain("outline-offset: 2px");
    expect(focusVisible![1]).not.toMatch(/border-radius/);
  });
});
