// Lock-safe corpus closure repair (core logic for the CLI script).
//
// The previous version scanned aggregate counts and later wrote those
// pre-lock numbers back — a legitimate rating landing between scan and write
// re-created drift. This core never writes a stale number: for every item it
// runs a real transaction that takes the item's row lock FIRST, recounts
// AFTER the lock (so concurrent store-writes, which take the same lock,
// are impossible inside the window), and only then syncs the counter and
// closes the item if the FRESH count genuinely meets the threshold.
//
// Dry-run holds the same locks, reports exactly what apply would write, and
// ROLLBACKs — no mutation either way.

/**
 * Candidate scan (READ-ONLY hint list; never trusted for decisions).
 * Deliberately wide: drift, open items AT or ONE BELOW threshold (a racing
 * final rating may land between this scan and the lock), and closed-below
 * anomalies (re-opened so the remaining independent ratings can be collected).
 */
export async function findCandidates(query, minRaters) {
  return query(
    `SELECT ci.id, ci.status, ci.rating_count AS stored, count(cr.id)::int AS actual
       FROM corpus_items ci
       LEFT JOIN corpus_ratings cr ON cr.corpus_id = ci.id
      GROUP BY ci.id
      HAVING ci.rating_count <> count(cr.id)::int
          OR (ci.status = 'open' AND count(cr.id) >= $1 - 1)
          OR (ci.status = 'rated' AND count(cr.id) < $1)
      ORDER BY ci.id`,
    [minRaters],
  );
}

/**
 * Repair (or dry-run) ONE item under its row lock.
 *
 * client        — a dedicated pg connection (BEGIN/COMMIT capable).
 * apply=false   — locks, recounts, reports, ROLLBACKs.
 * onLockedAfterCount — TEST HOOK only: async callback invoked while the
 *   item lock is held, after the recount, before the decision is written.
 *   Production callers pass nothing; the race tests use it to land a
 *   rating mid-transaction and prove the fresh count is honoured.
 */
export async function repairItemWithLock(client, itemId, minRaters, { apply = true, onLockedAfterCount = null } = {}) {
  await client.query("BEGIN");
  try {
    const locked = await client.query(
      "SELECT id, status, rating_count FROM corpus_items WHERE id = $1 FOR UPDATE",
      [itemId],
    );
    if (!locked.rows.length) {
      await client.query(apply ? "COMMIT" : "ROLLBACK");
      return { id: itemId, skipped: "missing", changed: false };
    }
    const before = {
      status: locked.rows[0].status,
      stored: Number(locked.rows[0].rating_count),
    };
    // The recount happens AFTER acquiring the lock: any concurrent store
    // write (which locks the same row) has either fully committed before it
    // (counted) or waits for us (not counted, and will fix its own delta).
    const counted = await client.query(
      "SELECT count(*)::int AS n FROM corpus_ratings WHERE corpus_id = $1",
      [itemId],
    );
    const actual = counted.rows[0].n;
    if (onLockedAfterCount) await onLockedAfterCount(client, { itemId, actual });

    const targetStatus =
      before.status === "open" && actual >= minRaters
        ? "rated"
        : before.status === "rated" && actual < minRaters
          ? "open"
          : before.status;
    const changes = actual !== before.stored || targetStatus !== before.status;
    if (apply && changes) {
      await client.query(
        "UPDATE corpus_items SET rating_count = $2, status = $3 WHERE id = $1",
        [itemId, actual, targetStatus],
      );
    }
    await client.query(apply ? "COMMIT" : "ROLLBACK");
    return {
      id: itemId,
      before,
      actual,
      after: apply && changes ? { stored: actual, status: targetStatus } : before,
      changed: apply && changes,
      wouldChange: changes,
    };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  }
}
