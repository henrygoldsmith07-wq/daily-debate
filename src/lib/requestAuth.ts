import "server-only";

import { isAdminAccount } from "@/lib/adminAccess";
import type { AppUser } from "@/lib/backend/auth";
import { getCurrentUser } from "@/lib/currentViewer";

export interface RequestAuthContext {
  user: AppUser | null;
  isAdmin: boolean;
}

/**
 * Shared request-auth lookup for API routes and internal server pages.
 *
 * Admin access needs TWO independent factors: the operator-granted database
 * role (`app_users.is_admin`) AND the CORPUS_ADMIN_EMAILS allowlist. The
 * email alone is never enough — it is a value the account owner chose at
 * sign-up and this codebase does not verify mailboxes, so trusting it would
 * make every admin surface a self-registration target.
 */
export async function getRequestAuthContext(): Promise<RequestAuthContext> {
  const user = await getCurrentUser();
  return {
    user,
    isAdmin: isAdminAccount(
      user ? { email: user.email, isAdmin: user.is_admin === true } : null,
      process.env.CORPUS_ADMIN_EMAILS,
    ),
  };
}
