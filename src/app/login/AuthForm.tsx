"use client";

import { useActionState, useState } from "react";
import { signIn, signInWithGoogle, signUp, type AuthState } from "./actions";

const initialState: AuthState = { error: null };

/** Google's four-colour "G", inlined so the button needs no network image. */
function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.97 10.72a5.41 5.41 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z" />
    </svg>
  );
}

export default function AuthForm({ googleEnabled = false }: { googleEnabled?: boolean }) {
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

      {googleEnabled && (
        <>
          {/* Its own form: a server action posting straight to Google, so it
              never carries the email/password fields below. */}
          <form action={signInWithGoogle}>
            <button
              type="submit"
              className="flex w-full items-center justify-center gap-2 rounded border border-[var(--rule)] px-4 py-2 text-sm font-medium hover:bg-[var(--surface)]"
            >
              <GoogleMark />
              Continue with Google
            </button>
          </form>
          <div className="flex items-center gap-3">
            <span className="h-px flex-1 bg-[var(--rule)]" />
            <span className="text-xs text-ink3">or</span>
            <span className="h-px flex-1 bg-[var(--rule)]" />
          </div>
        </>
      )}

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
            minLength={8}
            maxLength={128}
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
