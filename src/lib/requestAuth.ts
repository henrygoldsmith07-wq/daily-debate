import "server-only";

import { isCorpusAdmin } from "@/lib/corpus";
import type { AppUser } from "@/lib/backend/auth";
import { getCurrentUser } from "@/lib/currentViewer";

export interface RequestAuthContext {
  user: AppUser | null;
  isAdmin: boolean;
}

/** Shared request-auth lookup for API routes and internal server pages. */
export async function getRequestAuthContext(): Promise<RequestAuthContext> {
  const user = await getCurrentUser();
  return {
    user,
    isAdmin: !!user && isCorpusAdmin(user.email, process.env.CORPUS_ADMIN_EMAILS),
  };
}
