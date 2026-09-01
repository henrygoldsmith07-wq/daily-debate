"use client";

import { useActionState, useState } from "react";
import { requestPasswordReset, type AuthState } from "../actions";

const initialState: AuthState = { error: null };

/**
 * Forgot-password form. On success it tells the user to check their email
 * (or the server console in dev mode) without ever confirming whether the
 * address exists — the same non-enumeration rule as the backend.
 */
export default function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(requestPasswordReset, initialState);
  const [submitted, setSubmitted] = useState(false);

  if (submitted && !state.error) {
    return (
      <div className="surface-raised flex w-full max-w-sm flex-col gap-4 p-6 text-center">
        <h2 className="font-semibold">Check your inbox</h2>
        <p className="text-sm text-ink3">
          If an account exists for that email, a reset link is on its way. The link is valid for 30 minutes.
        </p>
        <p className="text-xs text-ink3">
          Running locally without email configured? The reset token is printed in the dev server console.
        </p>
      </div>
    );
  }

  return (
    <div className="surface-raised flex w-full max-w-sm flex-col gap-6 p-6">
      <div className="flex flex-col gap-1 text-center">
        <h2 className="font-semibold">Reset your password</h2>
        <p className="text-sm text-ink3">Enter your account email and we will send a reset link.</p>
      </div>

      <form
        action={async (formData) => {
          await action(formData);
          setSubmitted(true);
        }}
        className="flex flex-col gap-4"
      >
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

        {state.error && (
          <p role="alert" className="text-sm text-[var(--bad)]">
            {state.error}
          </p>
        )}

        <button type="submit" disabled={pending} className="btn btn-primary px-4 py-2 text-sm disabled:opacity-40">
          {pending ? "Please wait…" : "Send reset link"}
        </button>
      </form>
    </div>
  );
}
