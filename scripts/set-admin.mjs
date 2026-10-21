#!/usr/bin/env node
// Grant or revoke the operator admin role.
//
//   DATABASE_URL=... node scripts/set-admin.mjs grant  admin@example.com --actor "ops-oncall" --note "corpus moderation shift"
//   DATABASE_URL=... node scripts/set-admin.mjs revoke admin@example.com --actor "ops-oncall" --note "left the team"
//
// WHY THIS IS A SCRIPT AND NOT A ROUTE
// The admin role lives in `app_users.is_admin` (migration 039). It is granted
// out of band by whoever holds database access — the same trust level as
// running a migration. It CANNOT be self-claimed: the sign-up path never
// writes the column, no request body can set it, and the request-time gate
// (src/lib/adminAccess.ts) needs the database role AND the
// CORPUS_ADMIN_EMAILS allowlist to agree.
//
// The old gate compared the request's email against the allowlist alone.
// Because `app_users.email` is asserted by the person signing up and this
// codebase never verifies mailboxes, registering an allowlisted address that
// had no account yet granted admin over every corpus, ops and analytics
// surface — and locked the real administrator out, because that address could
// no longer be registered.
//
// Every grant and revocation is written to `admin_role_grants` (append-only).
//
// Exit codes: 0 = applied, 2 = usage/lookup error, 1 = database error.

import { createExecutor } from "./lib/sql-executor.mjs";

function fail(message) {
  process.stderr.write(`[set-admin] ${message}\n`);
  process.exit(2);
}

const argv = process.argv.slice(2);
const action = argv[0];
if (action !== "grant" && action !== "revoke") {
  fail("usage: node scripts/set-admin.mjs <grant|revoke> <email> [--actor <name>] [--note <text>]");
}

const email = (argv[1] ?? "").trim().toLowerCase();
if (!email) fail("an email address is required.");
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(`"${email}" is not a valid email address.`);

function flag(name) {
  const index = argv.indexOf(name);
  if (index === -1) return "";
  return (argv[index + 1] ?? "").trim();
}
const actor = flag("--actor") || process.env.ADMIN_ACTOR || "unknown";
const note = flag("--note") || null;

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  fail("DATABASE_URL is required.");
}

const query = await createExecutor(databaseUrl);

let rows;
try {
  rows = await query("SELECT id, email, is_admin FROM app_users WHERE email = $1 LIMIT 1", [email]);
} catch (error) {
  process.stderr.write(`[set-admin] database error: ${String(error?.message ?? error)}\n`);
  process.exit(1);
}

const user = rows?.[0];
if (!user) {
  fail(
    `no account exists for ${email}. The role can only be granted to an existing account — ` +
      `have the operator sign up first, then grant the role.`,
  );
}

const nextFlag = action === "grant";
if (Boolean(user.is_admin) === nextFlag) {
  process.stdout.write(
    `[set-admin] ${email} already ${action === "grant" ? "has" : "does not have"} the admin role; nothing to do.\n`,
  );
  process.exit(0);
}

try {
  await query("UPDATE app_users SET is_admin = $1 WHERE id = $2", [nextFlag, user.id]);
  await query(
    `INSERT INTO admin_role_grants (user_id, email, action, actor, note)
     VALUES ($1, $2, $3, $4, $5)`,
    [user.id, user.email, action, actor, note],
  );
} catch (error) {
  process.stderr.write(`[set-admin] database error: ${String(error?.message ?? error)}\n`);
  process.exit(1);
}

process.stdout.write(`[set-admin] ${action} recorded for ${email} (actor: ${actor}).\n`);

// The second factor: the allowlist. Say so loudly when the granted address
// would still be denied at request time.
const allowlist = process.env.CORPUS_ADMIN_EMAILS?.trim();
if (!allowlist) {
  process.stdout.write(
    "[set-admin] WARNING: CORPUS_ADMIN_EMAILS is not set, so the request-time admin gate will deny this account.\n",
  );
} else {
  const allowed = allowlist
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .includes(email);
  if (!allowed) {
    process.stdout.write(
      `[set-admin] WARNING: ${email} is not on CORPUS_ADMIN_EMAILS, so the request-time admin gate will still deny it.\n`,
    );
  }
}
process.exit(0);
