/**
 * Client-safe feature flags.
 *
 * These are read through `process.env` so they work in both server and client
 * components: Next.js inlines `NEXT_PUBLIC_*` values at build time. A flag is
 * ON only when the variable is exactly "1" — unset, empty, or any other value
 * means OFF, so production never drifts into an experimental surface by
 * accident.
 *
 * `NEXT_PUBLIC_EXPERIMENTAL_SURFACES` gates the surfaces the roadmap parks
 * until the daily loop has real weekly users: PvP, friend challenges, voice
 * input, and the corpus-validation destinations. The flag hides them from
 * navigation and primary entry points only — every route, component, and test
 * behind the flag stays in the codebase and passes with the flag set to "1"
 * (the e2e webServer sets it, because those specs exist to exercise these
 * surfaces).
 */

export function experimentalSurfacesEnabled(): boolean {
  return process.env.NEXT_PUBLIC_EXPERIMENTAL_SURFACES === "1";
}
