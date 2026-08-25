#!/usr/bin/env node
// Seeds test users into an ephemeral/local Supabase instance.
// Uses the Admin API which requires the service_role key.
//
// Usage: node scripts/e2e-seed.mjs
// Env: SUPABASE_URL (default http://127.0.0.1:54321)
//      SUPABASE_SERVICE_ROLE_KEY

const url = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!key) {
  console.error("[e2e-seed] SUPABASE_SERVICE_ROLE_KEY is required.");
  process.exit(1);
}

const USERS = [
  "e2e-a@test.local",
  "e2e-b@test.local",
  "e2e-c@test.local",
];

async function signUp(email) {
  const res = await fetch(`${url}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email,
      password: "e2e-test-pass-123",
      email_confirm: true,
    }),
  });
  // 200 = created; 422 = already exists (fine for re-runs)
  if (!res.ok && res.status !== 422) {
    const body = await res.text().catch(() => "");
    throw new Error(`Seed ${email}: ${res.status} ${body.slice(0, 200)}`);
  }
  console.log(`[seed] ${res.status === 422 ? "exists" : "created"}: ${email}`);
}

async function main() {
  console.log(`[seed] Seeding users at ${url}/auth/v1/admin/users`);
  for (const email of USERS) {
    await signUp(email);
  }
  console.log("[seed] Done.");
}

main().catch((e) => {
  process.stderr.write(String(e?.stack ?? e) + "\n");
  process.exit(1);
});
