"use server";

import { AuthError } from "next-auth";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/backend/server";
import { signIn as authSignIn, signOut as authSignOut } from "@/lib/backend/auth-config";

export interface AuthState {
  error: string | null;
}

/**
 * Auth.js signals a rejected credential by throwing `CredentialsSignin`, and
 * `redirect()` works by throwing too — so the redirect must happen OUTSIDE
 * the try block, or it would be caught and reported as a sign-in failure.
 */
async function signInWithPassword(email: string, password: string): Promise<string | null> {
  try {
    await authSignIn("credentials", { email, password, redirect: false });
    return null;
  } catch (error) {
    if (error instanceof AuthError) return "Invalid email or password.";
    throw error;
  }
}

export async function signIn(_prevState: AuthState, formData: FormData): Promise<AuthState> {
  const error = await signInWithPassword(
    String(formData.get("email")),
    String(formData.get("password")),
  );
  if (error) return { error };

  revalidatePath("/", "layout");
  redirect("/");
}

export async function signUp(_prevState: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email"));
  const password = String(formData.get("password"));

  const db = await createClient();
  const { error } = await db.auth.signUp({
    email,
    password,
    options: { data: { display_name: String(formData.get("displayName") || "") } },
  });
  if (error) return { error: error.message };

  // Registration does not mint a session; sign the new account in.
  const signInError = await signInWithPassword(email, password);
  if (signInError) return { error: signInError };

  revalidatePath("/", "layout");
  redirect("/");
}

/** Hands off to Google. The consent screen is a full navigation by nature. */
export async function signInWithGoogle() {
  await authSignIn("google", { redirectTo: "/" });
}

export async function signOut() {
  await authSignOut({ redirect: false });
  revalidatePath("/", "layout");
  redirect("/login");
}
