#!/usr/bin/env node
// Seeds deterministic users into a migrated test Postgres database.
// Usage: DATABASE_URL=... node scripts/e2e-seed.mjs

import { neon } from "@neondatabase/serverless";
import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  console.error("[e2e-seed] DATABASE_URL is required.");
  process.exit(1);
}

const sql = neon(databaseUrl);
const scrypt = promisify(scryptCallback);
const password = process.env.E2E_TEST_PASSWORD ?? "e2e-test-pass-123";
const users = ["e2e-a@test.local", "e2e-b@test.local", "e2e-c@test.local"];

async function passwordHash(value) {
  const salt = randomBytes(16);
  const derived = await scrypt(value, salt, 64);
  return `scrypt$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

async function seedUser(email) {
  const existing = await sql.query("SELECT id FROM app_users WHERE email = $1", [email]);
  if (existing.length) {
    console.log(`[seed] exists: ${email}`);
    return;
  }

  const hash = await passwordHash(password);
  await sql.query(
    `WITH new_user AS (
       INSERT INTO app_users (email, password_hash) VALUES ($1, $2)
       RETURNING id
     )
     INSERT INTO profiles (id, username)
     SELECT id, $3 FROM new_user`,
    [email, hash, email.split("@")[0]],
  );
  console.log(`[seed] created: ${email}`);
}

for (const email of users) await seedUser(email);
console.log("[seed] Done.");
