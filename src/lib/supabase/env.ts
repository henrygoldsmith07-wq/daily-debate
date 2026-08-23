// Env access for the Supabase clients.
//
// A missing variable previously surfaced as Supabase's generic "Your project's
// URL and Key are required" error thrown from inside middleware, which turns
// every route into an opaque 500. Naming the variable — and where to set it —
// makes a misconfigured deployment diagnosable from the logs alone.
//
// Each getter spells out `process.env.<NAME>` in full: Next.js inlines
// `NEXT_PUBLIC_*` reads by textual substitution, so a dynamic `process.env[name]`
// lookup would silently come back undefined in the browser bundle.

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. On Vercel, set it under ` +
        `Settings → Environment Variables for the Production, Preview, and ` +
        `Development environments, then redeploy. Locally, set it in .env.local.`,
    );
  }
  return value;
}

export function supabaseUrl() {
  return required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
}

export function supabaseAnonKey() {
  return required("NEXT_PUBLIC_SUPABASE_ANON_KEY", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

export function supabaseServiceRoleKey() {
  return required("SUPABASE_SERVICE_ROLE_KEY", process.env.SUPABASE_SERVICE_ROLE_KEY);
}
