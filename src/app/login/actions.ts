"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/backend/server";
import { checkRateLimitKey } from "@/lib/rateLimit";
import { safeReturnPath } from "@/lib/authRedirect";

export interface AuthState {
  error: string | null;
}

const AUTH_LIMIT_MESSAGE = "Too many attempts. Please wait a little before trying again.";

function privateIdentity(value: string): string {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex").slice(0, 24);
}

async function authActionLimited(
  name: string,
  identity: string,
  limits: { ip: number; identity: number; windowMs: number },
): Promise<boolean> {
  const requestHeaders = await headers();
  const forwarded = requestHeaders.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || requestHeaders.get("x-real-ip")?.trim() || "unknown";
  const [ipResult, identityResult] = await Promise.all([
    checkRateLimitKey(`ip:${ip}`, { name, limit: limits.ip, windowMs: limits.windowMs, failClosed: true }),
    checkRateLimitKey(`identity:${privateIdentity(identity)}`, {
      name,
      limit: limits.identity,
      windowMs: limits.windowMs,
      failClosed: true,
    }),
  ]);
  return !ipResult.ok || !identityResult.ok;
}

export async function signIn(_prevState: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email"));
  const nextPath = safeReturnPath(formData.get("next"));
  if (await authActionLimited("auth-sign-in", email, { ip: 20, identity: 8, windowMs: 15 * 60_000 })) {
    return { error: AUTH_LIMIT_MESSAGE };
  }
  const db = await createClient();
  const { error } = await db.auth.signInWithPassword({
    email,
    password: String(formData.get("password")),
  });
  if (error) return { error: error.message };

  revalidatePath("/", "layout");
  redirect(nextPath);
}

export async function signUp(_prevState: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email"));
  const nextPath = safeReturnPath(formData.get("next"));
  if (await authActionLimited("auth-sign-up", email, { ip: 8, identity: 3, windowMs: 60 * 60_000 })) {
    return { error: AUTH_LIMIT_MESSAGE };
  }
  const db = await createClient();
  const { error } = await db.auth.signUp({
    email,
    password: String(formData.get("password")),
    options: { data: { display_name: String(formData.get("displayName") || "") } },
  });
  if (error) return { error: error.message };

  revalidatePath("/", "layout");
  redirect(nextPath);
}

export async function signOut() {
  const db = await createClient();
  await db.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}

export async function requestPasswordReset(_prevState: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email"));
  if (await authActionLimited("auth-reset-request", email, { ip: 8, identity: 4, windowMs: 15 * 60_000 })) {
    return { error: AUTH_LIMIT_MESSAGE };
  }
  const db = await createClient();
  const { error } = await db.auth.requestPasswordReset(email);
  if (error) return { error: error.message };
  return { error: null };
}

export async function resetPassword(_prevState: AuthState, formData: FormData): Promise<AuthState> {
  const token = String(formData.get("token"));
  if (await authActionLimited("auth-reset-consume", token, { ip: 20, identity: 8, windowMs: 15 * 60_000 })) {
    return { error: AUTH_LIMIT_MESSAGE };
  }
  const db = await createClient();
  const { error } = await db.auth.resetPassword({
    token,
    newPassword: String(formData.get("newPassword")),
  });
  if (error) return { error: error.message };
  return { error: null };
}
