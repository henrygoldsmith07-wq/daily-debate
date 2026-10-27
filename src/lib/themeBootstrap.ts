// Theme preference: the parts with no React, so the server layout can import
// the pre-paint script. The client hook lives in themePreference.ts.

export type ThemePreference = "dark" | "system" | "light";

export const THEME_STORAGE_KEY = "daily-debate:theme";
export const DEFAULT_THEME: ThemePreference = "dark";

export const THEME_OPTIONS: { key: ThemePreference; label: string }[] = [
  { key: "dark", label: "Dark" },
  { key: "system", label: "Match device" },
  { key: "light", label: "Light" },
];

/** Status bar colour: the page canvas (--bg in le-studio.css) for each theme. */
export const THEME_COLOR = { dark: "#0b0b0d", light: "#f4f4f6" } as const;

const DARK_QUERY = "(prefers-color-scheme: dark)";

export function normaliseTheme(value: string | null | undefined): ThemePreference {
  return value === "light" || value === "system" || value === "dark" ? value : DEFAULT_THEME;
}

export function resolveTheme(preference: ThemePreference, prefersDark: boolean): "dark" | "light" {
  if (preference === "system") return prefersDark ? "dark" : "light";
  return preference;
}

/**
 * Runs inline in <head> before first paint. Keep it dependency-free; it must
 * agree with `resolveTheme` above (themePreference.test.ts checks it).
 *
 * Also points the status-bar meta at the resolved canvas colour: the server
 * can only emit the default (dark), so without this a light reader's browser
 * UI keeps the dark canvas colour until they toggle the theme by hand.
 */
export const THEME_BOOTSTRAP = `(function(){try{var p=localStorage.getItem("${THEME_STORAGE_KEY}");var d=p==="light"?false:p==="system"?window.matchMedia("${DARK_QUERY}").matches:true;var h=document.documentElement;h.classList.toggle("dark",d);h.dataset.theme=d?"dark":"light";h.style.colorScheme=d?"dark":"light";var m=document.querySelector&&document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content",d?"${THEME_COLOR.dark}":"${THEME_COLOR.light}");}catch(e){}})();`;
