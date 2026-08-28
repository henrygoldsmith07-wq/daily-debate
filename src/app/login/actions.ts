"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/backend/server";

export interface AuthState {
  error: string | null;
}

export async function signIn(_prevState: AuthState, formData: FormData): Promise<AuthState> {
  const db = await createClient();
  const { error } = await db.auth.signInWithPassword({
    email: String(formData.get("email")),
    password: String(formData.get("password")),
  });
  if (error) return { error: error.message };

  revalidatePath("/", "layout");
  redirect("/");
}

export async function signUp(_prevState: AuthState, formData: FormData): Promise<AuthState> {
  const db = await createClient();
  const { error } = await db.auth.signUp({
    email: String(formData.get("email")),
    password: String(formData.get("password")),
    options: { data: { display_name: String(formData.get("displayName") || "") } },
  });
  if (error) return { error: error.message };

  revalidatePath("/", "layout");
  redirect("/");
}

export async function signOut() {
  const db = await createClient();
  await db.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}
