export type StartRetestResult = { ok: true; debateId: string } | { ok: false; error: string };

/** One-tap retest start: POST /api/solo/start with no skill hint (assignment is server-side). */
export async function startRetestRequest(
  topicId: string,
  doFetch: typeof fetch = fetch,
  online: boolean = typeof navigator === "undefined" || navigator.onLine !== false,
): Promise<StartRetestResult> {
  if (!online) return { ok: false, error: "You appear to be offline — reconnect and try again." };
  try {
    const res = await doFetch("/api/solo/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topicId, side: "challenge", format: "sprint" }),
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data?.error || "Failed to start debate." };
    if (!data?.debate?.id) return { ok: false, error: "Failed to start debate." };
    return { ok: true, debateId: String(data.debate.id) };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof TypeError ? "Network error — check your connection and try again." : "Failed to start debate.",
    };
  }
}
