"use client";

import { useActionState, useState } from "react";
import { useSearchParams } from "next/navigation";
import { resetPassword, type AuthState } from "../actions";

const initialState: AuthState = { error: null };

/**
 * Reset-password form. Reads the token from the reset link's query string,
 * submits it with the new password, and on success sends the user back to
 * sign in (all prior sessions were revoked when the token was consumed).
 */
export default function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [state, action, pending] = useActionState(resetPassword, initialState);
  const [done, setDone] = useState(false);

  if (done && !state.error) {
    return (
      <div className="surface-raised flex w-full max-w-sm flex-col gap-4 p-6 text-center">
        <h2 className="font-semibold">Password updated</h2>
        <p className="text-sm text-ink3">
          Your password has been changed. For your security, all previous sign-ins were ended — please sign in with
          your new password.
        </p>
      </div>
    );
  }

  return (
    <div className="surface-raised flex w-full max-w-sm flex-col gap-6 p-6">
      <div className="flex flex-col gap-1 text-center">
        <h2 className="font-semibold">Choose a new password</h2>
        <p className="text-sm text-ink3">Enter a new password for your account.</p>
      </div>

      <form
        action={async (formData) => {
          await action(formData);
          setDone(true);
        }}
        className="flex flex-col gap-4"
      >
        <input type="hidden" name="token" value={token} />

        {!token && (
          <p role="alert" className="text-sm text-[var(--bad)]">
            This link is missing its reset token. Please use the link from your email, or request a new one.
          </p>
        )}

        <label className="flex flex-col gap-1 text-sm">
          New password
          <input
            name="newPassword"
            type="password"
            required
            minLength={8}
            maxLength={128}
            autoComplete="new-password"
            className="rounded border border-[var(--rule)] bg-transparent px-3 py-2 text-sm"
          />
        </label>

        {state.error && (
          <p role="alert" className="text-sm text-[var(--bad)]">
            {state.error}
          </p>
        )}

        <button type="submit" disabled={pending || !token} className="btn btn-primary px-4 py-2 text-sm disabled:opacity-40">
          {pending ? "Please wait…" : "Update password"}
        </button>
      </form>
    </div>
  );
}
