import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Only this project is linted. The working directory can be shared with
  // unrelated checkouts, and a bare `eslint` would walk every one of them,
  // turning a project gate into a workspace-wide one.
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Sibling projects that intermittently live in this working directory.
    "draftwise/**",
    "pulse/**",
    "rapport/**",
    "road-ready/**",
    "mental-load-tracker/**",
    "french-practice/**",
    "slimout/**",
    "emotion-tracker/**",
    "life-essential-skills/**",
    "revise/**",
    "forq/**",
  ]),
]);

export default eslintConfig;
