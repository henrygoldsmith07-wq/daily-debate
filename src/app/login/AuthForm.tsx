"use client";

import { useActionState, useState } from "react";
import { signIn, signUp, type AuthState } from "./actions";

const initialState: AuthState = { error: null };

export default function AuthForm() {
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [signInState, signInAction, signInPending] = useActionState(signIn, initialState);
  const [signUpState, signUpAction, signUpPending] = useActionState(signUp, initialState);

  const action = mode === "sign-in" ? signInAction : signUpAction;
  const state = mode === "sign-in" ? signInState : signUpState;
  const pending = mode === "sign-in" ? signInPending : signUpPending;

  return (
    <div className="surface-raised flex w-full max-w-sm flex-col gap-6 p-6">
      <div className="flex gap-4 border-b border-[var(--rule)]">
        <button
          type="button"
          onClick={() => setMode("sign-in")}
          aria-pressed={mode === "sign-in"}
          className={`-mb-px border-b-2 px-1 pb-2 text-sm font-medium ${
            mode === "sign-in" ? "border-[var(--accent)] text-[var(--foreground)]" : "border-transparent text-ink3"
          }`}
        >
          Sign in
        </button>
        <button
          type="button"
          onClick={() => setMode("sign-up")}
          aria-pressed={mode === "sign-up"}
          className={`-mb-px border-b-2 px-1 pb-2 text-sm font-medium ${
            mode === "sign-up" ? "border-[var(--accent)] text-[var(--foreground)]" : "border-transparent text-ink3"
          }`}
        >
          Create account
        </button>
      </div>

      <form action={action} className="flex flex-col gap-4">
        {mode === "sign-up" && (
          <label className="flex flex-col gap-1 text-sm">
            Display name
            <input
              name="displayName"
              type="text"
              autoComplete="name"
              className="rounded border border-[var(--rule)] bg-transparent px-3 py-2 text-sm"
            />
          </label>
        )}
        <label className="flex flex-col gap-1 text-sm">
          Email
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            className="rounded border border-[var(--rule)] bg-transparent px-3 py-2 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Password
          <input
            name="password"
            type="password"
            required
            minLength={6}
            autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
            className="rounded border border-[var(--rule)] bg-transparent px-3 py-2 text-sm"
          />
        </label>

        {state.error && (
          <p role="alert" className="text-sm text-[var(--bad)]">
            {state.error}
          </p>
        )}

        <button type="submit" disabled={pending} className="btn btn-primary px-4 py-2 text-sm disabled:opacity-40">
          {pending ? "Please wait…" : mode === "sign-in" ? "Sign in" : "Create account"}
        </button>
      </form>
    </div>
  );
}
