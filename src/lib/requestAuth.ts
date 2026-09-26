import "server-only";

import { createClient } from "@/lib/backend/server";
import { isCorpusAdmin } from "@/lib/corpus";
import type { AppUser } from "@/lib/backend/auth";

export interface RequestAuthContext {
  user: AppUser | null;
  isAdmin: boolean;
}

/** Shared request-auth lookup for API routes and internal server pages. */
export async function getRequestAuthContext(): Promise<RequestAuthContext> {
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  return {
    user,
    isAdmin: !!user && isCorpusAdmin(user.email, process.env.CORPUS_ADMIN_EMAILS),
  };
}
