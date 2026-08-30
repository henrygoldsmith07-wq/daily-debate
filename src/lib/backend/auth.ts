import "server-only";

import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { queryRows } from "./sql";

const scrypt = promisify(scryptCallback);

export type AppUser = { id: string; email: string };
export type GoogleProfile = {
  sub: string;
  email: string;
  name?: string | null;
  image?: string | null;
};
export type AuthError = { message: string };

export type CookieStore = {
  get(name: string): { value: string } | undefined;
  set(
    name: string,
    value: string,
    options: {
      httpOnly: boolean;
      secure: boolean;
      sameSite: "lax";
      path: string;
      maxAge: number;
    },
  ): void;
  delete(name: string): void;
};

async function passwordHash(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

async function passwordMatches(password: string, encoded: string): Promise<boolean> {
  const [algorithm, saltText, hashText] = encoded.split("$");
  if (algorithm !== "scrypt" || !saltText || !hashText) return false;
  const expected = Buffer.from(hashText, "base64url");
  const actual = (await scrypt(password, Buffer.from(saltText, "base64url"), expected.length)) as Buffer;
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function validateCredentials(email: string, password: string): string | null {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Enter a valid email address.";
  if (password.length < 8) return "Password must be at least 8 characters.";
  if (password.length > 128) return "Password must be 128 characters or fewer.";
  return null;
}

function friendlyError(error: unknown): AuthError {
  const candidate = error as { code?: string; message?: string };
  if (candidate?.code === "23505") return { message: "That email or display name is already in use." };
  console.error("[auth] backend operation failed", { error: candidate?.message ?? String(error) });
  return { message: "Account service is temporarily unavailable." };
}

/**
 * Verifies an email + password pair for the Auth.js credentials provider.
 * Returns the user on success and null on any failure, revealing nothing
 * about which half was wrong.
 */
export async function verifyPasswordForEmail(
  emailInput: string,
  password: string,
): Promise<AppUser | null> {
  const email = normalizeEmail(emailInput);
  try {
    const rows = await queryRows<AppUser & { password_hash: string | null }>(
      "SELECT id, email, password_hash FROM app_users WHERE email = $1 LIMIT 1",
      [email],
    );
    const row = rows[0];
    // A Google-only account has no hash at all; that is a refusal, not an
    // empty password to compare against.
    if (!row?.password_hash) return null;
    if (!(await passwordMatches(password, row.password_hash))) return null;
    return { id: row.id, email: row.email };
  } catch (error) {
    console.error("[auth] password verification failed", error);
    return null;
  }
}

/**
 * Resolves the app user behind a verified Google profile, creating or linking
 * one as needed.
 *
 * Matching is by `google_sub` first — it survives the user changing the
 * address on their Google account — then by email, which is what links Google
 * onto an existing password account instead of stranding that person's debate
 * history behind a second, empty account. Email is only trusted as a link key
 * because the caller has already checked Google marked it verified.
 */
export async function upsertGoogleUser(profile: GoogleProfile): Promise<AppUser> {
  const email = normalizeEmail(profile.email);
  const displayName = (profile.name?.trim() || email.split("@")[0]).slice(0, 40);

  // One statement, so two concurrent first sign-ins cannot both insert.
  // ON CONFLICT (email) is what performs the link onto an existing account.
  const rows = await queryRows<AppUser>(
    `WITH linked AS (
       UPDATE app_users
          SET name = COALESCE($3, name), image = COALESCE($4, image)
        WHERE google_sub = $2
        RETURNING id, email
     ), inserted AS (
       INSERT INTO app_users (email, password_hash, google_sub, name, image)
       SELECT $1, NULL, $2, $3, $4
        WHERE NOT EXISTS (SELECT 1 FROM linked)
       ON CONFLICT (email) DO UPDATE
          SET google_sub = EXCLUDED.google_sub,
              name = COALESCE(app_users.name, EXCLUDED.name),
              image = COALESCE(app_users.image, EXCLUDED.image)
       RETURNING id, email
     )
     SELECT id, email FROM linked
     UNION ALL
     SELECT id, email FROM inserted`,
    [email, profile.sub, displayName, profile.image ?? null],
  );

  const user = rows[0];
  if (!user) throw new Error("Could not resolve a Google account");

  // A profile row is what the rest of the app reads for a display name.
  await queryRows(
    `INSERT INTO profiles (id, username) VALUES ($1, $2)
     ON CONFLICT (id) DO NOTHING`,
    [user.id, displayName],
  );
  return user;
}

export class AuthApi {
  // The cookie store is no longer read here — Auth.js owns the session cookie.
  // The constructor argument is kept so `createClient()` and the ~20 call
  // sites that do `db.auth.getUser()` stay exactly as they were.
  constructor(private readonly cookieStore: CookieStore | null = null) {}

  /**
   * The signed-in user, or null.
   *
   * `auth-config` is imported lazily: it imports this module for password
   * verification and the Google upsert, so a static import both ways would be
   * a cycle. This side of it is only ever needed at call time.
   */
  async getUser(): Promise<{ data: { user: AppUser | null }; error: AuthError | null }> {
    try {
      const { auth } = await import("./auth-config");
      const session = await auth();
      const id = session?.user?.id;
      if (!id) return { data: { user: null }, error: null };
      // A JWT outlives the row it names, so resolve it every time rather than
      // trusting the token alone — a deleted account must stop working at once.
      const rows = await queryRows<AppUser>(
        "SELECT id, email FROM app_users WHERE id = $1 LIMIT 1",
        [id],
      );
      return { data: { user: rows[0] ?? null }, error: null };
    } catch (error) {
      return { data: { user: null }, error: friendlyError(error) };
    }
  }

  /**
   * Creates a password account. It does NOT establish a session: the login
   * action signs the new account straight in through Auth.js afterwards, so
   * exactly one code path mints a session.
   */
  async signUp(input: {
    email: string;
    password: string;
    options?: { data?: { display_name?: string } };
  }): Promise<{ data: { user: AppUser | null }; error: AuthError | null }> {
    const email = normalizeEmail(input.email);
    const validationError = validateCredentials(email, input.password);
    if (validationError) return { data: { user: null }, error: { message: validationError } };
    const requestedName = input.options?.data?.display_name?.trim();
    const displayName = (requestedName || email.split("@")[0]).slice(0, 40);
    try {
      const hash = await passwordHash(input.password);
      const rows = await queryRows<AppUser>(
        `WITH new_user AS (
           INSERT INTO app_users (email, password_hash) VALUES ($1, $2)
           RETURNING id, email
         ), new_profile AS (
           INSERT INTO profiles (id, username)
           SELECT id, $3 FROM new_user
         )
         SELECT id, email FROM new_user`,
        [email, hash, displayName],
      );
      const user = rows[0];
      if (!user) return { data: { user: null }, error: { message: "Could not create account." } };
      return { data: { user }, error: null };
    } catch (error) {
      return { data: { user: null }, error: friendlyError(error) };
    }
  }
}
