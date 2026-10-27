import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_THEME, normaliseTheme, resolveTheme, THEME_BOOTSTRAP, THEME_STORAGE_KEY } from "./themeBootstrap";

// Dark is the brand default; Light and "Match device" are reader choices. The
// inline pre-paint script must agree with resolveTheme, or a reader sees one
// theme flash before the app corrects it.

function runBootstrap(stored: string | null, systemDark: boolean): "dark" | "light" {
  const classes = new Set<string>(["dark"]);
  const root = {
    classList: { toggle: (name: string, on: boolean) => (on ? classes.add(name) : classes.delete(name)) },
    dataset: {} as Record<string, string>,
    style: {} as Record<string, string>,
  };
  const fn = new Function("localStorage", "window", "document", THEME_BOOTSTRAP);
  fn(
    { getItem: (key: string) => (key === THEME_STORAGE_KEY ? stored : null) },
    { matchMedia: () => ({ matches: systemDark }) },
    { documentElement: root },
  );
  expect(root.dataset.theme).toBe(classes.has("dark") ? "dark" : "light");
  return classes.has("dark") ? "dark" : "light";
}

describe("theme preference", () => {
  it("defaults to dark, by design", () => {
    expect(DEFAULT_THEME).toBe("dark");
    expect(normaliseTheme(null)).toBe("dark");
    expect(normaliseTheme("purple")).toBe("dark");
  });

  it("resolves Match device against the system setting", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("the pre-paint script agrees with resolveTheme for every stored value", () => {
    for (const stored of [null, "dark", "light", "system", "junk"]) {
      for (const systemDark of [true, false]) {
        expect(runBootstrap(stored, systemDark)).toBe(resolveTheme(normaliseTheme(stored), systemDark));
      }
    }
  });

  it("layout keeps dark on <html> for no-JS readers and runs the script in <head>", () => {
    const layout = readFileSync(join(process.cwd(), "src/app/layout.tsx"), "utf8");
    expect(layout).toContain('className={`dark ');
    expect(layout).toContain("THEME_BOOTSTRAP");
  });
});
