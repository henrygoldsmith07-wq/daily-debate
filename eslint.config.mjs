import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Only this project is linted. The working directory can be shared with
  // unrelated checkouts, and a bare `eslint` would walk every one of them,
  // turning a project gate into a workspace-wide one.
  //
  // This was previously an ever-growing list of sibling project names. That
  // model rots on its own: each new sibling checkout had to be added by hand,
  // and any one missed entry made `npm run lint` either lint someone else's
  // code or crash outright on a file this project does not own. The list is now
  // inverted — ignore every top-level directory, then re-admit the ones this
  // repository actually contains — so an unknown sibling is excluded by
  // default and a new project directory is opted in by adding one line.
  globalIgnores([
    // Build and dependency output.
    ".next/**",
    "out/**",
    "build/**",
    "node_modules/**",
    "next-env.d.ts",
    "*.tsbuildinfo",
    // Everything at the top level is assumed to be somebody else's checkout
    // until this project claims it below.
    //
    // `*/` matches top-level DIRECTORIES only, so it left loose files at the
    // repo root linted — a stray scratch script (`_probe.cjs`, `_check.mjs`)
    // then failed `npm run lint -- --max-warnings 0` and turned the project's
    // own gate into a "did someone leave a note on the table" gate. `*.*`
    // closes that gap; the root config files this project owns are re-admitted
    // at the bottom of this list.
    "*/",
    "*.*",
    // ...and this project claims exactly these.
    "!.github/**",
    "!config/**",
    "!daily-debate-site/**",
    "!database/**",
    "!docs/**",
    "!public/**",
    "!scripts/**",
    "!src/**",
    "!tests/**",
    // Root config files this project owns and does want linted.
    "!eslint.config.mjs",
    "!next.config.ts",
    "!playwright.config.ts",
    "!postcss.config.mjs",
    "!vitest.config.mts",
  ]),
]);

export default eslintConfig;
