#!/usr/bin/env node
// Production deploy gate: apply pending migrations BEFORE the new code is
// built, so a migration failure fails the build and Vercel keeps the previous
// deployment live (never promotes a deployment whose schema state is unknown).
//
// Why the Vercel build step and not a GitHub Actions gate: Vercel's Git
// integration deploys main on its own, and a separate Actions job cannot
// order itself before that deploy unless production auto-deploy is disabled
// or deploys move to the CLI. The build step runs in the exact environment
// that becomes production, with the same env vars, and Vercel's atomic
// promotion provides the "old deployment stays live" property natively.
//
// Environment policy:
// - production builds (VERCEL_ENV=production): migrate -> db:status gate -> next build.
// - preview builds: migrations are SKIPPED by default — previews must not
//   share the production database (README). Once a preview-specific
//   DATABASE_URL is configured, opt in per-project with MIGRATE_ON_PREVIEW=1.
// - local/dev (VERCEL_ENV unset): skipped; run `npm run db:migrate` manually.

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const vercelEnv = process.env.VERCEL_ENV ?? "";
const shouldMigrate =
  vercelEnv === "production" || (vercelEnv === "preview" && process.env.MIGRATE_ON_PREVIEW === "1");

function runStep(label, args) {
  console.log(`[vercel-build] ${label}`);
  const result = spawnSync(process.execPath, args, { stdio: "inherit", cwd: root, env: process.env });
  if (result.status !== 0 || result.error) {
    console.error(
      `[vercel-build] ${label} failed (exit ${result.status ?? "signal"}) — deployment aborted; the previous deployment stays live.`,
    );
    process.exit(result.status ?? 1);
  }
}

if (shouldMigrate) {
  if (!process.env.DATABASE_URL?.trim()) {
    console.error(
      "[vercel-build] DATABASE_URL is not available to builds — refusing to promote code whose schema state is unverified. Mark DATABASE_URL as available to builds for this environment.",
    );
    process.exit(1);
  }
  runStep("applying pending migrations (ledger-based, idempotent)", [path.join(root, "scripts", "migrate.mjs")]);
  runStep("verifying the migration ledger is current (db:status)", [
    path.join(root, "scripts", "migrate.mjs"),
    "--status",
  ]);
} else {
  console.log(`[vercel-build] skipping migrations (VERCEL_ENV=${vercelEnv || "unset"})`);
}

const require = createRequire(import.meta.url);
const nextBin = path.join(path.dirname(require.resolve("next/package.json")), "dist", "bin", "next");
runStep("next build", [nextBin, "build"]);
