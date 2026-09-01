import "server-only";

import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { queryRows } from "./sql";
import { SESSION_COOKIE, SESSION_TTL_SECONDS } from "./session";

const scrypt = promisify(scryptCallback);

/** Reset tokens are single-use and short-lived: long enough for an email round-trip. */
export const PASSWORD_RESET_TTL_SECONDS = 60 * 30;

export type AppUser = { id: string; email: string };
export type AuthError = { message: string };

/**
 * Delivery sink for password-reset tokens. Production wires an email sender;
 * dev mode (no sender configured) surfaces the token directly so the flow is
 * testable without mail infrastructure.
 */
export type ResetTokenSender = (email: string, token: string) => void | Promise<void>;

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

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

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

async function createSession(userId: string, cookieStore: CookieStore): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  await queryRows(
    `INSERT INTO app_sessions (user_id, token_hash, expires_at)
     VALUES ($1, $2, now() + ($3 * interval '1 second'))`,
    [userId, tokenHash(token), SESSION_TTL_SECONDS],
  );
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export class AuthApi {
  constructor(
    private readonly cookieStore: CookieStore | null,
    private readonly resetTokenSender?: ResetTokenSender,
  ) {}

  async getUser(): Promise<{ data: { user: AppUser | null }; error: AuthError | null }> {
    const token = this.cookieStore?.get(SESSION_COOKIE)?.value;
    if (!token) return { data: { user: null }, error: null };
    try {
      const rows = await queryRows<AppUser>(
        `SELECT u.id, u.email
         FROM app_sessions s
         JOIN app_users u ON u.id = s.user_id
         WHERE s.token_hash = $1 AND s.expires_at > now()
         LIMIT 1`,
        [tokenHash(token)],
      );
      return { data: { user: rows[0] ?? null }, error: null };
    } catch (error) {
      return { data: { user: null }, error: friendlyError(error) };
    }
  }

  async signInWithPassword(credentials: {
    email: string;
    password: string;
  }): Promise<{ data: { user: AppUser | null }; error: AuthError | null }> {
    if (!this.cookieStore) return { data: { user: null }, error: { message: "Cookies are unavailable." } };
    const email = normalizeEmail(credentials.email);
    const validationError = validateCredentials(email, credentials.password);
    if (validationError) return { data: { user: null }, error: { message: validationError } };
    try {
      const rows = await queryRows<AppUser & { password_hash: string }>(
        "SELECT id, email, password_hash FROM app_users WHERE email = $1 LIMIT 1",
        [email],
      );
      const row = rows[0];
      if (!row || !(await passwordMatches(credentials.password, row.password_hash))) {
        return { data: { user: null }, error: { message: "Invalid email or password." } };
      }
      await createSession(row.id, this.cookieStore);
      return { data: { user: { id: row.id, email: row.email } }, error: null };
    } catch (error) {
      return { data: { user: null }, error: friendlyError(error) };
    }
  }

  async signUp(input: {
    email: string;
    password: string;
    options?: { data?: { display_name?: string } };
  }): Promise<{ data: { user: AppUser | null }; error: AuthError | null }> {
    if (!this.cookieStore) return { data: { user: null }, error: { message: "Cookies are unavailable." } };
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
      await createSession(user.id, this.cookieStore);
      return { data: { user }, error: null };
    } catch (error) {
      return { data: { user: null }, error: friendlyError(error) };
    }
  }

  /**
   * Request a password reset. Always reports success — whether or not the
   * email exists — so the endpoint cannot be used to enumerate accounts.
   * The raw token is only delivered via the configured sender (or returned
   * to dev mode callers through the sendDevTokenToConsole default).
   */
  async requestPasswordReset(email: string): Promise<{ error: AuthError | null }> {
    const normalized = normalizeEmail(email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      return { error: { message: "Enter a valid email address." } };
    }
    try {
      const rows = await queryRows<{ id: string }>(
        "SELECT id FROM app_users WHERE email = $1 LIMIT 1",
        [normalized],
      );
      const user = rows[0];
      if (user) {
        // Invalidate any outstanding tokens for this account: only the
        // newest link may be used.
        await queryRows("DELETE FROM password_reset_tokens WHERE user_id = $1", [user.id]);
        const token = randomBytes(32).toString("base64url");
        await queryRows(
          `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
           VALUES ($1, $2, now() + ($3 * interval '1 second'))`,
          [user.id, tokenHash(token), PASSWORD_RESET_TTL_SECONDS],
        );
        if (this.resetTokenSender) {
          await this.resetTokenSender(normalized, token);
        } else {
          // Dev mode: no mail infrastructure configured. Log the reset link
          // material so the flow is completable locally.
          console.info(
            `[auth] password reset token for ${normalized} (dev mode, 30 min validity): ${token}`,
          );
        }
      }
      return { error: null };
    } catch (error) {
      return { error: friendlyError(error) };
    }
  }

  /**
   * Consume a reset token and set a new password. The token is marked used
   * in the same statement that updates the password, so a token can never
   * be applied twice — even under concurrent submission.
   */
  async resetPassword(input: {
    token: string;
    newPassword: string;
  }): Promise<{ error: AuthError | null }> {
    if (!input.token) return { error: { message: "Reset token is required." } };
    if (input.newPassword.length < 8) {
      return { error: { message: "Password must be at least 8 characters." } };
    }
    if (input.newPassword.length > 128) {
      return { error: { message: "Password must be 128 characters or fewer." } };
    }
    try {
      const hash = await passwordHash(input.newPassword);
      const rows = await queryRows<{ id: string; email: string }>(
        `WITH consumed AS (
           UPDATE password_reset_tokens
           SET used_at = now()
           WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
           RETURNING user_id
         )
         UPDATE app_users u
         SET password_hash = $2
         FROM consumed c
         WHERE u.id = c.user_id
         RETURNING u.id, u.email`,
        [tokenHash(input.token), hash],
      );
      const user = rows[0];
      if (!user) {
        return { error: { message: "Reset link is invalid or has expired. Please request a new one." } };
      }
      // Any session created before the reset may belong to an attacker who
      // knew the old password — revoke them all and force fresh sign-in.
      await queryRows("DELETE FROM app_sessions WHERE user_id = $1", [user.id]);
      return { error: null };
    } catch (error) {
      return { error: friendlyError(error) };
    }
  }

  async signOut(): Promise<{ error: AuthError | null }> {
    const token = this.cookieStore?.get(SESSION_COOKIE)?.value;
    try {
      if (token) await queryRows("DELETE FROM app_sessions WHERE token_hash = $1", [tokenHash(token)]);
      this.cookieStore?.delete(SESSION_COOKIE);
      return { error: null };
    } catch (error) {
      return { error: friendlyError(error) };
    }
  }
}
