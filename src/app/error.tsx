"use client";

import Link from "next/link";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-xs uppercase tracking-wide text-ink3">Something went wrong</p>
      <h1 className="text-2xl font-semibold tracking-tight">This page hit an unexpected error</h1>
      <p className="max-w-sm text-sm text-ink3">
        It&apos;s not you — try again. If it keeps happening, come back in a moment.
      </p>
      <div className="flex gap-3">
        <button type="button" onClick={reset} className="btn btn-primary px-4 py-2 text-sm">
          Try again
        </button>
        <Link href="/" className="btn btn-ghost px-4 py-2 text-sm">
          Go home
        </Link>
      </div>
      {error.digest && <p className="tabular text-xs text-ink3">ref: {error.digest}</p>}
    </div>
  );
}
