import { NextResponse } from "next/server";
import { createClient } from "@/lib/backend/server";
import { checkRateLimitKey } from "@/lib/rateLimit";

/**
 * Account deletion (UK GDPR erasure).
 *
 * Safeguards, in order:
 *  1. valid session cookie,
 *  2. typed confirmation ("DELETE"),
 *  3. password re-authentication against the stored hash,
 *  4. one atomic SQL call (`delete_app_account`, migration 037) — a failure
 *     rolls back completely, so an error never means a half-deleted account,
 *  5. session cookie cleared afterwards.
 */
export async function DELETE(request: Request) {
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limit = await checkRateLimitKey(user.id, { name: "account-delete", limit: 3, windowMs: 15 * 60_000 });
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many attempts. Please wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds), "Cache-Control": "no-store" } },
    );
  }

  const body = (await request.json().catch(() => null)) as { confirm?: unknown; password?: unknown } | null;
  const confirm = typeof body?.confirm === "string" ? body.confirm : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (confirm !== "DELETE") {
    return NextResponse.json({ error: 'Type "DELETE" to confirm deletion.', code: "confirm_required" }, { status: 400 });
  }
  if (!password) {
    return NextResponse.json({ error: "Enter your password to confirm deletion.", code: "password_required" }, { status: 400 });
  }

  const verified = await db.auth.signInWithPassword({ email: user.email, password });
  if (verified.error || !verified.data.user || verified.data.user.id !== user.id) {
    return NextResponse.json({ error: "Incorrect password. Nothing was deleted.", code: "invalid_password" }, { status: 401 });
  }

  try {
    const { data, error } = await db.rpc("delete_app_account", { p_user_id: user.id });
    if (error) {
      console.error("Account deletion failed:", error.message);
      return NextResponse.json(
        { error: "Deletion could not complete; nothing was removed. Please retry.", code: "deletion_failed" },
        { status: 500 },
      );
    }
    await db.auth.signOut();
    return NextResponse.json({ deleted: true, summary: data ?? null }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Account deletion failed:", error);
    return NextResponse.json(
      { error: "Deletion could not complete; nothing was removed. Please retry.", code: "deletion_failed" },
      { status: 500 },
    );
  }
}
