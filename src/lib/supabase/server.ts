import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { Database } from "./database.types";
import { supabaseAnonKey, supabaseServiceRoleKey, supabaseUrl } from "./env";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        // Called from a Server Component: middleware already refreshes the
        // session, so a failed set() here (no response object available) is
        // safe to ignore.
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // ignore
        }
      },
    },
  });
}

// Server-to-server context with no user session (daily topic generation,
// AI judging, cron) — bypasses RLS since there's no auth.uid() to match.
export function createServiceClient() {
  return createSupabaseClient<Database>(supabaseUrl(), supabaseServiceRoleKey());
}
