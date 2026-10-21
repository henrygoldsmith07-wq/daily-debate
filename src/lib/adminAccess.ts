// Admin authorization: TWO INDEPENDENT FACTORS.
//
//   1. the DATABASE ROLE (`app_users.is_admin`) — grantable only by an
//      operator with database access. The sign-up path never writes it, and
//      no request body can set it, so an account can never confer the role
//      on itself.
//   2. the ENV ALLOWLIST (`CORPUS_ADMIN_EMAILS`) — a narrowing control an
//      operator can change without a database round-trip.
//
// Both must hold. The previous gate compared the request's email — a value
// the account owner chose at sign-up, and which this codebase never
// verifies — against the allowlist. That made the allowlist a self-claimed
// credential: registering an allowlisted address that had no account yet was
// enough to become an administrator over the corpus, the ops report and the
// product funnel. Splitting the check removes the self-claim, because the
// database role is not something a visitor can assert.
//
// Pure module: no server-only imports, so the gate is unit-testable.

import { isCorpusAdmin } from "./corpus";

export interface AdminIdentity {
  email: string;
  /** The database role, read from `app_users.is_admin`. */
  isAdmin: boolean;
}

/**
 * True only when BOTH factors hold: the account holds the database admin
 * role AND its address is on the operator's allowlist.
 *
 * Fails closed in every direction: no identity, no role, or an address that
 * is not on the allowlist all deny.
 */
export function isAdminAccount(
  identity: AdminIdentity | null | undefined,
  allowlist: string | undefined,
): boolean {
  if (!identity) return false;
  if (identity.isAdmin !== true) return false;
  return isCorpusAdmin(identity.email, allowlist);
}
