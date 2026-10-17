import { createHash, scrypt } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

// The AuthApi imports "server-only" (aliased in vitest.config.mts) and the
// Neon-backed queryRows. These tests exercise the pure validation and
// delivery-decision logic without touching Postgres.

vi.mock("./sql", () => ({
  queryRows: vi.fn(),
}));

// Pass-through wrapper so tests can count password-hash work.
vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return { ...actual, scrypt: vi.fn(actual.scrypt) };
});

import { queryRows } from "./sql";
import {
  AuthApi,
  PASSWORD_RESET_TTL_SECONDS,
  type ResetTokenSender,
} from "./auth";

const mockQueryRows = vi.mocked(queryRows);

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

describe("PASSWORD_RESET_TTL_SECONDS", () => {
  it("gives users 30 minutes to complete the reset", () => {
    expect(PASSWORD_RESET_TTL_SECONDS).toBe(60 * 30);
  });
});

describe("requestPasswordReset validation", () => {
  it("rejects malformed emails without touching the database", async () => {
    mockQueryRows.mockClear();
    const api = new AuthApi(null);
    const { error } = await api.requestPasswordReset("not-an-email");
    expect(error?.message).toMatch(/valid email/i);
    expect(mockQueryRows).not.toHaveBeenCalled();
  });

  it("never reveals whether an email exists (non-enumeration)", async () => {
    mockQueryRows.mockReset();
    // Unknown email: no user row found.
    mockQueryRows.mockResolvedValue([]);
    const api = new AuthApi(null, () => {});
    const { error } = await api.requestPasswordReset("ghost@example.com");
    expect(error).toBeNull();
  });

  it("fails consistently before account lookup when reset email is not configured", async () => {
    mockQueryRows.mockReset();
    const api = new AuthApi(null);
    const { error } = await api.requestPasswordReset("user@example.com");
    expect(error?.message).toMatch(/temporarily unavailable/i);
    expect(mockQueryRows).not.toHaveBeenCalled();
  });

  it("invalidates outstanding tokens before issuing a new one", async () => {
    mockQueryRows.mockReset();
    mockQueryRows.mockResolvedValue([{ id: "u-1" }]);
    const api = new AuthApi(null, () => {});
    await api.requestPasswordReset("user@example.com");
    const calls = mockQueryRows.mock.calls;
    // Call order: look up the user, invalidate outstanding tokens, insert the new token.
    expect(calls[0]![0]).toContain("SELECT id FROM app_users");
    expect(calls[1]![0]).toContain("DELETE FROM password_reset_tokens");
    expect(calls[2]![0]).toContain("INSERT INTO password_reset_tokens");
    // Stored hash is sha256 of the token, 64 hex chars.
    expect(String(calls[2]?.[1]?.[1])).toMatch(/^[0-9a-f]{64}$/);
  });

  it("delivers the raw token through the configured sender only", async () => {
    mockQueryRows.mockReset();
    mockQueryRows.mockResolvedValue([{ id: "u-1" }]);
    const sent: { email: string; token: string }[] = [];
    const sender: ResetTokenSender = (email, token) => {
      sent.push({ email, token });
    };
    const api = new AuthApi(null, sender);
    await api.requestPasswordReset("user@example.com");
    expect(sent).toHaveLength(1);
    expect(sent[0]?.email).toBe("user@example.com");
    expect(sent[0]?.token).toBeTruthy();
    // The stored hash must correspond to the delivered raw token.
    expect(String(mockQueryRows.mock.calls[2]?.[1]?.[1])).toBe(sha256(sent[0]?.token));
  });

  it("revokes an undelivered token without exposing delivery failure", async () => {
    mockQueryRows.mockReset();
    mockQueryRows.mockResolvedValue([{ id: "u-1" }]);
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const api = new AuthApi(null, async () => {
      throw new Error("provider unavailable");
    });
    const result = await api.requestPasswordReset("user@example.com");
    expect(result.error).toBeNull();
    expect(mockQueryRows.mock.calls[3]?.[0]).toContain("DELETE FROM password_reset_tokens");
    expect(errorLog).toHaveBeenCalledWith(
      "[auth] password reset email delivery failed",
      expect.objectContaining({ error: "provider unavailable" }),
    );
    const serializedLogs = JSON.stringify(errorLog.mock.calls);
    expect(serializedLogs).not.toContain("user@example.com");
    errorLog.mockRestore();
  });
});

