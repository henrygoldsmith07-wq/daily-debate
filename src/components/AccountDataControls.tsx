"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Self-service data export and account deletion (UK GDPR), rendered on the
 * privacy page. Deletion needs typed confirmation + password re-auth; both
 * flows surface server errors verbatim instead of failing silently.
 */
export default function AccountDataControls({ signedIn, email }: { signedIn: boolean; email: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"export" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [showDelete, setShowDelete] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [password, setPassword] = useState("");

  if (!signedIn) {
    return (
      <p className="rounded-lg border border-ink3/30 bg-[var(--surface,#12141a)] p-3 text-sm text-ink3">
        Sign in to export or delete your data from this page. Export also works from any signed-in session.
      </p>
    );
  }

  async function handleExport() {
    setBusy("export");
    setError(null);
    setDone(null);
    try {
      const res = await fetch("/api/account/export");
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? `Export failed (${res.status}).`);
      const blob = new Blob([JSON.stringify(body, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `daily-debate-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setDone("Export downloaded — a JSON file of everything associated with your account.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete() {
    if (confirm !== "DELETE" || !password) {
      setError('Type DELETE and enter your password to confirm deletion.');
      return;
    }
    setBusy("delete");
    setError(null);
    setDone(null);
    try {
      const res = await fetch("/api/account", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm, password }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? `Deletion failed (${res.status}).`);
      setDone("Account deleted. Redirecting…");
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Deletion failed.");
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-ink3/30 p-4">
        <p className="text-sm text-ink2">
          Signed in as <strong>{email}</strong>
        </p>
        <button
          type="button"
          onClick={handleExport}
          disabled={busy !== null}
          className="btn btn-secondary mt-3 px-3 py-2 text-sm"
        >
          {busy === "export" ? "Preparing export…" : "Download my data (JSON)"}
        </button>
      </div>

      <div className="rounded-lg border border-red-500/40 p-4">
        <p className="text-sm font-semibold text-red-400">Delete my account</p>
        <p className="mt-1 text-xs leading-5 text-ink3">
          Immediate and irreversible: account, debates, progress, shared PvP matches, invites naming you, and your
          corpus contributions are erased. Aggregate telemetry with no personal identifiers is kept. Export first if
          you want a copy.
        </p>
        {!showDelete ? (
          <button
            type="button"
            onClick={() => setShowDelete(true)}
            disabled={busy !== null}
            className="btn btn-secondary mt-3 px-3 py-2 text-sm"
          >
            Continue to deletion…
          </button>
        ) : (
          <div className="mt-3 space-y-2">
            <label className="block text-xs text-ink3">
              Type <span className="font-mono font-semibold text-ink2">DELETE</span> to confirm
              <input
                type="text"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="off"
                className="mt-1 w-full rounded-md border border-ink3/40 bg-transparent px-2 py-1.5 text-sm text-ink2"
              />
            </label>
            <label className="block text-xs text-ink3">
              Your password
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                className="mt-1 w-full rounded-md border border-ink3/40 bg-transparent px-2 py-1.5 text-sm text-ink2"
              />
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleDelete}
                disabled={busy !== null}
                className="btn btn-secondary px-3 py-2 text-sm text-red-400"
              >
                {busy === "delete" ? "Deleting…" : "Delete my account"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowDelete(false);
                  setConfirm("");
                  setPassword("");
                  setError(null);
                }}
                disabled={busy !== null}
                className="btn btn-ghost px-3 py-2 text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
      {done && (
        <p role="status" className="text-sm text-emerald-400">
          {done}
        </p>
      )}
    </div>
  );
}