describe("resetPassword validation", () => {
  it("rejects an empty token", async () => {
    mockQueryRows.mockReset();
    const api = new AuthApi(null);
    const { error } = await api.resetPassword({ token: "", newPassword: "longenough123" });
    expect(error?.message).toMatch(/token/i);
    expect(mockQueryRows).not.toHaveBeenCalled();
  });

  it("rejects short and over-long passwords without touching the database", async () => {
    mockQueryRows.mockReset();
    const api = new AuthApi(null);
    const short = await api.resetPassword({ token: "t", newPassword: "short" });
    const long = await api.resetPassword({ token: "t", newPassword: "x".repeat(129) });
    expect(short.error?.message).toMatch(/at least 8/i);
    expect(long.error?.message).toMatch(/128/);
    expect(mockQueryRows).not.toHaveBeenCalled();
  });

  it("reports a friendly error when the token does not resolve to a user", async () => {
    mockQueryRows.mockReset();
    // No row returned: token invalid, expired, or already consumed.
    mockQueryRows.mockResolvedValue([]);
    const api = new AuthApi(null);
    const { error } = await api.resetPassword({ token: "stale-token", newPassword: "newpassword1" });
    expect(error?.message).toMatch(/invalid or has expired/i);
  });

  it("hashes tokens with sha256 before lookup (same scheme as sessions)", async () => {
    mockQueryRows.mockReset();
    mockQueryRows.mockResolvedValue([{ id: "u-1", email: "user@example.com" }]);
    const api = new AuthApi(null);
    await api.resetPassword({ token: "raw-token-value", newPassword: "newpassword1" });
    expect(String(mockQueryRows.mock.calls[0]?.[1]?.[0])).toBe(sha256("raw-token-value"));
  });
});

describe("PASSWORD_RESET_TTL_SECONDS", () => {
  it("gives users 30 minutes to complete the reset", () => {
    expect(PASSWORD_RESET_TTL_SECONDS).toBe(60 * 30);
  });
});

describe("signUp display name", () => {
  function cookieStore() {
    return { get: () => undefined, set: vi.fn(), delete: vi.fn() };
  }

  it("never derives the public display name from the email when none is chosen", async () => {
    mockQueryRows.mockReset();
    mockQueryRows.mockResolvedValue([{ id: "u-1", email: "john@example.com" }]);
    const api = new AuthApi(cookieStore());
    await api.signUp({ email: "john@example.com", password: "long-enough-pw" });
    const displayName = String(mockQueryRows.mock.calls[0]?.[1]?.[2]);
    expect(displayName).toMatch(/^debater-[0-9a-f]{8}$/);
    expect(displayName).not.toContain("john");
  });

  it("keeps a chosen display name", async () => {
    mockQueryRows.mockReset();
    mockQueryRows.mockResolvedValue([{ id: "u-1", email: "john@example.com" }]);
    const api = new AuthApi(cookieStore());
    await api.signUp({
      email: "john@example.com",
      password: "long-enough-pw",
      options: { data: { display_name: "  Rhetor  " } },
    });
    expect(mockQueryRows.mock.calls[0]?.[1]?.[2]).toBe("Rhetor");
  });

  it("says which field collided on a unique violation", async () => {
    const api = new AuthApi(cookieStore());
    mockQueryRows.mockReset();
    mockQueryRows.mockRejectedValueOnce(
      Object.assign(new Error("duplicate key"), { code: "23505", constraint: "profiles_username_key" }),
    );
    const taken = await api.signUp({ email: "a@example.com", password: "long-enough-pw", options: { data: { display_name: "x" } } });
    expect(taken.error?.message).toMatch(/display name is taken/i);

    mockQueryRows.mockRejectedValueOnce(
      Object.assign(new Error("duplicate key"), { code: "23505", detail: "Key (email)=(a@example.com) already exists." }),
    );
    const exists = await api.signUp({ email: "a@example.com", password: "long-enough-pw" });
    expect(exists.error?.message).toMatch(/account with that email already exists/i);

    // The duplicated value is user input and must not be mistaken for the column.
    mockQueryRows.mockRejectedValueOnce(
      Object.assign(new Error("duplicate key"), { code: "23505", detail: "Key (email)=(username@example.com) already exists." }),
    );
    const tricky = await api.signUp({ email: "username@example.com", password: "long-enough-pw" });
    expect(tricky.error?.message).toMatch(/account with that email already exists/i);
  });
});

describe("signInWithPassword timing", () => {
  it("does the same password-hash work for an unknown email as for a wrong password", async () => {
    mockQueryRows.mockReset();
    mockQueryRows.mockResolvedValue([]);
    const api = new AuthApi({ get: () => undefined, set: vi.fn(), delete: vi.fn() });
    // Warm the lazily computed dummy hash so only the verification is counted.
    await api.signInWithPassword({ email: "ghost@example.com", password: "long-enough-pw" });
    vi.mocked(scrypt).mockClear();
    const { error } = await api.signInWithPassword({ email: "ghost@example.com", password: "long-enough-pw" });
    expect(error?.message).toBe("Invalid email or password.");
    expect(vi.mocked(scrypt)).toHaveBeenCalledTimes(1);
  });
});
